-- CreateEnum
CREATE TYPE "StaffDeviceStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED', 'REPLACED', 'LOST');

-- CreateEnum
CREATE TYPE "DeviceRequestKind" AS ENUM ('FIRST', 'CHANGE');

-- CreateEnum
CREATE TYPE "DeviceRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REFUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ShopScreenKind" AS ENUM ('SCREEN', 'MANAGER_PHONE');

-- CreateEnum
CREATE TYPE "ShopScreenStatus" AS ENUM ('PENDING', 'ACTIVE', 'REVOKED');

-- CreateEnum
CREATE TYPE "AttendanceKind" AS ENUM ('IN', 'OUT', 'MANUAL_IN', 'MANUAL_OUT', 'CORRECTION', 'DECISION', 'SIGNAL');

-- CreateEnum
CREATE TYPE "AttendanceResult" AS ENUM ('GREEN', 'GREEN_NOTE', 'RETRY', 'REVIEW');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('PLANNED', 'OUT', 'DONE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TripStopStatus" AS ENUM ('PENDING', 'DELIVERED', 'PROBLEM');

-- AlterTable
ALTER TABLE "AuditLog" ALTER COLUMN "permissionsVersion" SET DEFAULT 5;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "attendanceOn" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "graceMinutes" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "lat" DOUBLE PRECISION,
ADD COLUMN     "lng" DOUBLE PRECISION,
ADD COLUMN     "radiusM" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "staffDeviceId" TEXT;

-- CreateTable
CREATE TABLE "StaffProfile" (
    "userId" TEXT NOT NULL,
    "noPhone" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "StaffSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "effectiveFrom" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "breakMinutes" INTEGER NOT NULL DEFAULT 60,
    "weeklyOffs" INTEGER[],
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StaffNoticeAck" (
    "userId" TEXT NOT NULL,
    "noticeVersion" INTEGER NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StaffNoticeAck_pkey" PRIMARY KEY ("userId","noticeVersion")
);

-- CreateTable
CREATE TABLE "StaffDevice" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "publicKey" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "sdk" INTEGER NOT NULL DEFAULT 0,
    "status" "StaffDeviceStatus" NOT NULL DEFAULT 'PENDING',
    "linkedById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "StaffDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeviceLinkRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "kind" "DeviceRequestKind" NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "qrScannedAt" TIMESTAMP(3),
    "qrScreenId" TEXT,
    "status" "DeviceRequestStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceLinkRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShopScreen" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "kind" "ShopScreenKind" NOT NULL DEFAULT 'SCREEN',
    "epoch" INTEGER NOT NULL DEFAULT 1,
    "status" "ShopScreenStatus" NOT NULL DEFAULT 'PENDING',
    "credentialHash" TEXT,
    "pairingCodeHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "pairedById" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShopScreen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stream" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "prevHash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "locationId" TEXT,
    "kind" "AttendanceKind" NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL,
    "captureId" TEXT,
    "claimedAgeMs" INTEGER,
    "bootCount" INTEGER,
    "appVersion" TEXT,
    "deviceId" TEXT,
    "signature" TEXT,
    "qrCounter" INTEGER,
    "screenId" TEXT,
    "distanceM" INTEGER,
    "accuracyM" INTEGER,
    "mocked" BOOLEAN,
    "reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geoHash" TEXT,
    "evidenceId" TEXT,
    "result" "AttendanceResult",
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL DEFAULT '',
    "refersToId" TEXT,
    "correctsKind" TEXT,
    "correctedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceGeo" (
    "eventId" TEXT NOT NULL,
    "geoEnc" TEXT,
    "retainUntil" TIMESTAMP(3) NOT NULL,
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "AttendanceGeo_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "AttendanceDay" (
    "userId" TEXT NOT NULL,
    "day" TEXT NOT NULL,
    "locationIds" TEXT[],
    "firstInAt" TIMESTAMP(3),
    "lastOutAt" TIMESTAMP(3),
    "minutes" INTEGER,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceDay_pkey" PRIMARY KEY ("userId","day")
);

-- CreateTable
CREATE TABLE "AttendanceReview" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locationId" TEXT,
    "kind" TEXT NOT NULL,
    "status" "ReviewStatus" NOT NULL DEFAULT 'OPEN',
    "toOwner" BOOLEAN NOT NULL DEFAULT false,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttendanceReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProofAnchor" (
    "day" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "prevRoot" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "ProofAnchor_pkey" PRIMARY KEY ("day")
);

-- CreateTable
CREATE TABLE "EvidenceObject" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "locationId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "retainUntil" TIMESTAMP(3),
    "erasedAt" TIMESTAMP(3),

    CONSTRAINT "EvidenceObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReceipt" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "supplierName" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "evidenceId" TEXT,
    "movementId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLoad" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "billNumber" TEXT NOT NULL DEFAULT '',
    "loadedById" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "OrderLoad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "helperId" TEXT,
    "vehicle" TEXT NOT NULL DEFAULT '',
    "status" "TripStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TripStop" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "status" "TripStopStatus" NOT NULL DEFAULT 'PENDING',
    "departedAt" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "problem" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "TripStop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryProof" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "tripStopId" TEXT,
    "kind" TEXT NOT NULL,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAgeMs" INTEGER,
    "distanceM" INTEGER,
    "accuracyM" INTEGER,
    "geoEnc" TEXT,
    "evidenceId" TEXT,
    "skipReason" TEXT NOT NULL DEFAULT '',
    "actorId" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "DeliveryProof_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverCollection" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "duePaise" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "channel" TEXT NOT NULL,
    "claimedAgeMs" INTEGER,
    "handoverKey" TEXT,
    "serverAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "idempotencyKey" TEXT NOT NULL,

    CONSTRAINT "DriverCollection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashHandover" (
    "id" TEXT NOT NULL,
    "handoverKey" TEXT NOT NULL,
    "step" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "note" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CashHandover_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffSchedule_userId_effectiveFrom_key" ON "StaffSchedule"("userId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "StaffDevice_userId_status_idx" ON "StaffDevice"("userId", "status");

-- CreateIndex
CREATE INDEX "DeviceLinkRequest_status_createdAt_idx" ON "DeviceLinkRequest"("status", "createdAt");

-- CreateIndex
CREATE INDEX "DeviceLinkRequest_userId_status_idx" ON "DeviceLinkRequest"("userId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ShopScreen_code_key" ON "ShopScreen"("code");

-- CreateIndex
CREATE UNIQUE INDEX "ShopScreen_credentialHash_key" ON "ShopScreen"("credentialHash");

-- CreateIndex
CREATE INDEX "ShopScreen_locationId_status_idx" ON "ShopScreen"("locationId", "status");

-- CreateIndex
CREATE INDEX "AttendanceEvent_userId_serverAt_idx" ON "AttendanceEvent"("userId", "serverAt");

-- CreateIndex
CREATE INDEX "AttendanceEvent_locationId_serverAt_idx" ON "AttendanceEvent"("locationId", "serverAt");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_stream_seq_key" ON "AttendanceEvent"("stream", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceEvent_userId_captureId_key" ON "AttendanceEvent"("userId", "captureId");

-- CreateIndex
CREATE INDEX "AttendanceGeo_retainUntil_erasedAt_idx" ON "AttendanceGeo"("retainUntil", "erasedAt");

-- CreateIndex
CREATE INDEX "AttendanceDay_day_idx" ON "AttendanceDay"("day");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceReview_eventId_key" ON "AttendanceReview"("eventId");

-- CreateIndex
CREATE INDEX "AttendanceReview_status_locationId_createdAt_idx" ON "AttendanceReview"("status", "locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "EvidenceObject_storageKey_key" ON "EvidenceObject"("storageKey");

-- CreateIndex
CREATE INDEX "EvidenceObject_retainUntil_erasedAt_idx" ON "EvidenceObject"("retainUntil", "erasedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_movementId_key" ON "StockReceipt"("movementId");

-- CreateIndex
CREATE UNIQUE INDEX "StockReceipt_idempotencyKey_key" ON "StockReceipt"("idempotencyKey");

-- CreateIndex
CREATE INDEX "StockReceipt_locationId_createdAt_idx" ON "StockReceipt"("locationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrderLoad_idempotencyKey_key" ON "OrderLoad"("idempotencyKey");

-- CreateIndex
CREATE INDEX "OrderLoad_orderId_idx" ON "OrderLoad"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "Trip_idempotencyKey_key" ON "Trip"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Trip_driverId_status_idx" ON "Trip"("driverId", "status");

-- CreateIndex
CREATE INDEX "Trip_locationId_createdAt_idx" ON "Trip"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "TripStop_orderId_idx" ON "TripStop"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "TripStop_tripId_orderId_key" ON "TripStop"("tripId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryProof_idempotencyKey_key" ON "DeliveryProof"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DeliveryProof_orderId_idx" ON "DeliveryProof"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverCollection_idempotencyKey_key" ON "DriverCollection"("idempotencyKey");

-- CreateIndex
CREATE INDEX "DriverCollection_driverId_handoverKey_idx" ON "DriverCollection"("driverId", "handoverKey");

-- CreateIndex
CREATE INDEX "DriverCollection_orderId_idx" ON "DriverCollection"("orderId");

-- CreateIndex
CREATE INDEX "CashHandover_locationId_createdAt_idx" ON "CashHandover"("locationId", "createdAt");

-- CreateIndex
CREATE INDEX "CashHandover_driverId_createdAt_idx" ON "CashHandover"("driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CashHandover_handoverKey_step_key" ON "CashHandover"("handoverKey", "step");

-- AddForeignKey
ALTER TABLE "DeviceLinkRequest" ADD CONSTRAINT "DeviceLinkRequest_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "StaffDevice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShopScreen" ADD CONSTRAINT "ShopScreen_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderLoad" ADD CONSTRAINT "OrderLoad_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TripStop" ADD CONSTRAINT "TripStop_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CashHandover" ADD CONSTRAINT "CashHandover_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One active phone per person, and one person per phone key.
CREATE UNIQUE INDEX "StaffDevice_one_active_per_person" ON "StaffDevice" ("userId") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "StaffDevice_one_active_per_key" ON "StaffDevice" ("publicKey") WHERE "status" = 'ACTIVE';
CREATE UNIQUE INDEX "DeviceLinkRequest_one_pending_per_person" ON "DeviceLinkRequest" ("userId") WHERE "status" = 'PENDING';

-- Nobody decides about themselves, even by going straight to the database.
ALTER TABLE "DeviceLinkRequest" ADD CONSTRAINT "DeviceLinkRequest_not_self" CHECK ("decidedById" IS NULL OR "decidedById" <> "userId");
ALTER TABLE "AttendanceReview" ADD CONSTRAINT "AttendanceReview_not_self" CHECK ("decidedById" IS NULL OR "decidedById" <> "userId");

ALTER TABLE "Location" ADD CONSTRAINT "Location_radius_range" CHECK ("radiusM" BETWEEN 50 AND 300);
ALTER TABLE "Location" ADD CONSTRAINT "Location_position_whole" CHECK (("lat" IS NULL) = ("lng" IS NULL));
ALTER TABLE "StaffSchedule" ADD CONSTRAINT "StaffSchedule_shift_order" CHECK ("endMinute" > "startMinute");
ALTER TABLE "StockReceipt" ADD CONSTRAINT "StockReceipt_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "DriverCollection" ADD CONSTRAINT "DriverCollection_amount_sane" CHECK ("amountPaise" >= 0 AND "duePaise" >= 0);

-- The record cannot be changed or removed, by anyone, from the app.
CREATE TRIGGER attendance_event_append_only BEFORE UPDATE OR DELETE ON "AttendanceEvent" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER cash_handover_append_only BEFORE UPDATE OR DELETE ON "CashHandover" FOR EACH ROW EXECUTE FUNCTION append_only_row();
CREATE TRIGGER delivery_proof_append_only BEFORE UPDATE OR DELETE ON "DeliveryProof" FOR EACH ROW EXECUTE FUNCTION append_only_row();

-- The person who counts a driver's cash is never the driver.
CREATE FUNCTION cash_handover_two_people() RETURNS trigger AS $$
BEGIN
  IF NEW."step" = 'COUNTED' AND NEW."actorId" = NEW."driverId" THEN
    RAISE EXCEPTION 'A driver cannot count their own cash';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER cash_handover_two_people BEFORE INSERT ON "CashHandover" FOR EACH ROW EXECUTE FUNCTION cash_handover_two_people();
