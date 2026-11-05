-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 9;

-- CreateTable
CREATE TABLE "KnowledgeArticle" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "number" INTEGER,
    "titleEn" TEXT NOT NULL,
    "titleHinglish" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "aliases" TEXT[],
    "aliasText" TEXT NOT NULL DEFAULT '',
    "stages" TEXT[],
    "materials" TEXT[],
    "relatedQuestions" JSONB NOT NULL DEFAULT '[]',
    "standardsMentioned" TEXT[],
    "bodyEn" TEXT NOT NULL,
    "bodyHinglish" TEXT,
    "sha256" TEXT NOT NULL,
    "reviewerKey" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KnowledgeArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnowledgeChunk" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "articleVersion" INTEGER NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "anchor" TEXT NOT NULL,
    "heading" TEXT NOT NULL,
    "blocks" JSONB NOT NULL,
    "body" TEXT NOT NULL,
    "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('english'::regconfig, "heading" || ' ' || "body")) STORED,

    CONSTRAINT "KnowledgeChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorConversation" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "turns" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorTurn" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "clientTurnId" TEXT NOT NULL,
    "ordinal" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "question" TEXT NOT NULL,
    "questionKey" TEXT NOT NULL,
    "answer" TEXT,
    "route" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "label" TEXT,
    "language" TEXT NOT NULL,
    "articleIds" TEXT[],
    "citations" JSONB NOT NULL DEFAULT '[]',
    "gateFlags" TEXT[],
    "productIds" TEXT[],
    "delivery" JSONB,
    "estimate" JSONB,
    "followups" JSONB NOT NULL DEFAULT '[]',
    "limitReached" TEXT,
    "nudge" BOOLEAN NOT NULL DEFAULT false,
    "articleSetHash" TEXT,
    "promptVersion" TEXT NOT NULL,
    "modelTriage" TEXT,
    "modelAnswer" TEXT,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "ms" INTEGER NOT NULL DEFAULT 0,
    "feedback" TEXT,
    "feedbackReason" TEXT,
    "purgeAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorTurn_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorGap" (
    "id" TEXT NOT NULL,
    "canonical" TEXT NOT NULL,
    "samples" JSONB NOT NULL DEFAULT '[]',
    "count" INTEGER NOT NULL DEFAULT 1,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "articleId" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdvisorGap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdvisorSettings" (
    "id" TEXT NOT NULL DEFAULT 'advisor',
    "aiPaused" BOOLEAN NOT NULL DEFAULT false,
    "generalEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdvisorSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeArticle_slug_key" ON "KnowledgeArticle"("slug");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_status_kind_idx" ON "KnowledgeArticle"("status", "kind");

-- CreateIndex
CREATE INDEX "KnowledgeArticle_aliasText_search" ON "KnowledgeArticle" USING GIN ("aliasText" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "KnowledgeChunk_tsv_idx" ON "KnowledgeChunk" USING GIN ("tsv");

-- CreateIndex
CREATE UNIQUE INDEX "KnowledgeChunk_articleId_articleVersion_ordinal_key" ON "KnowledgeChunk"("articleId", "articleVersion", "ordinal");

-- CreateIndex
CREATE INDEX "AdvisorConversation_tokenHash_lastAt_idx" ON "AdvisorConversation"("tokenHash", "lastAt");

-- CreateIndex
CREATE INDEX "AdvisorConversation_lastAt_idx" ON "AdvisorConversation"("lastAt");

-- CreateIndex
CREATE INDEX "AdvisorTurn_conversationId_ordinal_idx" ON "AdvisorTurn"("conversationId", "ordinal");

-- CreateIndex
CREATE INDEX "AdvisorTurn_purgeAt_idx" ON "AdvisorTurn"("purgeAt");

-- CreateIndex
CREATE INDEX "AdvisorTurn_createdAt_idx" ON "AdvisorTurn"("createdAt");

-- CreateIndex
CREATE INDEX "AdvisorTurn_questionKey_createdAt_idx" ON "AdvisorTurn"("questionKey", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisorTurn_tokenHash_clientTurnId_key" ON "AdvisorTurn"("tokenHash", "clientTurnId");

-- CreateIndex
CREATE INDEX "AdvisorGap_status_lastSeen_idx" ON "AdvisorGap"("status", "lastSeen");

-- CreateIndex
CREATE INDEX "AdvisorGap_lastSeen_idx" ON "AdvisorGap"("lastSeen");

-- CreateIndex
CREATE UNIQUE INDEX "AdvisorGap_canonical_kind_key" ON "AdvisorGap"("canonical", "kind");

-- AddForeignKey
ALTER TABLE "KnowledgeChunk" ADD CONSTRAINT "KnowledgeChunk_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "KnowledgeArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdvisorTurn" ADD CONSTRAINT "AdvisorTurn_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AdvisorConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Added by hand. A guide cannot be PUBLISHED without a named reviewer, in any code path, and a shop's
-- own answer cannot be PUBLISHED without the owner who approved it.
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_kind_check" CHECK ("kind" IN ('GUIDE', 'SHOP'));
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_status_check" CHECK ("status" IN ('DRAFT', 'PUBLISHED', 'RETIRED'));
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_guide_signed" CHECK ("kind" <> 'GUIDE' OR "status" <> 'PUBLISHED' OR ("reviewerKey" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewDueAt" IS NOT NULL));
ALTER TABLE "KnowledgeArticle" ADD CONSTRAINT "KnowledgeArticle_shop_approved" CHECK ("kind" <> 'SHOP' OR "status" <> 'PUBLISHED' OR "approvedById" IS NOT NULL);
