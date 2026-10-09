-- CreateEnum
CREATE TYPE "InventoryKind" AS ENUM ('PURCHASE_IN', 'WALK_IN_SALE', 'ONLINE_ORDER', 'ORDER_CANCELLED', 'RETURN', 'DAMAGE', 'MANUAL_ADJUSTMENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "contractorStatus" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "adminVerifiedAt" TIMESTAMP(3),
ADD COLUMN     "label" TEXT NOT NULL DEFAULT 'Unknown device',
ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "minQuantity" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "packSize" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "quantityStep" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "decisionActorId" TEXT,
ADD COLUMN     "decisionAt" TIMESTAMP(3),
ADD COLUMN     "decisionNote" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "decisionSource" TEXT;

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "kind" "InventoryKind" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryZone" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deliveryFeePaise" INTEGER NOT NULL,
    "minimumOrderPaise" INTEGER NOT NULL DEFAULT 0,
    "freeDeliveryAbovePaise" INTEGER,
    "estimate" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "DeliveryZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPincode" (
    "pincode" TEXT NOT NULL,
    "zoneId" TEXT NOT NULL,

    CONSTRAINT "DeliveryPincode_pkey" PRIMARY KEY ("pincode")
);

-- CreateTable
CREATE TABLE "AdminCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminCredential_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "AuthRateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AuthRateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryMovement_idempotencyKey_key" ON "InventoryMovement"("idempotencyKey");

-- CreateIndex
CREATE INDEX "InventoryMovement_productId_createdAt_id_idx" ON "InventoryMovement"("productId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "InventoryMovement_createdAt_id_idx" ON "InventoryMovement"("createdAt", "id");

-- CreateIndex
CREATE INDEX "DeliveryPincode_zoneId_idx" ON "DeliveryPincode"("zoneId");

-- CreateIndex
CREATE INDEX "AuthRateLimit_expiresAt_idx" ON "AuthRateLimit"("expiresAt");

-- CreateIndex
CREATE INDEX "User_createdAt_id_idx" ON "User"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Product_active_name_id_idx" ON "Product"("active", "name", "id");

-- CreateIndex
CREATE INDEX "Product_active_pricePaise_id_idx" ON "Product"("active", "pricePaise", "id");

-- CreateIndex
CREATE INDEX "Product_active_createdAt_id_idx" ON "Product"("active", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Product_active_categoryId_name_id_idx" ON "Product"("active", "categoryId", "name", "id");

-- CreateIndex
CREATE INDEX "Product_active_brand_name_id_idx" ON "Product"("active", "brand", "name", "id");

-- CreateIndex
CREATE INDEX "Order_createdAt_id_idx" ON "Order"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Order_userId_createdAt_id_idx" ON "Order"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "Quote_createdAt_id_idx" ON "Quote"("createdAt", "id");

-- CreateIndex
CREATE INDEX "Quote_userId_createdAt_id_idx" ON "Quote"("userId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_id_idx" ON "AuditLog"("createdAt", "id");

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPincode" ADD CONSTRAINT "DeliveryPincode_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "DeliveryZone"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminCredential" ADD CONSTRAINT "AdminCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Preserve the current balance as an explicit opening movement, not fabricated history.
INSERT INTO "InventoryMovement" ("id","productId","kind","quantity","balanceAfter","actorId","reference","note","idempotencyKey")
SELECT 'opening-' || "id", "id", 'MANUAL_ADJUSTMENT', "stock", "stock", 'migration', 'Opening balance', 'Balance before inventory ledger was introduced', 'opening:' || "id" FROM "Product" WHERE "stock" <> 0;
UPDATE "User" SET "role"='CUSTOMER', "contractorStatus"='PENDING' WHERE "role"='CONTRACTOR';
ALTER TABLE "Product" ADD CONSTRAINT "Product_quantity_rules" CHECK ("minQuantity">0 AND "quantityStep">0 AND "minQuantity" % "quantityStep"=0);
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "Movement_balance" CHECK ("quantity"<>0 AND "balanceAfter">=0 AND "balanceAfter"<=1000000);
ALTER TABLE "DeliveryZone" ADD CONSTRAINT "Zone_amounts" CHECK ("deliveryFeePaise">=0 AND "minimumOrderPaise">=0 AND ("freeDeliveryAbovePaise" IS NULL OR "freeDeliveryAbovePaise">=0));
CREATE FUNCTION immutable_inventory_movement() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Inventory movements are immutable; record a correcting movement'; END $$;
CREATE TRIGGER inventory_movement_immutable BEFORE UPDATE OR DELETE ON "InventoryMovement" FOR EACH ROW EXECUTE FUNCTION immutable_inventory_movement();
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX "Product_name_search" ON "Product" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "Product_brand_search" ON "Product" USING GIN ("brand" gin_trgm_ops);
CREATE INDEX "Product_grade_search" ON "Product" USING GIN ("grade" gin_trgm_ops);
