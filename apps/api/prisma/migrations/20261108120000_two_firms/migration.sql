-- Plan v4 A3: two firms. Every money row names its firm explicitly.
--
-- Each firmId column is added with a constant default, so existing rows read firm_main without a
-- rewrite. No UPDATE runs on the append-only tables, and their triggers stay untouched. The default
-- is then dropped, so every new row must name its firm: the server never falls back to one.

ALTER TABLE "Order" ADD COLUMN "firmId" TEXT NOT NULL DEFAULT 'firm_main';
ALTER TABLE "Order" ALTER COLUMN "firmId" DROP DEFAULT;
ALTER TABLE "FinancialMovement" ADD COLUMN "firmId" TEXT NOT NULL DEFAULT 'firm_main';
ALTER TABLE "FinancialMovement" ALTER COLUMN "firmId" DROP DEFAULT;
ALTER TABLE "CustomerLedgerEntry" ADD COLUMN "firmId" TEXT NOT NULL DEFAULT 'firm_main';
ALTER TABLE "CustomerLedgerEntry" ALTER COLUMN "firmId" DROP DEFAULT;
ALTER TABLE "GallaEntry" ADD COLUMN "firmId" TEXT NOT NULL DEFAULT 'firm_main';
ALTER TABLE "GallaEntry" ALTER COLUMN "firmId" DROP DEFAULT;

ALTER TABLE "Firm" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN "billPrefix" TEXT NOT NULL DEFAULT '',
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "upiId" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Firm" ADD CONSTRAINT "Firm_bill_prefix" CHECK ("billPrefix" ~ '^[A-Z]{0,6}$');

-- A one-firm limit is for an all-shop accountant only. Owners hold both firms; shop roles take their
-- shop's firm.
ALTER TABLE "StaffMembership" ADD COLUMN "firmId" TEXT;
ALTER TABLE "StaffMembership" ADD CONSTRAINT "staff_membership_firm"
  CHECK ("firmId" IS NULL OR ("role" = 'ACCOUNTANT' AND "locationId" IS NULL));

-- Openings are drafted and signed per firm. A draft is not a record of money, so it may be updated.
ALTER TABLE "KhataOpeningDraft" ADD COLUMN "firmId" TEXT NOT NULL DEFAULT 'firm_main';
UPDATE "KhataOpeningDraft" d SET "firmId" = l."firmId" FROM "Location" l WHERE l.id = d."locationId";
ALTER TABLE "KhataOpeningDraft" ALTER COLUMN "firmId" DROP DEFAULT;
ALTER TABLE "KhataOpeningDraft" DROP CONSTRAINT "KhataOpeningDraft_pkey",
ADD CONSTRAINT "KhataOpeningDraft_pkey" PRIMARY KEY ("customerId", "firmId");
DROP INDEX "CustomerLedgerEntry_opening_balance_key";
CREATE UNIQUE INDEX "CustomerLedgerEntry_opening_balance_key" ON "CustomerLedgerEntry"("customerId", "firmId")
  WHERE "kind" = 'OPENING_BALANCE';

CREATE TABLE "CustomerFirmBalance" (
    "customerId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "balancePaise" INTEGER NOT NULL DEFAULT 0,
    "creditLimitPaise" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CustomerFirmBalance_pkey" PRIMARY KEY ("customerId","firmId"),
    CONSTRAINT "CustomerFirmBalance_values" CHECK (
      "balancePaise" BETWEEN -2000000000 AND 2000000000
      AND ("creditLimitPaise" IS NULL OR "creditLimitPaise" BETWEEN 0 AND 2000000000))
);
-- Today every entry belongs to firm_main, so each customer's firm balance is their whole ledger.
INSERT INTO "CustomerFirmBalance" ("customerId", "firmId", "balancePaise", "updatedAt")
SELECT "customerId", "firmId", SUM("amountPaise")::int, CURRENT_TIMESTAMP
FROM "CustomerLedgerEntry" GROUP BY "customerId", "firmId";

CREATE TABLE "BillSeries" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "financialYear" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BillSeries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "BillSeries_values" CHECK ("financialYear" ~ '^\d{4}-\d{2}$' AND "nextNumber" >= 1)
);

CREATE INDEX "CustomerFirmBalance_firmId_balancePaise_idx" ON "CustomerFirmBalance"("firmId", "balancePaise");
CREATE UNIQUE INDEX "BillSeries_firmId_financialYear_key" ON "BillSeries"("firmId", "financialYear");
CREATE INDEX "CustomerLedgerEntry_firmId_customerId_idx" ON "CustomerLedgerEntry"("firmId", "customerId");
CREATE INDEX "Order_firmId_createdAt_idx" ON "Order"("firmId", "createdAt");
CREATE INDEX "FinancialMovement_firmId_occurredAt_idx" ON "FinancialMovement"("firmId", "occurredAt");

ALTER TABLE "Order" ADD CONSTRAINT "Order_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialMovement" ADD CONSTRAINT "FinancialMovement_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "GallaEntry" ADD CONSTRAINT "GallaEntry_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "KhataOpeningDraft" ADD CONSTRAINT "KhataOpeningDraft_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerFirmBalance" ADD CONSTRAINT "CustomerFirmBalance_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CustomerFirmBalance" ADD CONSTRAINT "CustomerFirmBalance_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BillSeries" ADD CONSTRAINT "BillSeries_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The firm of a money row can never disagree with what it belongs to. These run on every insert,
-- whichever code wrote the row.
CREATE FUNCTION money_firm_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected TEXT;
BEGIN
  IF TG_TABLE_NAME = 'Order' OR TG_TABLE_NAME = 'GallaEntry' THEN
    SELECT "firmId" INTO expected FROM "Location" WHERE id = NEW."locationId";
    IF expected IS DISTINCT FROM NEW."firmId" THEN
      RAISE EXCEPTION 'FIRM_MISMATCH: % must belong to its shop''s firm', TG_TABLE_NAME;
    END IF;
  ELSIF TG_TABLE_NAME = 'CustomerLedgerEntry' THEN
    IF NEW."orderId" IS NOT NULL THEN
      SELECT "firmId" INTO expected FROM "Order" WHERE id = NEW."orderId";
      IF expected IS DISTINCT FROM NEW."firmId" THEN
        RAISE EXCEPTION 'FIRM_MISMATCH: a sale entry must be in its order''s firm';
      END IF;
    END IF;
    IF NEW."reversesId" IS NOT NULL THEN
      SELECT "firmId" INTO expected FROM "CustomerLedgerEntry" WHERE id = NEW."reversesId";
      IF expected IS DISTINCT FROM NEW."firmId" THEN
        RAISE EXCEPTION 'FIRM_MISMATCH: a reversal keeps its original''s firm';
      END IF;
    END IF;
    IF NEW."financialMovementId" IS NOT NULL THEN
      SELECT "firmId" INTO expected FROM "FinancialMovement" WHERE id = NEW."financialMovementId";
      IF expected IS DISTINCT FROM NEW."firmId" THEN
        RAISE EXCEPTION 'FIRM_MISMATCH: a payment entry must be in its money row''s firm';
      END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'FinancialMovement' THEN
    IF NEW."paymentId" IS NOT NULL THEN
      SELECT o."firmId" INTO expected FROM "Payment" p JOIN "Order" o ON o.id = p."orderId" WHERE p.id = NEW."paymentId";
      IF expected IS DISTINCT FROM NEW."firmId" THEN
        RAISE EXCEPTION 'FIRM_MISMATCH: a payment must be in its order''s firm';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_firm_check BEFORE INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION money_firm_check();
CREATE TRIGGER galla_entry_firm_check BEFORE INSERT ON "GallaEntry" FOR EACH ROW EXECUTE FUNCTION money_firm_check();
CREATE TRIGGER ledger_firm_check BEFORE INSERT ON "CustomerLedgerEntry" FOR EACH ROW EXECUTE FUNCTION money_firm_check();
CREATE TRIGGER money_firm_check BEFORE INSERT ON "FinancialMovement" FOR EACH ROW EXECUTE FUNCTION money_firm_check();

-- An order never changes firm, and a shop with records never moves to another firm.
CREATE FUNCTION firm_stays() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."firmId" IS DISTINCT FROM OLD."firmId" THEN
    IF TG_TABLE_NAME = 'Order' THEN RAISE EXCEPTION 'FIRM_MISMATCH: an order keeps its firm'; END IF;
    IF EXISTS (SELECT 1 FROM "Order" WHERE "locationId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "FinancialMovement" WHERE "locationId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "InventoryMovement" WHERE "locationId" = OLD.id)
       OR EXISTS (SELECT 1 FROM "CustomerLedgerEntry" WHERE "locationId" = OLD.id) THEN
      RAISE EXCEPTION 'FIRM_MISMATCH: a shop with records stays with its firm';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER order_firm_stays BEFORE UPDATE OF "firmId" ON "Order" FOR EACH ROW EXECUTE FUNCTION firm_stays();
CREATE TRIGGER location_firm_stays BEFORE UPDATE OF "firmId" ON "Location" FOR EACH ROW EXECUTE FUNCTION firm_stays();
