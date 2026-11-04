SET lock_timeout = '5s';

-- CreateEnum
CREATE TYPE "StockMode" AS ENUM ('COUNTED', 'AVAILABILITY');

-- CreateEnum
CREATE TYPE "Sourcing" AS ENUM ('STOCKED', 'ON_REQUEST');

-- CreateEnum
CREATE TYPE "SessionSurface" AS ENUM ('CUSTOMER', 'DESK', 'STAFF_APP');

-- CreateEnum
CREATE TYPE "StaffRole" AS ENUM ('OWNER', 'MANAGER', 'CASHIER', 'ACCOUNTANT', 'STOCK_KEEPER', 'DRIVER', 'HELPER', 'TECH_OPERATOR');

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "locationId" TEXT,
ADD COLUMN     "permissionsVersion" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "CustomerLedgerEntry" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "DeliveryZone" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "FinancialMovement" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "InventoryMovement" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "deliveredAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "sourcing" "Sourcing" NOT NULL DEFAULT 'STOCKED',
ADD COLUMN     "stockMode" "StockMode" NOT NULL DEFAULT 'COUNTED';

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "locationId" TEXT NOT NULL DEFAULT 'loc_main';

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "surface" "SessionSurface" NOT NULL DEFAULT 'CUSTOMER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "staffPausedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Firm" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT NOT NULL DEFAULT '',
    "gstin" TEXT,
    "complaintOfficerName" TEXT NOT NULL DEFAULT '',
    "complaintOfficerPhone" TEXT NOT NULL DEFAULT '',
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Firm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stockStartedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLevel" (
    "productId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 0,
    "lowStockAt" INTEGER NOT NULL DEFAULT 25,
    "isOn" BOOLEAN NOT NULL DEFAULT true,
    "countedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockLevel_pkey" PRIMARY KEY ("productId","locationId")
);

-- CreateTable
CREATE TABLE "StaffMembership" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "role" "StaffRole" NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "grantedById" TEXT NOT NULL,
    "endedById" TEXT,

    CONSTRAINT "StaffMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PushActionToken" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PushActionToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "lane" TEXT NOT NULL,
    "lastRunAt" TIMESTAMP(3) NOT NULL,
    "lastOkAt" TIMESTAMP(3),
    "lastStep" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("lane")
);

-- CreateIndex
CREATE UNIQUE INDEX "Location_slug_key" ON "Location"("slug");

-- CreateIndex
CREATE INDEX "StockLevel_locationId_quantity_idx" ON "StockLevel"("locationId", "quantity");

-- CreateIndex
CREATE INDEX "StaffMembership_userId_endedAt_idx" ON "StaffMembership"("userId", "endedAt");

-- CreateIndex
CREATE INDEX "StaffMembership_locationId_role_endedAt_idx" ON "StaffMembership"("locationId", "role", "endedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PushActionToken_tokenHash_key" ON "PushActionToken"("tokenHash");

-- CreateIndex
CREATE INDEX "PushActionToken_expiresAt_idx" ON "PushActionToken"("expiresAt");

-- The one firm and one shop that every existing row belongs to.
INSERT INTO "Firm" ("id", "legalName", "tradeName") VALUES ('firm_main', 'Shiv Cement Store', 'Shiv Cement');
INSERT INTO "Location" ("id", "firmId", "slug", "name", "stockStartedAt", "updatedAt")
VALUES ('loc_main', 'firm_main', 'main', 'Main shop', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialMovement" ADD CONSTRAINT "FinancialMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "DeliveryZone_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_firmId_fkey" FOREIGN KEY ("firmId") REFERENCES "Firm"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockLevel" ADD CONSTRAINT "StockLevel_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StaffMembership" ADD CONSTRAINT "StaffMembership_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushActionToken" ADD CONSTRAINT "PushActionToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quantity stays in the range moveStock has always enforced.
ALTER TABLE "StockLevel" ADD CONSTRAINT "stock_level_quantity" CHECK ("quantity" BETWEEN 0 AND 1000000);

-- All-shop roles hold a membership with no shop, and every other role names one.
ALTER TABLE "StaffMembership" ADD CONSTRAINT "staff_membership_scope"
  CHECK (("role" IN ('OWNER', 'ACCOUNTANT', 'TECH_OPERATOR')) = ("locationId" IS NULL));
CREATE UNIQUE INDEX "StaffMembership_active_key"
  ON "StaffMembership" ("userId", COALESCE("locationId", '*')) WHERE "endedAt" IS NULL;

-- Existing stock moves to the main shop, and existing staff become owners, as they had full access.
INSERT INTO "StockLevel" ("productId", "locationId", "quantity", "lowStockAt", "updatedAt")
SELECT "id", 'loc_main', "stock", "lowStockAt", CURRENT_TIMESTAMP FROM "Product";
INSERT INTO "StaffMembership" ("id", "userId", "locationId", "role", "grantedById")
SELECT 'mbr_' || "id", "id", NULL, 'OWNER', "id" FROM "User" WHERE "role" = 'ADMIN' AND "deletedAt" IS NULL;
UPDATE "Session" SET "surface" = 'DESK' WHERE "userId" IN (SELECT "id" FROM "User" WHERE "role" = 'ADMIN');

-- Who held what is history: a membership can only be ended, once, and never deleted.
CREATE FUNCTION protect_staff_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Staff memberships are never deleted'; END IF;
  IF OLD."endedAt" IS NOT NULL OR NEW."endedAt" IS NULL
    OR (NEW."id", NEW."userId", NEW."locationId", NEW."role", NEW."startedAt", NEW."grantedById")
       IS DISTINCT FROM (OLD."id", OLD."userId", OLD."locationId", OLD."role", OLD."startedAt", OLD."grantedById")
  THEN RAISE EXCEPTION 'A staff membership can only be ended'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER staff_membership_protected BEFORE UPDATE OR DELETE ON "StaffMembership"
FOR EACH ROW EXECUTE FUNCTION protect_staff_membership();

-- The activity log promises it cannot be changed, so now it cannot.
CREATE FUNCTION protect_audit_log() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Audit entries are append-only'; END;
$$;
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION protect_audit_log();

-- Bridge until every writer knows about shops: a change made only to Product.stock lands on the
-- main shop. moveStock updates the right StockLevel itself and sets shiv.stock_direct to skip this.
CREATE FUNCTION product_stock_bridge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('shiv.stock_direct', true) = 'on' THEN RETURN NEW; END IF;
  INSERT INTO "StockLevel" ("productId", "locationId", "quantity", "lowStockAt", "updatedAt")
  VALUES (NEW."id", 'loc_main', NEW."stock", NEW."lowStockAt", CURRENT_TIMESTAMP)
  ON CONFLICT ("productId", "locationId") DO UPDATE
  SET "quantity" = GREATEST(0, NEW."stock" - COALESCE((
        SELECT SUM("quantity") FROM "StockLevel" o
        WHERE o."productId" = NEW."id" AND o."locationId" <> 'loc_main'), 0)),
      "lowStockAt" = NEW."lowStockAt",
      "updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
CREATE TRIGGER product_stock_bridge AFTER INSERT OR UPDATE OF "stock", "lowStockAt" ON "Product"
FOR EACH ROW EXECUTE FUNCTION product_stock_bridge();

-- No real phone number as a default: the shop's number comes from the family, once approved.
ALTER TABLE "StoreSettings" ALTER COLUMN "phone" SET DEFAULT '';
UPDATE "StoreSettings" SET "phone" = '';
