CREATE TABLE "DemandOverride" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "kind" TEXT NOT NULL CHECK ("kind" IN ('ORDER','QUOTE')), "maxTotalPaise" INTEGER NOT NULL CHECK ("maxTotalPaise" >= 0),
 "expiresAt" TIMESTAMP(3) NOT NULL, "usedAt" TIMESTAMP(3)
);
CREATE INDEX "DemandOverride_userId_kind_expiresAt_idx" ON "DemandOverride"("userId", "kind", "expiresAt");
CREATE TABLE "ProductAsset" ("id" TEXT PRIMARY KEY, "url" TEXT NOT NULL UNIQUE, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP);
