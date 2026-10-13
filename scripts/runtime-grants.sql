-- Operator-run template, AFTER migrations, as database owner; role names passed with psql -v.
-- Create distinct login roles/passwords in your secret manager/provider first. Never put secrets here.
-- Required variables: database, migration_role, runtime_role. Do not run against development.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"database" TO :"runtime_role";
GRANT USAGE ON SCHEMA public TO :"runtime_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"runtime_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"runtime_role";
REVOKE ALL ON TABLE public."_prisma_migrations" FROM :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"runtime_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migration_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"runtime_role";
-- Runtime must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS with no role memberships.
-- Do not make runtime the database/schema/table owner. Reapply after each migration and verify.
