-- CreateEnum
CREATE TYPE "LocationKind" AS ENUM ('SHOP', 'GODOWN');

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "kind" "LocationKind" NOT NULL DEFAULT 'SHOP',
ADD COLUMN     "siteId" TEXT;

-- CreateTable
CREATE TABLE "DemoBatch" (
    "id" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "seed" INTEGER NOT NULL,
    "today" TEXT NOT NULL,
    "manifest" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_siteId_idx" ON "Location"("siteId");

-- The sink lock reads this table, so a row is never removed: the only way out of demo mode is
-- dropping the database. The seed writes its row before any data, with an empty manifest, and may
-- fill the manifest in once at the end. Nothing else about a row can change.
CREATE FUNCTION protect_demo_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Demo batches cannot be removed; drop the database instead'; END IF;
  IF OLD."manifest" <> '{}'::jsonb OR NEW."id" <> OLD."id" OR NEW."size" <> OLD."size"
     OR NEW."seed" <> OLD."seed" OR NEW."today" <> OLD."today" OR NEW."createdAt" <> OLD."createdAt"
     OR NEW."manifest" = '{}'::jsonb THEN
    RAISE EXCEPTION 'A demo batch only gets its manifest once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER demo_batch_protected BEFORE UPDATE OR DELETE ON "DemoBatch" FOR EACH ROW EXECUTE FUNCTION protect_demo_batch();
-- TRUNCATE skips row triggers, so it gets its own: emptying the table would lift the sink lock.
CREATE FUNCTION protect_demo_batch_truncate() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Demo batches cannot be removed; drop the database instead'; END;
$$;
CREATE TRIGGER demo_batch_no_truncate BEFORE TRUNCATE ON "DemoBatch" FOR EACH STATEMENT EXECUTE FUNCTION protect_demo_batch_truncate();
