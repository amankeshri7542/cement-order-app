#!/usr/bin/env bash
# Backups for the one server. Everything leaves this script encrypted to a public certificate, so
# the server can write backups and cannot read them; the private key stays off the server.
#
#   backup.sh nightly   full database dump, plus row counts for the restore drill to compare
#   backup.sh base      full copy of the database files, the starting point for log replay
#   backup.sh logs      sends finished database logs, so little is lost between nightly dumps
#   backup.sh status    fails if the last nightly dump is too old (for a monitor to call)
#
# Connection comes from the standard PGHOST, PGPORT, PGUSER, PGPASSWORD and PGDATABASE, so no
# password appears on a command line.
#   BACKUP_DIR     where encrypted files are kept on this machine
#   BACKUP_CERT    public certificate to encrypt to (see docs/SERVER_SETUP.md)
#   BACKUP_REMOTE  optional rclone destination, like r2:shiv-backups
#   BACKUP_KEEP    nightly dumps kept on this machine (default 3); the remote keeps its own
#   WAL_DIR        where Postgres archives finished logs (logs mode)
#   BASEBACKUP_CONTAINER  optional: run the base copy inside this container, as replication is
#                  only trusted from inside it (shiv-db-1 on the server)
set -euo pipefail
umask 077

fail() {
  echo "BACKUP FAILED: $*" >&2
  exit 1
}
mode=${1:-}
: "${BACKUP_DIR:?BACKUP_DIR is required}"
stamp() { date -u +%Y%m%dT%H%M%SZ; }
encrypt() { openssl cms -encrypt -binary -aes-256-gcm -stream -outform DER "$BACKUP_CERT"; }
need_cert() {
  : "${BACKUP_CERT:?BACKUP_CERT is required}"
  [[ -r $BACKUP_CERT ]] || fail "cannot read the certificate"
}
# Sends a finished file to the remote, if there is one. A failed upload is a failed backup.
send() {
  local file=$1 under=${2:-}
  [[ -n ${BACKUP_REMOTE:-} ]] || return 0
  rclone copyto --quiet "$file" "$BACKUP_REMOTE/$under$(basename "$file")" ||
    fail "could not upload $(basename "$file")"
}

# Counts that let a restore prove it brought everything back. Holds no personal data.
manifest() {
  psql --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 <<'SQL'
SELECT 'User=' || count(*) FROM "User";
SELECT 'Product=' || count(*) FROM "Product";
SELECT 'Order=' || count(*) FROM "Order";
SELECT 'Payment=' || count(*) FROM "Payment";
SELECT 'FinancialMovement=' || count(*) FROM "FinancialMovement";
SELECT 'InventoryMovement=' || count(*) FROM "InventoryMovement";
SELECT 'CustomerLedgerEntry=' || count(*) FROM "CustomerLedgerEntry";
SELECT 'StockLevel=' || count(*) FROM "StockLevel";
SELECT 'StaffMembership=' || count(*) FROM "StaffMembership";
SELECT 'AuditLog=' || count(*) FROM "AuditLog";
SQL
}

case $mode in
  nightly)
    need_cert
    mkdir -p "$BACKUP_DIR"
    name="shiv-$(stamp)"
    dump="$BACKUP_DIR/$name.dump.cms"
    counts="$BACKUP_DIR/$name.counts.cms"
    trap 'rm -f "$dump.tmp" "$counts.tmp"' EXIT
    # A snapshot taken inside the dump's own transaction would be better still, but the counts
    # only guard against losing rows: the drill accepts more rows, never fewer.
    manifest | encrypt >"$counts.tmp" || fail "could not read row counts"
    pg_dump --format=custom --no-owner --no-acl | encrypt >"$dump.tmp" || fail "pg_dump stopped"
    [[ $(wc -c <"$dump.tmp") -gt 1024 ]] || fail "the dump is too small to be real"
    mv "$counts.tmp" "$counts"
    mv "$dump.tmp" "$dump"
    send "$counts"
    send "$dump"
    # Oldest first, keeping only the newest few here. The remote keeps its own history.
    keep=${BACKUP_KEEP:-3}
    total=$(find "$BACKUP_DIR" -maxdepth 1 -name 'shiv-*.dump.cms' | wc -l)
    if ((total > keep)); then
      while IFS= read -r old; do
        rm -f "$old" "${old%.dump.cms}.counts.cms"
      done < <(find "$BACKUP_DIR" -maxdepth 1 -name 'shiv-*.dump.cms' | sort | head -n "$((total - keep))")
    fi
    date -u +%s >"$BACKUP_DIR/last-nightly"
    echo "BACKUP OK: $(basename "$dump")"
    ;;
  base)
    need_cert
    mkdir -p "$BACKUP_DIR/base"
    file="$BACKUP_DIR/base/base-$(stamp).tar.cms"
    trap 'rm -f "$file.tmp"' EXIT
    copy=(pg_basebackup --format=tar --wal-method=none --no-manifest --checkpoint=fast --pgdata=-)
    if [[ -n ${BASEBACKUP_CONTAINER:-} ]]; then
      copy=(docker exec -u postgres "$BASEBACKUP_CONTAINER" "${copy[@]}" -U "${PGUSER:-postgres}")
    fi
    "${copy[@]}" | encrypt >"$file.tmp" || fail "pg_basebackup stopped"
    [[ $(wc -c <"$file.tmp") -gt 1024 ]] || fail "the base copy is too small to be real"
    mv "$file.tmp" "$file"
    send "$file" base/
    # Each base copy is the size of the database, and this server's disk also holds the database.
    keep_base=${BACKUP_KEEP_BASE:-1}
    total=$(find "$BACKUP_DIR/base" -maxdepth 1 -name 'base-*.tar.cms' | wc -l)
    if [[ -n ${BACKUP_REMOTE:-} ]] && ((total > keep_base)); then
      find "$BACKUP_DIR/base" -maxdepth 1 -name 'base-*.tar.cms' | sort |
        head -n "$((total - keep_base))" | while IFS= read -r old; do rm -f "$old"; done
    fi
    date -u +%s >"$BACKUP_DIR/last-base"
    echo "BACKUP OK: $(basename "$file")"
    ;;
  logs)
    need_cert
    : "${WAL_DIR:?WAL_DIR is required}"
    mkdir -p "$BACKUP_DIR/wal"
    sent=0
    while IFS= read -r wal; do
      name=$(basename "$wal")
      target="$BACKUP_DIR/wal/$name.gz.cms"
      # Quiet logs are mostly empty, so this shrinks 16 MB to very little.
      gzip -c "$wal" | encrypt >"$target.tmp" || fail "could not encrypt $name"
      mv "$target.tmp" "$target"
      send "$target" wal/
      # Only now is the plain copy safe to remove. A failed upload above keeps it for next time.
      rm -f "$wal"
      # Once it is off this machine, the local copy only uses up the disk Postgres needs.
      [[ -z ${BACKUP_REMOTE:-} ]] || rm -f "$target"
      sent=$((sent + 1))
    done < <(find "$WAL_DIR" -maxdepth 1 -type f ! -name '*.tmp' | sort)
    date -u +%s >"$BACKUP_DIR/last-logs"
    echo "BACKUP OK: $sent log files"
    ;;
  status)
    # A kind of backup that quietly stopped is found here, while there is still time to fix it.
    for pair in nightly:26 logs:2 base:192; do
      kind=${pair%%:*}
      max=${pair##*:}
      [[ -r $BACKUP_DIR/last-$kind ]] || fail "no $kind backup has finished here"
      age=$(($(date -u +%s) - $(cat "$BACKUP_DIR/last-$kind")))
      ((age <= max * 3600)) || fail "the last $kind backup is $((age / 3600)) hours old"
    done
    echo "BACKUP OK: nightly, logs and base are all recent"
    ;;
  *)
    fail "usage: backup.sh nightly|base|logs|status"
    ;;
esac
