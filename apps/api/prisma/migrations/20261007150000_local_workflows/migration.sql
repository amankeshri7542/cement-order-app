-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'DELIVERY_EXCEPTION';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "quoteId" TEXT,
ADD COLUMN     "quoteRevision" INTEGER;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "deliveryConfirmed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "requestHash" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "dedupeKey" TEXT;

-- CreateTable
CREATE TABLE "OwnerWork" (
    "id" TEXT NOT NULL,
    "orderId" TEXT,
    "quoteId" TEXT,
    "assignedToId" TEXT,
    "technicalOwnerId" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,

    CONSTRAINT "OwnerWork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryAttempt" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "note" TEXT NOT NULL,
    "retryDate" TEXT,
    "items" JSONB,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialMovement" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT,
    "inventoryMovementId" TEXT,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OwnerWork_orderId_key" ON "OwnerWork"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnerWork_quoteId_key" ON "OwnerWork"("quoteId");

-- CreateIndex
CREATE INDEX "OwnerWork_deliveredAt_nextAttemptAt_idx" ON "OwnerWork"("deliveredAt", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryAttempt_orderId_idempotencyKey_key" ON "DeliveryAttempt"("orderId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialMovement_inventoryMovementId_key" ON "FinancialMovement"("inventoryMovementId");

-- CreateIndex
CREATE INDEX "FinancialMovement_occurredAt_kind_idx" ON "FinancialMovement"("occurredAt", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialMovement_paymentId_kind_key" ON "FinancialMovement"("paymentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Order_quoteId_key" ON "Order"("quoteId");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_userId_idempotencyKey_key" ON "Quote"("userId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "Notification_dedupeKey_key" ON "Notification"("dedupeKey");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerWork" ADD CONSTRAINT "OwnerWork_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerWork" ADD CONSTRAINT "OwnerWork_quoteId_fkey" FOREIGN KEY ("quoteId") REFERENCES "Quote"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerWork" ADD CONSTRAINT "OwnerWork_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnerWork" ADD CONSTRAINT "OwnerWork_technicalOwnerId_fkey" FOREIGN KEY ("technicalOwnerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryAttempt" ADD CONSTRAINT "DeliveryAttempt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialMovement" ADD CONSTRAINT "FinancialMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Safe production bootstrap: no stock, service zones or payment credentials.
INSERT INTO "StoreSettings" ("id", "phone", "deliveryFeePaise", "onlinePaymentsEnabled", "deliveryMessage", "version", "updatedAt")
VALUES ('store', '+919297513707', 0, false, 'Contact the store to confirm delivery coverage and charges.', 1, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "OwnerWork" ADD CONSTRAINT "one_work_entity" CHECK (("orderId" IS NULL) <> ("quoteId" IS NULL));
ALTER TABLE "FinancialMovement" ADD CONSTRAINT "financial_amount" CHECK ("amountPaise" >= 0);
INSERT INTO "OwnerWork" ("id", "orderId", "createdAt")
SELECT 'work:order:' || "id", "id", "createdAt" FROM "Order" WHERE "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'REFUND_PENDING');
INSERT INTO "OwnerWork" ("id", "quoteId", "createdAt")
SELECT 'work:quote:' || "id", "id", "createdAt" FROM "Quote" WHERE "status" IN ('REQUESTED', 'SENT', 'ACCEPTED');
-- Backfill only dated, auditable events. Never infer event times from updatedAt.
INSERT INTO "FinancialMovement" ("id", "paymentId", "kind", "amountPaise", "actorId", "occurredAt")
SELECT DISTINCT ON (p."id", CASE WHEN a."event" IN ('COD_RECEIVED', 'PAYMENT_CONFIRMED', 'LATE_PAYMENT_REFUND_REQUIRED') THEN 'COLLECTION' ELSE 'REFUND' END)
 'legacy:' || a."id", p."id",
 CASE WHEN a."event" IN ('COD_RECEIVED', 'PAYMENT_CONFIRMED', 'LATE_PAYMENT_REFUND_REQUIRED') THEN 'COLLECTION' ELSE 'REFUND' END,
 p."amountPaise", a."actorId", a."createdAt"
FROM "AuditLog" a JOIN "Payment" p ON p."orderId" = a."entityId"
WHERE a."event" IN ('COD_RECEIVED', 'PAYMENT_CONFIRMED', 'LATE_PAYMENT_REFUND_REQUIRED', 'CASH_REFUNDED', 'PAYMENT_REFUNDED')
ORDER BY p."id", CASE WHEN a."event" IN ('COD_RECEIVED', 'PAYMENT_CONFIRMED', 'LATE_PAYMENT_REFUND_REQUIRED') THEN 'COLLECTION' ELSE 'REFUND' END, a."createdAt";
CREATE FUNCTION protect_financial_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Financial movements are immutable'; END;
$$;
CREATE TRIGGER financial_movement_immutable BEFORE UPDATE OR DELETE ON "FinancialMovement"
FOR EACH ROW EXECUTE FUNCTION protect_financial_movement();
