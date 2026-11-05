-- AlterTable
ALTER TABLE "Address" ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "DeliveryPincode" ADD COLUMN     "area" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "repeatOfOrderId" TEXT;

-- CreateTable
CREATE TABLE "AccountDelegate" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "canUseUdhaar" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "AccountDelegate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountDelegate_phone_idx" ON "AccountDelegate"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "AccountDelegate_accountId_phone_key" ON "AccountDelegate"("accountId", "phone");

-- AddForeignKey
ALTER TABLE "AccountDelegate" ADD CONSTRAINT "AccountDelegate_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

