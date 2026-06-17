-- Harden user/device sessions for admin, student, and faculty auth.
ALTER TABLE "UserSession"
  ALTER COLUMN "userId" TYPE TEXT USING "userId"::TEXT,
  ADD COLUMN IF NOT EXISTS "deviceId" TEXT,
  ADD COLUMN IF NOT EXISTS "deviceName" TEXT,
  ADD COLUMN IF NOT EXISTS "userAgent" TEXT,
  ADD COLUMN IF NOT EXISTS "ipAddress" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

UPDATE "UserSession"
SET "lastSeenAt" = COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)
WHERE "lastSeenAt" IS NULL;

CREATE INDEX IF NOT EXISTS "UserSession_isActive_idx" ON "UserSession"("isActive");
CREATE INDEX IF NOT EXISTS "UserSession_lastSeenAt_idx" ON "UserSession"("lastSeenAt");
