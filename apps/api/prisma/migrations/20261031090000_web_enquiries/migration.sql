-- CreateEnum
CREATE TYPE "EnquiryStatus" AS ENUM ('NEW', 'HANDLED');

-- CreateTable
CREATE TABLE "WebEnquiry" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "pincode" TEXT,
    "interest" TEXT,
    "message" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'hi',
    "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
    "handledAt" TIMESTAMP(3),
    "handledById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebEnquiry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WebEnquiry_status_createdAt_idx" ON "WebEnquiry"("status", "createdAt");

-- The API validates the same limits; the database refuses anything that slips past it.
ALTER TABLE "WebEnquiry" ADD CONSTRAINT "web_enquiry_values" CHECK (
  char_length("name") BETWEEN 1 AND 80
  AND "phone" ~ '^\+91[6-9][0-9]{9}$'
  AND ("pincode" IS NULL OR "pincode" ~ '^[1-9][0-9]{5}$')
  AND ("interest" IS NULL OR char_length("interest") BETWEEN 1 AND 200)
  AND char_length("message") BETWEEN 1 AND 1000
  AND "language" IN ('hi', 'en')
  AND (("status" = 'HANDLED') = ("handledAt" IS NOT NULL))
);
