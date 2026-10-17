-- Operator-run template, AFTER migrations, as database owner; role names passed with psql -v:
--   psql "$OWNER_URL" -v ON_ERROR_STOP=1 -v database=<db> -v migration_role=<owner> \
--     -v runtime_role=<runtime> -f scripts/runtime-grants.sql
-- Create distinct login roles/passwords in your secret manager/provider first. Never put secrets here.
-- Required variables: database, migration_role, runtime_role. Do not run against development.
-- CI (scripts/ci-container-smoke.sh) and the restore rehearsal run this exact file.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
-- No DELETE by default: orders, payments, payment events, stock and audit rows are evidence.
REVOKE DELETE, TRUNCATE ON ALL TABLES IN SCHEMA public FROM :"runtime_role";
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
-- DELETE only where the API removes rows (grep '.delete(' / '.deleteMany(' in apps/api/src):
-- expired or revoked auth state, carts, account deletion, staff-managed lists and draft rows.
-- A new table that the API must delete from is added here; reapply after its migration.
GRANT DELETE ON TABLE
  public."Address",
  public."AuthRateLimit",
  public."CartItem",
  public."CheckoutReview",
  public."DeliveryPincode",
  public."DemandOverride",
  public."Device",
  public."Notification",
  public."OtpChallenge",
  public."OutboundMessage",
  public."PriceUpdateBatchItem",
  public."PushSubscription",
  public."Session"
  TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
REVOKE ALL ON TABLE public."_prisma_migrations" FROM :"runtime_role";
-- Tables created by later migrations get read/write but never DELETE until listed above.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  REVOKE DELETE, TRUNCATE ON TABLES FROM :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";
-- Runtime must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS with no role memberships.
-- Do not make runtime the database/schema/table owner. Reapply after each migration and verify.
