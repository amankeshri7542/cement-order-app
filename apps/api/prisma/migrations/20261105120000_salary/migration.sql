-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'LOCKED');

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 6;

-- CreateTable
CREATE TABLE "StaffPayTerms" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffPayTerms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayLine" (
    "id" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "slip" JSONB NOT NULL,
    "slipHash" TEXT NOT NULL,
    "netPaise" INTEGER NOT NULL,

    CONSTRAINT "PayLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayAdjustment" (
    "id" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reversesId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffLedgerEntry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "balanceAfterPaise" INTEGER NOT NULL,
    "month" TEXT,
    "channel" TEXT NOT NULL DEFAULT '',
    "paidFrom" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT,
    "utr" TEXT NOT NULL DEFAULT '',
    "recoveryPaise" INTEGER,
    "reversesId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "approvedById" TEXT,
    "serverAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "StaffLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAck" (
    "entryId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAck_pkey" PRIMARY KEY ("entryId")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPayTerms_userId_effectiveFrom_key" ON "StaffPayTerms"("userId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PayRun_month_key" ON "PayRun"("month");

-- CreateIndex
CREATE INDEX "PayLine_userId_idx" ON "PayLine"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayLine_payRunId_userId_key" ON "PayLine"("payRunId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "PayAdjustment_reversesId_key" ON "PayAdjustment"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "PayAdjustment_idempotencyKey_key" ON "PayAdjustment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayAdjustment_month_userId_idx" ON "PayAdjustment"("month", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLedgerEntry_reversesId_key" ON "StaffLedgerEntry"("reversesId");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLedgerEntry_idempotencyKey_key" ON "StaffLedgerEntry"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StaffLedgerEntry_userId_account_serverAt_idx" ON "StaffLedgerEntry"("userId", "account", "serverAt");

-- CreateIndex
CREATE INDEX "StaffLedgerEntry_month_idx" ON "StaffLedgerEntry"("month");

-- CreateIndex
CREATE UNIQUE INDEX "StaffLedgerEntry_stream_seq_key" ON "StaffLedgerEntry"("stream", "seq");

-- AddForeignKey
ALTER TABLE "PayLine" ADD CONSTRAINT "PayLine_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- A record of money is never changed. Mistakes get an opposite entry beside them.
CREATE TRIGGER staff_ledger_append_only BEFORE UPDATE OR DELETE ON "StaffLedgerEntry" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER pay_adjustment_append_only BEFORE UPDATE OR DELETE ON "PayAdjustment" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER pay_line_append_only BEFORE UPDATE OR DELETE ON "PayLine" FOR EACH ROW EXECUTE FUNCTION append_only_row();

ALTER TABLE "StaffPayTerms" ADD CONSTRAINT "StaffPayTerms_amount_positive" CHECK ("amountPaise" > 0);
ALTER TABLE "PayAdjustment" ADD CONSTRAINT "PayAdjustment_amount_positive" CHECK ("amountPaise" >= 0);
-- Nobody approves an advance for themselves.
ALTER TABLE "StaffLedgerEntry" ADD CONSTRAINT "StaffLedgerEntry_not_self_approved" CHECK ("approvedById" IS NULL OR "approvedById" <> "userId");

-- An advance asked for by a manager or cashier goes to an owner, like anything else they cannot do.
ALTER TABLE "ApprovalRequest" DROP CONSTRAINT "ApprovalRequest_kind";
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_kind" CHECK ("kind" IN ('COUNT_CORRECTION', 'STOCK_DAMAGE', 'TRANSFER_SHORTAGE', 'RATE_CHANGE', 'ORDER_CONFIRM', 'ADVANCE'));
