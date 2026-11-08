-- A membership's firm limit is part of what was granted: like its shop and role, it can only end.
CREATE OR REPLACE FUNCTION protect_staff_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Staff memberships are never deleted'; END IF;
  IF OLD."endedAt" IS NOT NULL OR NEW."endedAt" IS NULL
    OR (NEW."id", NEW."userId", NEW."locationId", NEW."role", NEW."startedAt", NEW."grantedById", NEW."firmId")
       IS DISTINCT FROM (OLD."id", OLD."userId", OLD."locationId", OLD."role", OLD."startedAt", OLD."grantedById", OLD."firmId")
  THEN RAISE EXCEPTION 'A staff membership can only be ended'; END IF;
  RETURN NEW;
END;
$$;
