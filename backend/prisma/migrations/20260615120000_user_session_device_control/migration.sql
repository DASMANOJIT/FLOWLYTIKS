-- Strong device/session tracking for admin, student, and faculty auth.
-- Existing session rows are kept, but they will require a fresh login because
-- new auth checks use sessionTokenHash instead of the previous raw JWT id.

ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "sessionTokenHash" TEXT;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "deviceId" TEXT;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "deviceName" TEXT;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "userAgent" TEXT;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "ipAddress" TEXT;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "UserSession" ADD COLUMN IF NOT EXISTS "revokedReason" TEXT;

UPDATE "UserSession"
SET
  "isActive" = false,
  "revokedAt" = COALESCE("revokedAt", CURRENT_TIMESTAMP),
  "revokedReason" = COALESCE("revokedReason", 'SESSION_POLICY_UPGRADE')
WHERE "sessionTokenHash" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "UserSession_sessionTokenHash_key" ON "UserSession"("sessionTokenHash");
CREATE INDEX IF NOT EXISTS "UserSession_role_userId_isActive_lastSeenAt_idx" ON "UserSession"("role", "userId", "isActive", "lastSeenAt");
