-- Phase 4: owner desk operations and alerts. Additive only: every new column has a default,
-- so existing rows and older API versions keep working during a rolling deploy.

-- How money was collected (cash or UPI at the site, online) and who bought at the counter.
ALTER TABLE "FinancialMovement" ADD COLUMN "channel" TEXT NOT NULL DEFAULT ''
  CHECK ("channel" IN ('', 'CASH', 'UPI', 'ONLINE'));
ALTER TABLE "FinancialMovement" ADD COLUMN "counterParty" TEXT NOT NULL DEFAULT '';

-- Each product's own "running low" level (previously a fixed 25 units for everything).
ALTER TABLE "Product" ADD COLUMN "lowStockAt" INTEGER NOT NULL DEFAULT 25 CHECK ("lowStockAt" >= 0);

-- Delivery terms the customer sees: unloading, floors, vehicle, time window.
ALTER TABLE "DeliveryZone" ADD COLUMN "terms" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Quote" ADD COLUMN "deliveryTerms" TEXT NOT NULL DEFAULT '';

-- Staff names and roles ("पापा · रिटेल"), and each owner's WhatsApp alert choice.
ALTER TABLE "User" ADD COLUMN "staffTitle" TEXT NOT NULL DEFAULT '';
ALTER TABLE "User" ADD COLUMN "whatsappAlerts" BOOLEAN NOT NULL DEFAULT false;

-- Owner desk web push (installed desk on a phone or computer). Notifications track web push
-- separately from Android push (sentAt), so one channel never hides the other.
ALTER TABLE "Notification" ADD COLUMN "pushedAt" TIMESTAMP(3);
CREATE TABLE "PushSubscription" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "endpoint" TEXT NOT NULL UNIQUE,
  "p256dh" TEXT NOT NULL,
  "auth" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- Outbox for WhatsApp messages: written in the same transaction as the business event, sent
-- by the worker with retries and a daily budget. The provider is fake unless configured.
CREATE TABLE "OutboundMessage" (
  "id" TEXT PRIMARY KEY,
  "userId" TEXT REFERENCES "User"("id") ON DELETE CASCADE,
  "channel" TEXT NOT NULL CHECK ("channel" IN ('WHATSAPP')),
  "recipient" TEXT NOT NULL,
  "template" TEXT NOT NULL,
  "params" JSONB NOT NULL,
  "dedupeKey" TEXT NOT NULL UNIQUE,
  "status" TEXT NOT NULL DEFAULT 'PENDING' CHECK ("status" IN ('PENDING', 'SENT', 'FAILED', 'SKIPPED')),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "providerId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "sentAt" TIMESTAMP(3)
);
CREATE INDEX "OutboundMessage_status_nextAttemptAt_idx" ON "OutboundMessage"("status", "nextAttemptAt");
CREATE INDEX "OutboundMessage_createdAt_idx" ON "OutboundMessage"("createdAt");
