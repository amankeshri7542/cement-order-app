# Setting up the one server

This puts the whole shop on one small server in Mumbai: database, API, worker, website and desk. Cloudflare's free plan sits in front. Budget: about ₹1,140 a month for the 2 GB server, plus ₹100 to ₹300 for backups.

**What has and has not been tested.** The backup and restore scripts are tested on real Postgres (`npm run test:backup`), including a real log replay. The Docker files and `deploy.sh` have never been run, because this project's development Mac has no Docker. Expect to fix small things the first time, and do the first setup on a throwaway server before real data.

## How the pieces fit

- Nothing listens on the internet. A Cloudflare tunnel reaches out from the server, so the only open port is SSH.
- The API connects to Postgres with a restricted role (`shiv_runtime`). It refuses to start with the owner role.
- Backups are encrypted to a certificate. The server can write them and cannot read them. The private key never goes on the server.

## 1. Before you start

You need a Lightsail account, a domain on Cloudflare, and a Cloudflare R2 bucket for backups.

On your own computer, make the backup key. **Do this once. Without the key, the backups cannot be read by anyone.**

```bash
openssl req -x509 -newkey rsa:3072 -nodes -keyout shiv-backup-key.pem -out shiv-backup-cert.pem -days 7300 -subj "/CN=shiv-backup"
```

Keep `shiv-backup-key.pem` in your password manager, and a printed copy sealed with the family. Only `shiv-backup-cert.pem` goes on the server.

## 2. Create the server

1. Lightsail, Mumbai, Ubuntu 24.04 LTS, 2 GB. Attach a static IP.
2. In the Lightsail firewall, allow SSH only, from your own address if you can.
3. Turn on daily automatic snapshots.
4. Sign in, then add swap and install the tools:

```bash
sudo fallocate -l 1G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
```

```bash
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2 postgresql-client-16 rclone unattended-upgrades
```

Ubuntu may need the [PostgreSQL apt repository](https://www.postgresql.org/download/linux/ubuntu/) for version 16 tools. Check that the encryption these backups use works on this server:

```bash
echo test | openssl cms -encrypt -binary -aes-256-gcm -stream -outform DER shiv-backup-cert.pem | wc -c
```

## 3. Folders and secrets

```bash
sudo mkdir -p /srv/shiv/postgres /srv/shiv/wal /srv/shiv/backups
```

The Postgres container runs as user 70 and must own the database folders:

```bash
sudo chown -R 70:70 /srv/shiv/postgres /srv/shiv/wal
```

Put the code on the server. Then copy the templates and fill them in:

```bash
cp infra/server.env.example infra/server.env
```

```bash
cp apps/api/.env.example infra/api.env
```

In `infra/api.env`, use real values, exact `https://` origins in `CORS_ORIGINS`, `OTP_PROVIDER=twilio` and its keys. Delete `DATABASE_URL`, `PORT` and `NODE_ENV` from that file, as compose sets them. Make every password long and random, with `openssl rand -hex 32`.

```bash
chmod 600 infra/server.env infra/api.env
```

## 4. Cloudflare

1. Zero Trust, Networks, Tunnels: create a tunnel and copy its token to `TUNNEL_TOKEN` in `infra/server.env`.
2. Add three public hostnames: the API host to `http://api:4000`, the desk host to `http://desk:3000`, the shop host to `http://shop:3000`.
3. Set SSL to Full (strict), and turn on the free WAF managed rules.
4. Make an R2 bucket named `shiv-backups` with **no public access**. Make an API token for that bucket alone.
5. Run `rclone config` and name the remote `r2`.

## 5. First start

Start only the database, and create the restricted role:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/server.env up -d db
```

```bash
docker compose -f infra/docker-compose.yml --env-file infra/server.env exec db psql -U shiv_owner -d shiv_cement -c "CREATE ROLE shiv_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS"
```

Set its password by typing it, so it stays out of the command history. Open a prompt, type `\password shiv_runtime`, enter the same value as `RUNTIME_PASSWORD`, then `\q`:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/server.env exec db psql -U shiv_owner -d shiv_cement
```

Create `/srv/shiv/backup.env`, with `chmod 600`:

```bash
PGHOST=127.0.0.1
PGPORT=5432
PGUSER=shiv_owner
PGPASSWORD=same as POSTGRES_PASSWORD
PGDATABASE=shiv_cement
BACKUP_DIR=/srv/shiv/backups
BACKUP_CERT=/srv/shiv/shiv-backup-cert.pem
BACKUP_REMOTE=r2:shiv-backups
WAL_DIR=/srv/shiv/wal
BASEBACKUP_CONTAINER=shiv-db-1
```

Then put it all live:

```bash
infra/deploy.sh
```

Add the first owner. Add a passphrase too, as changing who can do what then asks for it, so a lost phone cannot do that:

```bash
docker compose -f infra/docker-compose.yml --env-file infra/server.env run --rm -e ADMIN_BOOTSTRAP_PASSWORD migrate npx tsx scripts/grant-admin.ts +91XXXXXXXXXX "Owner name"
```

That owner adds the second owner and all staff from **More, User aur access**.

**Each owner sets their own passphrase on day one, on that same page.** On a live server nobody can change access without one. Until an owner has set theirs, anyone holding their signed-in phone could set it first. The other owner gets an alert when that happens.

## 6. Scheduled backups

`sudo crontab -e`, replacing `/path/to/repo`:

```bash
# Finished database logs, every 5 minutes.
*/5 * * * * set -a; . /srv/shiv/backup.env; set +a; /path/to/repo/infra/backup.sh logs >> /var/log/shiv-backup.log 2>&1
# Full dump, every night at 2 AM server time.
0 2 * * * set -a; . /srv/shiv/backup.env; set +a; /path/to/repo/infra/backup.sh nightly >> /var/log/shiv-backup.log 2>&1
# Base copy for log replay, every Sunday.
0 3 * * 0 set -a; . /srv/shiv/backup.env; set +a; /path/to/repo/infra/backup.sh base >> /var/log/shiv-backup.log 2>&1
```

The base copy runs inside the database container, because Postgres trusts replication only from there. It needs a role with the `REPLICATION` right, which `shiv_owner` has.

In the R2 bucket, add a lifecycle rule to delete files older than 35 days. If R2 offers a bucket lock for you, turn it on for the same 35 days, so that someone holding this server cannot delete the backups.

Point a monitor at `infra/backup.sh status`. It fails if the nightly, log or base backup has quietly stopped.

## 7. First restore drill: do this before any real data

**A backup that has never been restored is only a hope.** On your own computer, with Postgres 16, using the key from step 1, and never on the live database. First make a role for drills that is not a superuser, since a backup is never fully trusted until it is proven (`CREATE ROLE shiv_drill LOGIN CREATEDB;`). Then:

```bash
rclone copy r2:shiv-backups ./shiv-backups --include "shiv-*"
```

Pick the newest date, and run the drill against your own local Postgres:

```bash
PGHOST=127.0.0.1 PGUSER=shiv_drill BACKUP_DIR=./shiv-backups BACKUP_KEY=shiv-backup-key.pem BACKUP_CERT=shiv-backup-cert.pem infra/restore-drill.sh dump
```

`DRILL OK` means every row count held, stock adds up, the protective triggers exist, and no migration failed. Repeat every month. Each pass is written to `restore-drills.log`.

## 8. If the server dies

1. Tell the shop to use the paper card. Nothing is lost on paper.
2. Make a new server with steps 2 to 4.
3. Copy the newest backup to it, using the private key for that one job. Then remove the key from the server again.
4. For most cases, restore the nightly dump into `shiv_cement` with `pg_restore --no-owner --no-acl`.
5. To also recover the hours since that dump, on the new server (never on your own computer, because this starts a Postgres with settings found inside the backup), start from the newest base copy and replay the logs:

```bash
PG_BIN=/usr/lib/postgresql/16/bin BACKUP_KEY=key.pem BACKUP_CERT=cert.pem infra/restore-drill.sh logs base/base-XXXX.tar.cms wal/ "2026-12-01 14:30:00+05:30"
```

That checks the copy and then removes it. For a real recovery, follow the same steps by hand so the data folder stays: unpack the base copy, add the `restore_command` and `recovery.signal` as the script does, and start Postgres on it.

6. Run `infra/deploy.sh`, then check orders, stock and udhaar against the paper before taking new orders.

## Things to check on the first real setup

- `TRUST_PROXY_HOPS=1` is right for one Cloudflare tunnel. Confirm it by checking that `SECURITY_REQUEST_REJECTED` and rate limits see the visitor's address and not the tunnel's.
- Memory on 2 GB is tight while building. Build on your own computer if it runs out, or move to the 4 GB plan before public launch, as already planned.
- One process does everything (`SHIV_ROLE=all`). Splitting the worker out needs live events to cross between processes first, which comes before the first AI reply.
