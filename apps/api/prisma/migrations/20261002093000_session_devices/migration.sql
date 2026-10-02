ALTER TABLE "Device" ADD COLUMN "sessionId" TEXT NOT NULL;
ALTER TABLE "Device" ADD CONSTRAINT "Device_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Device_sessionId_idx" ON "Device"("sessionId");
