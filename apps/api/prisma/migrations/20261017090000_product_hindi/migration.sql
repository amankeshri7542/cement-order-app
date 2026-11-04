-- Hindi product name and description. Additive only: both columns are nullable, so existing
-- products and older API versions keep working; Hindi readers see the English text until filled in.
ALTER TABLE "Product" ADD COLUMN "nameHi" TEXT;
ALTER TABLE "Product" ADD COLUMN "descriptionHi" TEXT;

-- Catalogue search matches Hindi names the same way it matches English ones.
CREATE INDEX "Product_nameHi_search" ON "Product" USING GIN ("nameHi" gin_trgm_ops);
