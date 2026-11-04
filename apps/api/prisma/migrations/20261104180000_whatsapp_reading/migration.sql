-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 3;

-- CreateTable
CREATE TABLE "WaThread" (
    "id" TEXT NOT NULL,
    "contactKey" TEXT NOT NULL,
    "phone" TEXT,
    "bsuid" TEXT,
    "profileName" TEXT NOT NULL DEFAULT '',
    "savedName" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "aiMode" TEXT NOT NULL DEFAULT 'AUTO',
    "humanUntil" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastEchoAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "leaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaMessage" (
    "id" TEXT NOT NULL,
    "wamid" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "text" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "editedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "WaMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaReaderRun" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "messageIds" TEXT[],
    "reader" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL DEFAULT '',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "output" JSONB,
    "intent" TEXT,
    "band" TEXT,
    "wouldReply" TEXT,
    "errorCode" TEXT,
    "review" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaReaderRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaSettings" (
    "id" TEXT NOT NULL DEFAULT 'wa',
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "pausedById" TEXT,
    "pausedAt" TIMESTAMP(3),
    "lastWebhookAt" TIMESTAMP(3),
    "lastAccount" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaThread_contactKey_key" ON "WaThread"("contactKey");

-- CreateIndex
CREATE UNIQUE INDEX "WaThread_phone_key" ON "WaThread"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "WaThread_bsuid_key" ON "WaThread"("bsuid");

-- CreateIndex
CREATE INDEX "WaThread_nextRunAt_idx" ON "WaThread"("nextRunAt");

-- CreateIndex
CREATE INDEX "WaThread_lastEchoAt_idx" ON "WaThread"("lastEchoAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaMessage_wamid_key" ON "WaMessage"("wamid");

-- CreateIndex
CREATE INDEX "WaMessage_threadId_sentAt_idx" ON "WaMessage"("threadId", "sentAt");

-- CreateIndex
CREATE INDEX "WaMessage_state_threadId_idx" ON "WaMessage"("state", "threadId");

-- CreateIndex
CREATE INDEX "WaMessage_receivedAt_idx" ON "WaMessage"("receivedAt");

-- CreateIndex
CREATE INDEX "WaReaderRun_threadId_createdAt_idx" ON "WaReaderRun"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WaReaderRun_review_createdAt_idx" ON "WaReaderRun"("review", "createdAt");

-- CreateIndex
CREATE INDEX "WaReaderRun_createdAt_idx" ON "WaReaderRun"("createdAt");

-- AddForeignKey
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaReaderRun" ADD CONSTRAINT "WaReaderRun_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One row, and only the values the code knows. A wrong value should fail loudly here.
ALTER TABLE "WaSettings" ADD CONSTRAINT "WaSettings_one_row" CHECK ("id" = 'wa');
INSERT INTO "WaSettings" ("id", "updatedAt") VALUES ('wa', CURRENT_TIMESTAMP);
ALTER TABLE "WaThread" ADD CONSTRAINT "WaThread_aiMode_check"
  CHECK ("aiMode" IN ('AUTO', 'OFF', 'OPTED_OUT'));
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_direction_check"
  CHECK ("direction" IN ('IN', 'ECHO'));
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_state_check"
  CHECK ("state" IN ('RECEIVED', 'READ', 'GATED'));
-- A message that was gated keeps no words, whatever the code does.
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_gated_has_no_text"
  CHECK ("state" <> 'GATED' OR "text" IS NULL);
-- Papa's typed replies are never kept while reading silently.
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_echo_has_no_text"
  CHECK ("direction" <> 'ECHO' OR "text" IS NULL);
ALTER TABLE "WaMessage" ADD CONSTRAINT "WaMessage_text_size"
  CHECK ("text" IS NULL OR char_length("text") <= 2000);
ALTER TABLE "WaReaderRun" ADD CONSTRAINT "WaReaderRun_band_check"
  CHECK ("band" IS NULL OR "band" IN ('GREEN', 'AMBER', 'RED'));
ALTER TABLE "WaReaderRun" ADD CONSTRAINT "WaReaderRun_review_check"
  CHECK ("review" IS NULL OR "review" IN
    ('RIGHT', 'WRONG_INTENT', 'WRONG_LINES', 'SHOULD_BE_SILENT', 'MISSED_ORDER'));
