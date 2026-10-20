-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('SALE_ON_CREDIT', 'PAYMENT_RECEIVED', 'OPENING_BALANCE', 'ADJUSTMENT', 'REVERSAL');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "area" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "creditAllowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "creditLimitPaise" INTEGER,
ADD COLUMN     "khataBalancePaise" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastOrderAt" TIMESTAMP(3),
ADD COLUMN     "notesCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "CustomerLedgerEntry" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "orderId" TEXT,
    "financialMovementId" TEXT,
    "reversesId" TEXT,
    "note" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT,
    "requestHash" TEXT,

    CONSTRAINT "CustomerLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerNote" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerEntry_orderId_key" ON "CustomerLedgerEntry"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerEntry_financialMovementId_key" ON "CustomerLedgerEntry"("financialMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerEntry_reversesId_key" ON "CustomerLedgerEntry"("reversesId");

-- CreateIndex
CREATE INDEX "CustomerLedgerEntry_customerId_createdAt_id_idx" ON "CustomerLedgerEntry"("customerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerLedgerEntry_customerId_idempotencyKey_key" ON "CustomerLedgerEntry"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CustomerNote_customerId_createdAt_id_idx" ON "CustomerNote"("customerId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_createdAt_id_idx" ON "CustomerContact"("customerId", "createdAt", "id");

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_financialMovementId_fkey" FOREIGN KEY ("financialMovementId") REFERENCES "FinancialMovement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "CustomerLedgerEntry_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "CustomerLedgerEntry"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "CustomerNote" ADD CONSTRAINT "CustomerNote_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Keep existing customer recency when introducing the cache.
UPDATE "User" u SET "lastOrderAt" = o.latest FROM
  (SELECT "userId", MAX("createdAt") AS latest FROM "Order" GROUP BY "userId") o
  WHERE u.id = o."userId";

ALTER TABLE "User" ADD CONSTRAINT "customer_credit_values" CHECK (
  ("creditLimitPaise" IS NULL OR "creditLimitPaise" BETWEEN 0 AND 2000000000)
  AND (NOT "creditAllowed" OR "creditLimitPaise" IS NOT NULL)
  AND "khataBalancePaise" BETWEEN -2000000000 AND 2000000000 AND "notesCount" >= 0
);
ALTER TABLE "CustomerLedgerEntry" ADD CONSTRAINT "ledger_values" CHECK (
  "amountPaise" BETWEEN -2000000000 AND 2000000000 AND "amountPaise" <> 0
  AND "balanceAfterPaise" BETWEEN -2000000000 AND 2000000000
  AND (("kind" = 'REVERSAL') = ("reversesId" IS NOT NULL))
  AND (("kind" = 'SALE_ON_CREDIT') = ("orderId" IS NOT NULL))
  AND ("kind" <> 'SALE_ON_CREDIT' OR "amountPaise" > 0)
  AND ("kind" <> 'PAYMENT_RECEIVED' OR ("amountPaise" < 0 AND "financialMovementId" IS NOT NULL))
);
CREATE UNIQUE INDEX "CustomerLedgerEntry_opening_balance_key" ON "CustomerLedgerEntry"("customerId")
  WHERE "kind" = 'OPENING_BALANCE';
CREATE FUNCTION protect_customer_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Customer ledger entries are immutable'; END;
$$;
CREATE TRIGGER customer_ledger_immutable BEFORE UPDATE OR DELETE ON "CustomerLedgerEntry"
FOR EACH ROW EXECUTE FUNCTION protect_customer_ledger();

