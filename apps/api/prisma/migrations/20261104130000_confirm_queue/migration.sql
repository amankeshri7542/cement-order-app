SET lock_timeout = '5s';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'AWAITING_CONFIRMATION' BEFORE 'CONFIRMED';

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 2;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "managerRateCapPercent" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "sendAfter" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedById" TEXT,
ADD COLUMN     "decisionHoldUntil" TIMESTAMP(3),
ADD COLUMN     "decisionKey" TEXT,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "listPricePaise" INTEGER;
UPDATE "OrderItem" SET "listPricePaise" = "pricePaise";
ALTER TABLE "OrderItem" ALTER COLUMN "listPricePaise" SET NOT NULL;

-- AlterTable
ALTER TABLE "PushActionToken" ADD COLUMN     "orderId" TEXT,
ADD COLUMN     "orderVersion" INTEGER;

-- CreateTable
CREATE TABLE "OrderAmendment" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderAmendment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderAmendment_orderId_version_key" ON "OrderAmendment"("orderId", "version");

-- AddForeignKey
ALTER TABLE "OrderAmendment" ADD CONSTRAINT "OrderAmendment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Inbox reads the waiting orders of a shop, oldest first.
CREATE INDEX "Order_locationId_status_createdAt_idx" ON "Order"("locationId", "status", "createdAt");

-- The owners decide how far a manager may go, and no further than this.
ALTER TABLE "Location" ADD CONSTRAINT "location_rate_cap" CHECK ("managerRateCapPercent" BETWEEN 0 AND 50);
ALTER TABLE "OrderItem" ADD CONSTRAINT "order_item_list_price" CHECK ("listPricePaise" > 0);

-- What changed on an order is history.
CREATE FUNCTION protect_order_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Order amendments are append-only'; END;
$$;
CREATE TRIGGER order_amendment_append_only BEFORE UPDATE OR DELETE ON "OrderAmendment"
FOR EACH ROW EXECUTE FUNCTION protect_order_amendment();

-- A customer's message taken back during the hold.
ALTER TABLE "OutboundMessage" DROP CONSTRAINT "OutboundMessage_status_check";
ALTER TABLE "OutboundMessage" ADD CONSTRAINT "OutboundMessage_status_check"
  CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED', 'CANCELLED'));
