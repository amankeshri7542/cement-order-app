#!/usr/bin/env bash
# Proves a backup really restores. It works on throwaway copies on this machine and never touches
# a live database. Run monthly, and always before trusting a new backup setup.
#
#   restore-drill.sh dump [file]                 restores a nightly dump into a new database
#   restore-drill.sh logs <base file> <wal dir> [time]
#                                                starts a copy from a base backup and replays logs
#
# Backups are encrypted with a public certificate, so whoever holds the server could also make a
# false one. So nothing inside a backup is trusted here:
#   - dump mode must connect to Postgres on this machine as a role that is NOT a superuser, as a
#     false dump is SQL that runs as that role. Make one: CREATE ROLE shiv_drill LOGIN CREATEDB;
#   - logs mode starts a Postgres using settings found inside the backup, which could run commands.
#     Run it only on a throwaway server, never on your own computer.
# PG_BIN must hold the same major Postgres version for logs mode.
#   BACKUP_DIR   folder holding the encrypted backups (and receiving the drill log)
#   BACKUP_KEY   the private key. Keep it off the server
#   BACKUP_CERT  the matching certificate
set -euo pipefail
umask 077

fail() {
  echo "DRILL FAILED: $*" >&2
  exit 1
}
mode=${1:-}
: "${BACKUP_KEY:?BACKUP_KEY is required}"
: "${BACKUP_CERT:?BACKUP_CERT is required}"
[[ -r $BACKUP_KEY ]] || fail "cannot read the private key"
decrypt() {
  openssl cms -decrypt -binary -inform DER -inkey "$BACKUP_KEY" -recip "$BACKUP_CERT" "$@" 2>/dev/null
}
work=$(mktemp -d "${TMPDIR:-/tmp}/shiv-drill.XXXXXX")
stop_copy=(true)
cleanup() {
  "${stop_copy[@]}" >/dev/null 2>&1 || true
  rm -rf "$work"
}
trap cleanup EXIT

# Business rules a good restore must still hold. Each query returns rows only if something is wrong.
check() {
  psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 "$@" <<'SQL'
SELECT 'trigger missing: ' || t FROM unnest(ARRAY[
  'audit_log_append_only', 'staff_membership_protected', 'product_stock_bridge'
]) AS t WHERE NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = t);
SELECT 'main shop missing' WHERE NOT EXISTS (SELECT 1 FROM "Location" WHERE id = 'loc_main');
SELECT 'stock does not add up: ' || p.id FROM "Product" p
  LEFT JOIN "StockLevel" s ON s."productId" = p.id
  GROUP BY p.id, p.stock HAVING p.stock <> COALESCE(SUM(s.quantity), 0);
SELECT 'failed migration: ' || migration_name FROM _prisma_migrations
  WHERE finished_at IS NULL AND rolled_back_at IS NULL;
SQL
}

case $mode in
  dump)
    : "${BACKUP_DIR:?BACKUP_DIR is required}"
    case ${PGHOST:-} in
      localhost | 127.0.0.1 | ::1) ;;
      *) fail "PGHOST must be this machine, so a drill can never touch a live database" ;;
    esac
    superuser=$(PGDATABASE=postgres psql --no-psqlrc --tuples-only --no-align \
      -c 'SELECT rolsuper FROM pg_roles WHERE rolname = current_user') ||
      fail "cannot connect to Postgres on this machine"
    [[ $superuser == f ]] || fail "use a role that is not a superuser, like shiv_drill"
    file=${2:-$(find "$BACKUP_DIR" -maxdepth 1 -name 'shiv-*.dump.cms' | sort | tail -n 1)}
    [[ -n $file && -r $file ]] || fail "no dump found"
    decrypt -in "$file" -out "$work/dump" || fail "$(basename "$file") could not be decrypted: wrong key, or damaged"
    counts=${file%.dump.cms}.counts.cms
    [[ -r $counts ]] || fail "the row counts for $(basename "$file") are missing"
    decrypt -in "$counts" -out "$work/counts" || fail "the row counts could not be decrypted"

    database="shiv_restore_$(openssl rand -hex 6)_test"
    PGDATABASE=postgres createdb "$database"
    stop_copy=(env PGDATABASE=postgres dropdb --if-exists "$database")
    pg_restore --no-owner --no-acl --exit-on-error --dbname="$database" "$work/dump" ||
      fail "pg_restore stopped"

    problems=$(PGDATABASE=$database check)
    [[ -z $problems ]] || fail "$problems"
    # The dump was taken after these counts, so rows may have been added but never lost.
    while IFS='=' read -r table expected; do
      [[ -n $table ]] || continue
      # This file comes from the backup. Only exact table names and plain numbers are used.
      case $table in
        User | Product | Order | Payment | FinancialMovement | InventoryMovement) ;;
        CustomerLedgerEntry | StockLevel | StaffMembership | AuditLog) ;;
        *) fail "the row counts name an unknown table" ;;
      esac
      [[ $expected =~ ^[0-9]{1,15}$ ]] || fail "the row counts hold something that is not a number"
      found=$(PGDATABASE=$database psql --no-psqlrc --quiet --tuples-only --no-align \
        -c "SELECT count(*) FROM \"$table\"")
      ((found >= expected)) || fail "$table has $found rows, and the backup held $expected"
    done <"$work/counts"
    mkdir -p "$BACKUP_DIR"
    echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) PASS $(basename "$file")" >>"$BACKUP_DIR/restore-drills.log"
    echo "DRILL OK: $(basename "$file") restored, all checks passed"
    ;;
  logs)
    base=${2:-}
    wal=${3:-}
    target=${4:-}
    bin=${PG_BIN:-}
    [[ -n $bin ]] && bin="$bin/"
    [[ -r $base ]] || fail "no base backup found"
    [[ -d $wal ]] || fail "no log folder found"
    data="$work/data"
    mkdir -m 700 "$data"
    decrypt -in "$base" -out "$work/base.tar" || fail "$(basename "$base") could not be decrypted"
    tar -xf "$work/base.tar" -C "$data"
    rm -f "$work/base.tar"
    cat >"$work/fetch-log.sh" <<SCRIPT
#!/usr/bin/env bash
# Postgres asks for logs by name and treats a failure as "no more logs".
[[ -r "$wal/\$1.gz.cms" ]] || exit 1
set -o pipefail
openssl cms -decrypt -binary -inform DER -inkey "$BACKUP_KEY" -recip "$BACKUP_CERT" -in "$wal/\$1.gz.cms" 2>/dev/null | gzip -dc >"\$2"
SCRIPT
    chmod +x "$work/fetch-log.sh"
    port=$((54000 + RANDOM % 900))
    {
      echo "port = $port"
      echo "listen_addresses = '127.0.0.1'"
      echo "unix_socket_directories = ''"
      echo "archive_mode = off"
      echo "restore_command = '$work/fetch-log.sh %f %p'"
      echo "recovery_target_action = 'promote'"
      [[ -z $target ]] || echo "recovery_target_time = '$target'"
    } >>"$data/postgresql.auto.conf"
    touch "$data/recovery.signal"
    stop_copy=("${bin}pg_ctl" -D "$data" -m immediate -w stop)
    "${bin}pg_ctl" -D "$data" -w -t 180 -l "$work/postgres.log" start >/dev/null ||
      fail "the copy did not start: $(tail -n 3 "$work/postgres.log" | tr '\n' ' ')"
    export PGHOST=127.0.0.1 PGPORT=$port PGDATABASE=${PGDATABASE:-postgres}
    for _ in $(seq 1 60); do
      [[ $("${bin}psql" --no-psqlrc --tuples-only --no-align -c 'SELECT pg_is_in_recovery()') == f ]] && break
      sleep 1
    done
    [[ $("${bin}psql" --no-psqlrc --tuples-only --no-align -c 'SELECT pg_is_in_recovery()') == f ]] ||
      fail "log replay did not finish"
    if [[ -n ${DRILL_SQL:-} ]]; then
      "${bin}psql" --no-psqlrc --tuples-only --no-align --set ON_ERROR_STOP=1 -c "$DRILL_SQL"
    else
      problems=$(check)
      [[ -z $problems ]] || fail "$problems"
    fi
    echo "DRILL OK: base backup and logs replayed"
    ;;
  *)
    fail "usage: restore-drill.sh dump [file] | logs <base file> <wal dir> [time]"
    ;;
esac
