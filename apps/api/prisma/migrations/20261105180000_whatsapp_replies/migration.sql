-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'WHATSAPP';

-- AlterTable
ALTER TABLE "WaSettings" ADD COLUMN     "nightFromHour" INTEGER NOT NULL DEFAULT 21,
ADD COLUMN     "nightToHour" INTEGER NOT NULL DEFAULT 7,
ADD COLUMN     "quietMinutes" INTEGER NOT NULL DEFAULT 45,
ADD COLUMN     "replyStage" TEXT NOT NULL DEFAULT 'OFF',
ADD COLUMN     "stageMovedAt" TIMESTAMP(3),
ADD COLUMN     "stageMovedById" TEXT,
ADD COLUMN     "testNumbers" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "WaThread" ADD COLUMN     "handoffUntil" TIMESTAMP(3),
ADD COLUMN     "language" TEXT NOT NULL DEFAULT 'hinglish',
ADD COLUMN     "noticeAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WaDraft" (
    "id" TEXT NOT NULL,
    "threadId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "version" INTEGER NOT NULL DEFAULT 1,
    "locationId" TEXT NOT NULL DEFAULT 'loc_main',
    "orderedByName" TEXT NOT NULL DEFAULT '',
    "orderedByPhone" TEXT,
    "payWhen" TEXT NOT NULL DEFAULT 'UNSET',
    "payerUserId" TEXT,
    "payerWords" TEXT NOT NULL DEFAULT '',
    "paymentWords" TEXT NOT NULL DEFAULT '',
    "originalText" TEXT,
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "lines" JSONB NOT NULL,
    "placeText" TEXT NOT NULL DEFAULT '',
    "pincode" TEXT,
    "fulfilment" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "dayKind" TEXT NOT NULL DEFAULT 'UNSPECIFIED',
    "deliveryDate" TEXT,
    "timeWish" TEXT NOT NULL DEFAULT '',
    "band" TEXT,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reader" TEXT NOT NULL DEFAULT 'none',
    "readerError" TEXT,
    "messageIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdById" TEXT,
    "pasteKey" TEXT,
    "asked" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "papaRepliedAt" TIMESTAMP(3),
    "lastWaitingAt" TIMESTAMP(3),
    "orderId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "refuseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaDraftEvent" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "change" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaDraftEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaReply" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "draftId" TEXT,
    "runId" TEXT,
    "dedupeKey" TEXT NOT NULL,
    "class" TEXT NOT NULL,
    "actorId" TEXT,
    "kind" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'hinglish',
    "body" TEXT,
    "buttons" JSONB,
    "template" TEXT,
    "templateParams" JSONB,
    "forceTemplate" BOOLEAN NOT NULL DEFAULT false,
    "triggerAt" TIMESTAMP(3),
    "quietOk" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "skipReason" TEXT,
    "failedCode" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseUntil" TIMESTAMP(3),
    "providerId" TEXT,
    "viaTemplate" BOOLEAN NOT NULL DEFAULT false,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WaReply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaLoadSize" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaLoadSize_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaCallTally" (
    "period" TEXT NOT NULL,
    "days" INTEGER NOT NULL DEFAULT 3,
    "calls" INTEGER NOT NULL,
    "orders" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaCallTally_pkey" PRIMARY KEY ("period")
);

-- CreateIndex
CREATE UNIQUE INDEX "WaDraft_pasteKey_key" ON "WaDraft"("pasteKey");

-- CreateIndex
CREATE UNIQUE INDEX "WaDraft_orderId_key" ON "WaDraft"("orderId");

-- CreateIndex
CREATE INDEX "WaDraft_status_createdAt_idx" ON "WaDraft"("status", "createdAt");

-- CreateIndex
CREATE INDEX "WaDraft_threadId_status_idx" ON "WaDraft"("threadId", "status");

-- CreateIndex
CREATE INDEX "WaDraft_locationId_status_idx" ON "WaDraft"("locationId", "status");

-- CreateIndex
CREATE INDEX "WaDraftEvent_draftId_version_idx" ON "WaDraftEvent"("draftId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "WaReply_dedupeKey_key" ON "WaReply"("dedupeKey");

-- CreateIndex
CREATE INDEX "WaReply_status_nextAttemptAt_idx" ON "WaReply"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "WaReply_threadId_createdAt_idx" ON "WaReply"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "WaReply_providerId_idx" ON "WaReply"("providerId");

-- CreateIndex
CREATE INDEX "WaReply_createdAt_idx" ON "WaReply"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WaLoadSize_productId_label_key" ON "WaLoadSize"("productId", "label");

-- AddForeignKey
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaDraftEvent" ADD CONSTRAINT "WaDraftEvent_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "WaDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "WaThread"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "WaDraft"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Only the values the code knows, and the locks that keep the AI away from a decision.
ALTER TABLE "WaSettings" ADD CONSTRAINT "WaSettings_stage_check"
  CHECK ("replyStage" IN ('OFF', 'TEST_NUMBERS', 'KNOWN_CUSTOMERS', 'EVERYONE'));
ALTER TABLE "WaSettings" ADD CONSTRAINT "WaSettings_test_numbers_size"
  CHECK (coalesce(array_length("testNumbers", 1), 0) <= 5);
ALTER TABLE "WaSettings" ADD CONSTRAINT "WaSettings_quiet_minutes"
  CHECK ("quietMinutes" BETWEEN 30 AND 60);
ALTER TABLE "WaSettings" ADD CONSTRAINT "WaSettings_night_hours"
  CHECK ("nightFromHour" BETWEEN 0 AND 23 AND "nightToHour" BETWEEN 0 AND 23);
ALTER TABLE "WaThread" ADD CONSTRAINT "WaThread_language_check"
  CHECK ("language" IN ('hinglish', 'hindi', 'english'));

ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_source_check"
  CHECK ("source" IN ('WHATSAPP', 'PASTE'));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_status_check"
  CHECK ("status" IN ('OPEN', 'CONFIRMED', 'REFUSED', 'CANCELLED', 'EXPIRED'));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_band_check"
  CHECK ("band" IS NULL OR "band" IN ('GREEN', 'AMBER', 'RED'));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_pay_when_check"
  CHECK ("payWhen" IN ('UNSET', 'PAID_NOW', 'AT_DELIVERY', 'UDHAAR'));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_text_size"
  CHECK ("originalText" IS NULL OR char_length("originalText") <= 2000);
-- A pasted card always says who pasted it.
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_paste_has_a_person"
  CHECK ("source" <> 'PASTE' OR "createdById" IS NOT NULL);
-- No order without an order, a person and a time. Nothing automatic can reach these columns.
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_confirmed_by_a_person"
  CHECK ("status" <> 'CONFIRMED' OR (
    "orderId" IS NOT NULL AND "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
    AND "decidedById" NOT IN ('whatsapp', 'whatsapp-ai', 'system')
  ));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_refused_by_a_person"
  CHECK ("status" <> 'REFUSED' OR (
    "decidedAt" IS NOT NULL AND "decidedById" IS NOT NULL
    AND "decidedById" NOT IN ('whatsapp', 'whatsapp-ai', 'system')
  ));
ALTER TABLE "WaDraft" ADD CONSTRAINT "WaDraft_order_only_when_confirmed"
  CHECK ("orderId" IS NULL OR "status" = 'CONFIRMED');
-- One open draft per chat. New words become a change to it.
CREATE UNIQUE INDEX "WaDraft_one_open_per_thread" ON "WaDraft" ("threadId")
  WHERE "status" = 'OPEN' AND "threadId" IS NOT NULL;

ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_class_check"
  CHECK ("class" IN ('AI_REPLY', 'HUMAN_DECISION'));
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_status_check"
  CHECK ("status" IN ('QUEUED', 'SENDING', 'SENT', 'SKIPPED', 'FAILED'));
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_language_check"
  CHECK ("language" IN ('hinglish', 'hindi', 'english'));
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_body_size"
  CHECK ("body" IS NULL OR char_length("body") <= 1024);
-- The AI cannot say a decision, and a decision always names the person who took it.
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_ai_never_decides"
  CHECK ("class" <> 'AI_REPLY' OR (
    "actorId" IS NULL AND "kind" NOT IN ('CONFIRMED', 'CONFIRMED_CHANGED', 'REFUSED')
  ));
ALTER TABLE "WaReply" ADD CONSTRAINT "WaReply_decision_has_a_person"
  CHECK ("class" <> 'HUMAN_DECISION' OR (
    "actorId" IS NOT NULL AND "actorId" NOT IN ('whatsapp', 'whatsapp-ai', 'system')
    AND "kind" IN ('CONFIRMED', 'CONFIRMED_CHANGED', 'REFUSED')
  ));

ALTER TABLE "WaLoadSize" ADD CONSTRAINT "WaLoadSize_quantity_check"
  CHECK ("quantity" BETWEEN 1 AND 100000);
ALTER TABLE "WaCallTally" ADD CONSTRAINT "WaCallTally_period_check"
  CHECK ("period" IN ('BASELINE', 'WEEK_2', 'WEEK_4', 'WEEK_8'));
ALTER TABLE "WaCallTally" ADD CONSTRAINT "WaCallTally_counts_check"
  CHECK ("calls" >= 0 AND "orders" >= 0 AND "days" BETWEEN 1 AND 31);
