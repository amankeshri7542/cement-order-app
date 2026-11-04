-- Refresh-token grace and reuse detection. Additive only: both columns are nullable, so existing
-- sessions and older API versions keep working during a rolling deploy.

-- The refresh token replaced by the latest rotation. Presented again before previousRefreshUntil
-- (a retry after a lost reply) it still refreshes; presented later, it revokes the session.
ALTER TABLE "Session" ADD COLUMN "previousRefreshHash" TEXT;
ALTER TABLE "Session" ADD COLUMN "previousRefreshUntil" TIMESTAMP(3);

CREATE UNIQUE INDEX "Session_previousRefreshHash_key" ON "Session"("previousRefreshHash");
