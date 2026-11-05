-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 7;

-- CreateTable
CREATE TABLE "TallyDevice" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "publicKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "pausedAt" TIMESTAMP(3),
    "lastHeartbeatAt" TIMESTAMP(3),
    "lastWakeAt" TIMESTAMP(3),
    "lastGoodAt" TIMESTAMP(3),
    "state" TEXT NOT NULL DEFAULT 'NEW',
    "stateSince" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" TEXT NOT NULL DEFAULT '',
    "os" TEXT NOT NULL DEFAULT '',
    "caps" JSONB NOT NULL DEFAULT '{}',
    "lastSeq" BIGINT NOT NULL DEFAULT 0,
    "targetVersion" TEXT,

    CONSTRAINT "TallyDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyPairingCode" (
    "hash" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "locationId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByDeviceId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyPairingCode_pkey" PRIMARY KEY ("hash")
);

-- CreateTable
CREATE TABLE "TallyCompany" (
    "id" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firmId" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PENDING',
    "ownerDeviceId" TEXT,
    "bookFamily" TEXT NOT NULL DEFAULT '',
    "booksFrom" TEXT,
    "lastVoucherDate" TEXT,
    "altMstId" BIGINT NOT NULL DEFAULT 0,
    "altVchId" BIGINT NOT NULL DEFAULT 0,
    "wmMstId" BIGINT NOT NULL DEFAULT 0,
    "wmVchId" BIGINT NOT NULL DEFAULT 0,
    "marksChangedAt" TIMESTAMP(3),
    "marksFirstChangedAt" TIMESTAMP(3),
    "freshAt" TIMESTAMP(3),
    "phase" TEXT NOT NULL DEFAULT 'MASTERS',
    "copyFrom" TEXT,
    "backfillCursor" TEXT,
    "backfillWindowDays" INTEGER NOT NULL DEFAULT 7,
    "lastSweepOn" TEXT,
    "lastRereadOn" TEXT,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "lastFailureAt" TIMESTAMP(3),
    "lastError" TEXT,
    "rewrittenAt" TIMESTAMP(3),
    "sameNameAsId" TEXT,
    "tieOut" JSONB,
    "tieOutAt" TIMESTAMP(3),
    "reconDue" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallySyncJob" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reads" JSONB NOT NULL,
    "params" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "leaseUntil" TIMESTAMP(3),
    "report" JSONB,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "uploadedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "TallySyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyChunk" (
    "jobId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "parsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyChunk_pkey" PRIMARY KEY ("jobId","seq")
);

-- CreateTable
CREATE TABLE "TallyGroup" (
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "alterId" BIGINT NOT NULL DEFAULT 0,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TallyGroup_pkey" PRIMARY KEY ("companyId","guid")
);

-- CreateTable
CREATE TABLE "TallyVoucherType" (
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',
    "baseType" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TallyVoucherType_pkey" PRIMARY KEY ("companyId","guid")
);

-- CreateTable
CREATE TABLE "TallyGodown" (
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',
    "locationId" TEXT,

    CONSTRAINT "TallyGodown_pkey" PRIMARY KEY ("companyId","guid")
);

-- CreateTable
CREATE TABLE "TallyLedger" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "masterId" TEXT,
    "alterId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "gstin" TEXT,
    "billWise" BOOLEAN NOT NULL DEFAULT false,
    "openingPaise" BIGINT,
    "closingPaise" BIGINT,
    "closingAsOf" TIMESTAMP(3),
    "baselinePaise" BIGINT,
    "baselineOn" TEXT,
    "tieOutOk" BOOLEAN,
    "tieOutGapPaise" BIGINT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyLedger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyStockItem" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "alterId" BIGINT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',
    "baseUnits" TEXT NOT NULL DEFAULT '',
    "closingQtyText" TEXT,
    "closingValuePaise" BIGINT,
    "asOf" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "TallyStockItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyVoucher" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "masterId" TEXT,
    "alterId" BIGINT NOT NULL,
    "date" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT '',
    "baseType" TEXT NOT NULL DEFAULT '',
    "number" TEXT NOT NULL DEFAULT '',
    "party" TEXT NOT NULL DEFAULT '',
    "partyGuid" TEXT,
    "reference" TEXT NOT NULL DEFAULT '',
    "orderRef" TEXT,
    "partyAmountPaise" BIGINT,
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "isCancelled" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TallyVoucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyVoucherLine" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "ledgerGuid" TEXT,
    "ledgerName" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,

    CONSTRAINT "TallyVoucherLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyVoucherItem" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "stockItemName" TEXT NOT NULL,
    "billedQtyText" TEXT NOT NULL DEFAULT '',
    "rateText" TEXT NOT NULL DEFAULT '',
    "amountPaise" BIGINT NOT NULL,

    CONSTRAINT "TallyVoucherItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyVoucherChange" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "oldAlterId" BIGINT,
    "newAlterId" BIGINT,
    "oldAmountPaise" BIGINT,
    "newAmountPaise" BIGINT,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyVoucherChange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TallyPartyLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "guid" TEXT NOT NULL,
    "userId" TEXT,
    "status" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'TYPED',
    "score" INTEGER,
    "confirmedById" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyPartyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataVoucherMatch" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "method" TEXT NOT NULL,
    "confirmedById" TEXT NOT NULL,
    "undoesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KhataVoucherMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KhataRecon" (
    "customerId" TEXT NOT NULL,
    "firmId" TEXT NOT NULL DEFAULT '',
    "appPaise" INTEGER NOT NULL,
    "tallyPaise" BIGINT,
    "differencePaise" BIGINT,
    "unexplainedPaise" BIGINT,
    "reasons" JSONB,
    "tallyAsOf" TIMESTAMP(3),
    "computedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KhataRecon_pkey" PRIMARY KEY ("customerId","firmId")
);

-- CreateTable
CREATE TABLE "TallyRelease" (
    "version" TEXT NOT NULL,
    "manifest" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "files" JSONB NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TallyRelease_pkey" PRIMARY KEY ("version")
);

-- CreateIndex
CREATE UNIQUE INDEX "TallyDevice_publicKey_key" ON "TallyDevice"("publicKey");

-- CreateIndex
CREATE UNIQUE INDEX "TallyCompany_guid_key" ON "TallyCompany"("guid");

-- CreateIndex
CREATE INDEX "TallySyncJob_deviceId_status_idx" ON "TallySyncJob"("deviceId", "status");

-- CreateIndex
CREATE INDEX "TallySyncJob_status_uploadedAt_idx" ON "TallySyncJob"("status", "uploadedAt");

-- CreateIndex
CREATE INDEX "TallySyncJob_companyId_createdAt_idx" ON "TallySyncJob"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "TallyChunk_expiresAt_idx" ON "TallyChunk"("expiresAt");

-- CreateIndex
CREATE INDEX "TallyLedger_companyId_class_deletedAt_idx" ON "TallyLedger"("companyId", "class", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "TallyLedger_companyId_guid_key" ON "TallyLedger"("companyId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "TallyStockItem_companyId_guid_key" ON "TallyStockItem"("companyId", "guid");

-- CreateIndex
CREATE INDEX "TallyVoucher_companyId_date_idx" ON "TallyVoucher"("companyId", "date");

-- CreateIndex
CREATE INDEX "TallyVoucher_companyId_alterId_idx" ON "TallyVoucher"("companyId", "alterId");

-- CreateIndex
CREATE INDEX "TallyVoucher_companyId_orderRef_idx" ON "TallyVoucher"("companyId", "orderRef");

-- CreateIndex
CREATE UNIQUE INDEX "TallyVoucher_companyId_guid_key" ON "TallyVoucher"("companyId", "guid");

-- CreateIndex
CREATE INDEX "TallyVoucherLine_voucherId_idx" ON "TallyVoucherLine"("voucherId");

-- CreateIndex
CREATE INDEX "TallyVoucherLine_ledgerGuid_idx" ON "TallyVoucherLine"("ledgerGuid");

-- CreateIndex
CREATE INDEX "TallyVoucherItem_voucherId_idx" ON "TallyVoucherItem"("voucherId");

-- CreateIndex
CREATE INDEX "TallyVoucherChange_voucherId_idx" ON "TallyVoucherChange"("voucherId");

-- CreateIndex
CREATE INDEX "TallyVoucherChange_companyId_detectedAt_idx" ON "TallyVoucherChange"("companyId", "detectedAt");

-- CreateIndex
CREATE INDEX "TallyPartyLink_userId_idx" ON "TallyPartyLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TallyPartyLink_companyId_guid_key" ON "TallyPartyLink"("companyId", "guid");

-- CreateIndex
CREATE UNIQUE INDEX "KhataVoucherMatch_undoesId_key" ON "KhataVoucherMatch"("undoesId");

-- CreateIndex
CREATE INDEX "KhataVoucherMatch_entryId_idx" ON "KhataVoucherMatch"("entryId");

-- CreateIndex
CREATE INDEX "KhataVoucherMatch_voucherId_idx" ON "KhataVoucherMatch"("voucherId");

-- CreateIndex
CREATE INDEX "KhataRecon_computedAt_idx" ON "KhataRecon"("computedAt");

-- AddForeignKey
ALTER TABLE "TallyCompany" ADD CONSTRAINT "TallyCompany_ownerDeviceId_fkey" FOREIGN KEY ("ownerDeviceId") REFERENCES "TallyDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallySyncJob" ADD CONSTRAINT "TallySyncJob_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "TallyDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallySyncJob" ADD CONSTRAINT "TallySyncJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "TallyCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyChunk" ADD CONSTRAINT "TallyChunk_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "TallySyncJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyLedger" ADD CONSTRAINT "TallyLedger_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "TallyCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyVoucher" ADD CONSTRAINT "TallyVoucher_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "TallyCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyVoucherLine" ADD CONSTRAINT "TallyVoucherLine_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "TallyVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyVoucherItem" ADD CONSTRAINT "TallyVoucherItem_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "TallyVoucher"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyPartyLink" ADD CONSTRAINT "TallyPartyLink_companyId_guid_fkey" FOREIGN KEY ("companyId", "guid") REFERENCES "TallyLedger"("companyId", "guid") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TallyPartyLink" ADD CONSTRAINT "TallyPartyLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Written by hand: what the schema file cannot say.
ALTER TABLE "TallyCompany" ADD CONSTRAINT "tally_company_role" CHECK ("role" IN ('PENDING', 'PRIMARY', 'BRANCH_COPY', 'IGNORE'));
ALTER TABLE "TallyCompany" ADD CONSTRAINT "tally_company_phase" CHECK ("phase" IN ('MASTERS', 'BASELINE', 'BACKFILL', 'LIVE'));
ALTER TABLE "TallySyncJob" ADD CONSTRAINT "tally_job_status" CHECK ("status" IN ('QUEUED', 'LEASED', 'UPLOADED', 'INGESTING', 'APPLIED', 'FAILED', 'EXPIRED'));
ALTER TABLE "TallyLedger" ADD CONSTRAINT "tally_ledger_class" CHECK ("class" IN ('DEBTOR', 'CREDITOR'));
ALTER TABLE "TallyPartyLink" ADD CONSTRAINT "tally_link_status" CHECK ("status" IN ('LINKED', 'UNLINKED', 'NOT_CUSTOMER'));
-- A link that says LINKED always names someone, and any other link names nobody.
ALTER TABLE "TallyPartyLink" ADD CONSTRAINT "tally_link_user" CHECK (("status" = 'LINKED') = ("userId" IS NOT NULL));

CREATE INDEX "TallyLedger_name_trgm_idx" ON "TallyLedger" USING gin ("name" gin_trgm_ops);

CREATE TRIGGER tally_voucher_change_append_only BEFORE UPDATE OR DELETE ON "TallyVoucherChange" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER khata_voucher_match_append_only BEFORE UPDATE OR DELETE ON "KhataVoucherMatch" FOR EACH ROW EXECUTE FUNCTION append_only_row();
