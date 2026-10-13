-- AlterTable
ALTER TABLE "ProductPriceHistory" ADD COLUMN     "batchId" TEXT,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'PRICE';

-- CreateTable
CREATE TABLE "ProductAlias" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "alias" TEXT NOT NULL,
    "normalizedAlias" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "confirmedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductAlias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateSource" (
    "id" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ocrText" TEXT,
    "ocr" JSONB,

    CONSTRAINT "RateSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceUpdateBatch" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "idempotencyKey" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedBy" TEXT,
    "publishedAt" TIMESTAMP(3),
    "stage" TEXT NOT NULL DEFAULT '',
    "attemptToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "extraction" JSONB,
    "usage" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "PriceUpdateBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceUpdateBatchItem" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "productId" TEXT,
    "label" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "specification" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT '',
    "weight" TEXT NOT NULL DEFAULT '',
    "proposedPricePaise" INTEGER,
    "oldPricePaise" INTEGER,
    "expectedProductVersion" INTEGER,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "reviewed" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "rememberAlias" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT NOT NULL DEFAULT '',
    "confidence" DOUBLE PRECISION,
    "matchMethod" TEXT NOT NULL DEFAULT 'MANUAL',
    "extracted" JSONB,
    "publishedPricePaise" INTEGER,
    "publishedProduct" JSONB,

    CONSTRAINT "PriceUpdateBatchItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductAlias_normalizedAlias_key" ON "ProductAlias"("normalizedAlias");

-- CreateIndex
CREATE INDEX "ProductAlias_productId_idx" ON "ProductAlias"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "RateSource_sha256_key" ON "RateSource"("sha256");

-- CreateIndex
CREATE UNIQUE INDEX "PriceUpdateBatch_idempotencyKey_key" ON "PriceUpdateBatch"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PriceUpdateBatch_createdAt_id_idx" ON "PriceUpdateBatch"("createdAt", "id");

-- CreateIndex
CREATE INDEX "PriceUpdateBatch_status_leaseUntil_idx" ON "PriceUpdateBatch"("status", "leaseUntil");

-- CreateIndex
CREATE INDEX "PriceUpdateBatchItem_productId_idx" ON "PriceUpdateBatchItem"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "PriceUpdateBatchItem_batchId_position_key" ON "PriceUpdateBatchItem"("batchId", "position");

-- CreateIndex
CREATE INDEX "RateCard_batchId_createdAt_idx" ON "RateCard"("batchId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "ProductPriceHistory_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceUpdateBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductAlias" ADD CONSTRAINT "ProductAlias_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceUpdateBatch" ADD CONSTRAINT "PriceUpdateBatch_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "RateSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceUpdateBatchItem" ADD CONSTRAINT "PriceUpdateBatchItem_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceUpdateBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceUpdateBatchItem" ADD CONSTRAINT "PriceUpdateBatchItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "PriceUpdateBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve historical evidence while distinguishing old configuration-only records.
UPDATE "ProductPriceHistory" SET "kind"='CONFIGURATION' WHERE "oldPricePaise"="newPricePaise";
ALTER TABLE "ProductPriceHistory" ADD CONSTRAINT "PriceHistory_kind" CHECK ("kind" IN ('PRICE','CONFIGURATION'));
ALTER TABLE "PriceUpdateBatch" ADD CONSTRAINT "RateBatch_state" CHECK ("status" IN ('DRAFT','PROCESSING','REVIEW_REQUIRED','READY','PUBLISHED','CANCELLED') AND "sourceType" IN ('MANUAL','IMAGE','ADJUSTMENT') AND "version">0);
ALTER TABLE "PriceUpdateBatchItem" ADD CONSTRAINT "RateItem_price" CHECK (("proposedPricePaise" IS NULL OR "proposedPricePaise" BETWEEN 1 AND 100000000) AND ("confidence" IS NULL OR "confidence" BETWEEN 0 AND 1));
ALTER TABLE "RateSource" ADD CONSTRAINT "RateSource_size" CHECK ("size">0 AND "size"<=5242880 AND "contentType" IN ('image/png','image/jpeg','image/webp'));
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_format" CHECK ("format" IN ('STATUS','SQUARE','SHEET') AND "template" IN ('COUNTER','BULLETIN'));
CREATE FUNCTION protect_rate_batch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."status"='PUBLISHED' THEN RAISE EXCEPTION 'Published rate batches are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "RateBatch_immutable" BEFORE UPDATE OR DELETE ON "PriceUpdateBatch" FOR EACH ROW EXECUTE FUNCTION protect_rate_batch();
CREATE FUNCTION protect_rate_item() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE parent_id TEXT;
BEGIN
  IF TG_OP='DELETE' THEN parent_id:=OLD."batchId"; ELSE parent_id:=NEW."batchId"; END IF;
  IF EXISTS (SELECT 1 FROM "PriceUpdateBatch" WHERE id=parent_id AND status='PUBLISHED') THEN RAISE EXCEPTION 'Published rate rows are immutable'; END IF;
  IF TG_OP='UPDATE' AND OLD."batchId"<>NEW."batchId" AND EXISTS (SELECT 1 FROM "PriceUpdateBatch" WHERE id=OLD."batchId" AND status='PUBLISHED') THEN RAISE EXCEPTION 'Published rate rows are immutable'; END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "RateItem_immutable" BEFORE INSERT OR UPDATE OR DELETE ON "PriceUpdateBatchItem" FOR EACH ROW EXECUTE FUNCTION protect_rate_item();
CREATE FUNCTION protect_rate_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (OLD."sha256",OLD."storageKey",OLD."contentType",OLD."size",OLD."fileName",OLD."createdBy",OLD."createdAt") IS DISTINCT FROM (NEW."sha256",NEW."storageKey",NEW."contentType",NEW."size",NEW."fileName",NEW."createdBy",NEW."createdAt") THEN RAISE EXCEPTION 'Rate source evidence is immutable'; END IF;
  RETURN NEW;
END; $$;
CREATE TRIGGER "RateSource_immutable" BEFORE UPDATE ON "RateSource" FOR EACH ROW EXECUTE FUNCTION protect_rate_source();
CREATE FUNCTION protect_rate_card() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Rate card snapshots are immutable'; END; $$;
CREATE TRIGGER "RateCard_immutable" BEFORE UPDATE OR DELETE ON "RateCard" FOR EACH ROW EXECUTE FUNCTION protect_rate_card();
