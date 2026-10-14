-- Existing classes stay legacy: no automatic historical incentive credits.
ALTER TABLE "FacultyOnlineClass"
  ADD COLUMN "trackingEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "conferenceName" TEXT,
  ADD COLUMN "conferenceSpace" TEXT,
  ADD COLUMN "actualStartAt" TIMESTAMP(3),
  ADD COLUMN "actualEndAt" TIMESTAMP(3),
  ADD COLUMN "conferenceExpiresAt" TIMESTAMP(3),
  ADD COLUMN "verificationStatus" TEXT NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "verificationError" TEXT,
  ADD COLUMN "teacherGoogleUserId" TEXT,
  ADD COLUMN "attendanceEvidence" JSONB,
  ADD COLUMN "attendanceCompleteAt" TIMESTAMP(3),
  ADD COLUMN "lastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "nextCheckAt" TIMESTAMP(3),
  ADD COLUMN "pollAttempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pollLeaseToken" TEXT,
  ADD COLUMN "pollLeaseUntil" TIMESTAMP(3);
CREATE UNIQUE INDEX "FacultyOnlineClass_conferenceName_key" ON "FacultyOnlineClass"("conferenceName");
CREATE INDEX "FacultyOnlineClass_trackingEnabled_nextCheckAt_idx" ON "FacultyOnlineClass"("trackingEnabled", "nextCheckAt");
ALTER TABLE "FacultyGoogleConnection" ADD COLUMN "meetBackoffUntil" TIMESTAMP(3);
