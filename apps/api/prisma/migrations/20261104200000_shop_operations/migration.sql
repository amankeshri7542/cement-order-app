-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('SENT', 'RECEIVED', 'DIFFERENT', 'SETTLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'RECOUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InventoryKind" ADD VALUE 'TRANSFER_OUT';
ALTER TYPE "InventoryKind" ADD VALUE 'TRANSFER_IN';
ALTER TYPE "InventoryKind" ADD VALUE 'OPENING_COUNT';

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 4;

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "fromLocationId" TEXT NOT NULL,
    "toLocationId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'SENT',
    "vehicle" TEXT NOT NULL DEFAULT '',
    "carrierName" TEXT NOT NULL DEFAULT '',
    "note" TEXT NOT NULL DEFAULT '',
    "sentById" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "sentQty" INTEGER NOT NULL,
    "receivedQty" INTEGER,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("transferId","productId")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'OPEN',
    "opening" BOOLEAN NOT NULL DEFAULT false,
    "startedById" TEXT NOT NULL,
    "countedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "countId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "countedQty" INTEGER,
    "systemQty" INTEGER,
    "heldQty" INTEGER,
    "differenceQty" INTEGER,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("countId","productId")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "locationId" TEXT,
    "amountPaise" INTEGER,
    "payload" JSONB NOT NULL,
    "requestedById" TEXT NOT NULL,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "decisionNote" TEXT NOT NULL DEFAULT '',
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DayClose" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "expectedPaise" INTEGER NOT NULL,
    "countedPaise" INTEGER NOT NULL,
    "differencePaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "closedById" TEXT NOT NULL,
    "supersedesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DayClose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GallaEntry" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GallaEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StockTransfer_idempotencyKey_key" ON "StockTransfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockTransfer_status_toLocationId_idx" ON "StockTransfer"("status", "toLocationId");

-- CreateIndex
CREATE INDEX "StockTransfer_fromLocationId_sentAt_idx" ON "StockTransfer"("fromLocationId", "sentAt");

-- CreateIndex
CREATE INDEX "StockCount_locationId_createdAt_idx" ON "StockCount"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalRequest_idempotencyKey_key" ON "ApprovalRequest"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ApprovalRequest_status_locationId_createdAt_idx" ON "ApprovalRequest"("status", "locationId", "createdAt");

-- CreateIndex
CREATE INDEX "ApprovalRequest_requestedById_createdAt_idx" ON "ApprovalRequest"("requestedById", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DayClose_supersedesId_key" ON "DayClose"("supersedesId");

-- CreateIndex
CREATE INDEX "DayClose_locationId_day_idx" ON "DayClose"("locationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "GallaEntry_idempotencyKey_key" ON "GallaEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "GallaEntry_locationId_day_idx" ON "GallaEntry"("locationId", "day");

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_fromLocationId_fkey" FOREIGN KEY ("fromLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_toLocationId_fkey" FOREIGN KEY ("toLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GallaEntry" ADD CONSTRAINT "GallaEntry_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the code should never break, held where the code cannot get round them.
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_two_shops" CHECK ("fromLocationId" <> "toLocationId");
ALTER TABLE "StockTransfer" ADD CONSTRAINT "StockTransfer_two_people" CHECK ("receivedById" IS NULL OR "receivedById" <> "sentById");
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_sent" CHECK ("sentQty" > 0);
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_received" CHECK ("receivedQty" IS NULL OR "receivedQty" >= 0);
ALTER TABLE "StockCount" ADD CONSTRAINT "StockCount_two_people" CHECK ("decidedById" IS NULL OR "countedById" IS NULL OR "status" = 'APPROVED' AND "decidedById" = "countedById" AND "opening" = false OR "decidedById" <> "countedById");
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_counted" CHECK ("countedQty" IS NULL OR "countedQty" >= 0);
-- One count at a time per shop.
CREATE UNIQUE INDEX "StockCount_one_open" ON "StockCount" ("locationId") WHERE "status" IN ('OPEN', 'SUBMITTED');
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_not_own" CHECK ("decidedById" IS NULL OR "decidedById" <> "requestedById");
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_status" CHECK ("status" IN ('PENDING', 'APPROVED', 'REJECTED'));
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_kind" CHECK ("kind" IN ('COUNT_CORRECTION', 'STOCK_DAMAGE', 'TRANSFER_SHORTAGE', 'RATE_CHANGE', 'ORDER_CONFIRM'));
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_sums" CHECK ("differencePaise" = "countedPaise" - "expectedPaise");
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_reason" CHECK ("differencePaise" = 0 OR "reason" <> '');
ALTER TABLE "DayClose" ADD CONSTRAINT "DayClose_counted" CHECK ("countedPaise" >= 0);
ALTER TABLE "GallaEntry" ADD CONSTRAINT "GallaEntry_kind" CHECK ("kind" IN ('PAID_IN', 'PAID_OUT'));
ALTER TABLE "GallaEntry" ADD CONSTRAINT "GallaEntry_amount" CHECK ("amountPaise" > 0);
-- These are records. A correction is a new row, never a changed one.
CREATE FUNCTION append_only_row() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'This record cannot be changed or removed';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER day_close_append_only BEFORE UPDATE OR DELETE ON "DayClose" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER galla_entry_append_only BEFORE UPDATE OR DELETE ON "GallaEntry" FOR EACH ROW EXECUTE FUNCTION append_only_row();
