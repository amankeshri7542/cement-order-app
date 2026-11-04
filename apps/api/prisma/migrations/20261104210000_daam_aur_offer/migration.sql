-- AlterTable
ALTER TABLE "OrderItem" ADD COLUMN     "rateChangedById" TEXT,
ADD COLUMN     "ruleId" TEXT,
ADD COLUMN     "ruleKind" TEXT;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "priceCheckedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "customerGroupId" TEXT,
ADD COLUMN     "rateCapPercent" INTEGER;

-- CreateTable
CREATE TABLE "CustomerGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CustomerGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceRule" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT '',
    "productId" TEXT,
    "categoryId" TEXT,
    "minQuantity" INTEGER NOT NULL DEFAULT 1,
    "groupId" TEXT,
    "customerId" TEXT,
    "valueType" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "startsOn" TEXT,
    "endsOn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "stacks" BOOLEAN NOT NULL DEFAULT false,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PriceRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryRate" (
    "id" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL,
    "feePaise" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryRate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomerGroup_name_key" ON "CustomerGroup"("name");

-- CreateIndex
CREATE INDEX "PriceRule_active_kind_idx" ON "PriceRule"("active", "kind");

-- CreateIndex
CREATE INDEX "PriceRule_customerId_idx" ON "PriceRule"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryRate_zoneId_vehicle_key" ON "DeliveryRate"("zoneId", "vehicle");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "CustomerGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Rules the code should never break.
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_kind" CHECK ("kind" IN ('SLAB', 'GROUP', 'SPECIAL', 'OFFER'));
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_value_type" CHECK ("valueType" IN ('RATE', 'PERCENT_OFF', 'AMOUNT_OFF'));
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_value" CHECK ("value" > 0 AND ("valueType" <> 'PERCENT_OFF' OR "value" <= 9000));
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_days" CHECK ("startsOn" IS NULL OR "endsOn" IS NULL OR "startsOn" <= "endsOn");
ALTER TABLE "PriceRule" ADD CONSTRAINT "PriceRule_min" CHECK ("minQuantity" >= 1);
ALTER TABLE "DeliveryRate" ADD CONSTRAINT "DeliveryRate_fee" CHECK ("feePaise" >= 0);
ALTER TABLE "User" ADD CONSTRAINT "User_rate_cap" CHECK ("rateCapPercent" IS NULL OR "rateCapPercent" BETWEEN 0 AND 50);
