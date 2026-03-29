-- Reconcile schema drift safely (non-destructive) and ensure phone uniqueness.
-- This migration is intentionally idempotent for PostgreSQL.

-- Student flags (may exist already)
ALTER TABLE "Student"
  ADD COLUMN IF NOT EXISTS "isVerified" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Student"
  ADD COLUMN IF NOT EXISTS "isTwoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;

-- Ensure unique phone at the DB level
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname = 'Student_phone_key'
  ) THEN
    CREATE UNIQUE INDEX "Student_phone_key" ON "Student"("phone");
  END IF;
END $$;

-- OTP table (legacy table may exist; we keep it for compatibility with existing DB state)
CREATE TABLE IF NOT EXISTS "Otp" (
  "id" SERIAL NOT NULL,
  "phone" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "otpHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Otp_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Otp_phone_idx" ON "Otp"("phone");
CREATE UNIQUE INDEX IF NOT EXISTS "Otp_phone_purpose_key" ON "Otp"("phone", "purpose");

