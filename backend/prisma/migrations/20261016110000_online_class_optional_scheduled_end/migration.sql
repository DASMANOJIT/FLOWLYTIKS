-- Scheduled end is optional. Existing values remain as historical schedule data.
ALTER TABLE "FacultyOnlineClass"
  ALTER COLUMN "endsAt" DROP NOT NULL,
  DROP CONSTRAINT "FacultyOnlineClass_time_check",
  ADD CONSTRAINT "FacultyOnlineClass_time_check"
  CHECK (isfinite("startsAt") AND ("endsAt" IS NULL OR isfinite("endsAt")));
