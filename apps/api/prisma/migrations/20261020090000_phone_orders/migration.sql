-- CreateEnum
CREATE TYPE "OrderSource" AS ENUM ('APP', 'WEB', 'PHONE', 'WALK_IN', 'QUOTE');

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'CREDIT';

-- DropForeignKey
ALTER TABLE "Order" DROP CONSTRAINT "Order_reviewId_fkey";

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "requestHash" TEXT,
ADD COLUMN     "source" "OrderSource" NOT NULL DEFAULT 'APP',
ALTER COLUMN "reviewId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "CheckoutReview"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing app orders retain their review. Quote orders already have explicit provenance.
UPDATE "Order" SET "source" = 'QUOTE' WHERE "quoteId" IS NOT NULL;
ALTER TABLE "Order" ADD CONSTRAINT "app_order_review" CHECK ("source" <> 'APP' OR "reviewId" IS NOT NULL);

