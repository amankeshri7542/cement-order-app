-- CreateEnum
CREATE TYPE "FollowUpKind" AS ENUM ('PAYMENT', 'ORDER', 'CALLBACK', 'OTHER');

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 8;

-- AlterTable
ALTER TABLE "CustomerContact" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'OTHER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "khataViewOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "remindersStoppedAt" TIMESTAMP(3),
ADD COLUMN     "remindersStoppedById" TEXT;

-- CreateTable
CREATE TABLE "FollowUp" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "dueOn" TEXT NOT NULL,
    "kind" "FollowUpKind" NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "assigneeId" TEXT,
    "promisedPaise" INTEGER,
    "snoozes" INTEGER NOT NULL DEFAULT 0,
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FollowUpEvent" (
    "id" TEXT NOT NULL,
    "followUpId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "fromDueOn" TEXT,
    "toDueOn" TEXT,
    "fromAssigneeId" TEXT,
    "toAssigneeId" TEXT,
    "reason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FollowUpEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataOpeningDraft" (
    "customerId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "paperPaise" INTEGER NOT NULL,
    "tallyPaise" BIGINT,
    "tallyAsOf" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "enteredById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhataOpeningDraft_pkey" PRIMARY KEY ("customerId")
);

-- CreateTable
CREATE TABLE "KhataSignoff" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "asOf" TEXT NOT NULL,
    "paperPaise" INTEGER,
    "tallyPaise" BIGINT,
    "chosenPaise" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "enteredById" TEXT NOT NULL,
    "approvedById" TEXT NOT NULL,
    "ledgerEntryId" TEXT,
    "requestHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhataSignoff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportOpen" (
    "report" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "opens" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "ReportOpen_pkey" PRIMARY KEY ("report","day","userId")
);

-- CreateIndex
CREATE INDEX "FollowUp_locationId_doneAt_dueOn_idx" ON "FollowUp"("locationId", "doneAt", "dueOn");

-- CreateIndex
CREATE INDEX "FollowUp_assigneeId_doneAt_dueOn_idx" ON "FollowUp"("assigneeId", "doneAt", "dueOn");

-- CreateIndex
CREATE INDEX "FollowUp_customerId_createdAt_id_idx" ON "FollowUp"("customerId", "createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUp_customerId_idempotencyKey_key" ON "FollowUp"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "FollowUpEvent_followUpId_createdAt_idx" ON "FollowUpEvent"("followUpId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FollowUpEvent_followUpId_idempotencyKey_key" ON "FollowUpEvent"("followUpId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "KhataSignoff_ledgerEntryId_key" ON "KhataSignoff"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "KhataSignoff_createdAt_id_idx" ON "KhataSignoff"("createdAt", "id");

-- CreateIndex
CREATE UNIQUE INDEX "KhataSignoff_customerId_firmId_key" ON "KhataSignoff"("customerId", "firmId");

-- CreateIndex
CREATE INDEX "ReportOpen_report_day_idx" ON "ReportOpen"("report", "day");

-- CreateIndex
CREATE INDEX "CustomerContact_customerId_kind_createdAt_idx" ON "CustomerContact"("customerId", "kind", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CustomerContact_customerId_idempotencyKey_key" ON "CustomerContact"("customerId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "User_lastOrderAt_idx" ON "User"("lastOrderAt");

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUp" ADD CONSTRAINT "FollowUp_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FollowUpEvent" ADD CONSTRAINT "FollowUpEvent_followUpId_fkey" FOREIGN KEY ("followUpId") REFERENCES "FollowUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataOpeningDraft" ADD CONSTRAINT "KhataOpeningDraft_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KhataSignoff" ADD CONSTRAINT "KhataSignoff_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A signed opening is never changed. A wrong one is corrected by a visible khata entry.
CREATE TRIGGER khata_signoff_append_only BEFORE UPDATE OR DELETE ON "KhataSignoff" FOR EACH ROW EXECUTE FUNCTION append_only_row();
