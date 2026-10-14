-- Forward-only correction: verificationStatus remains separate from class lifecycle.
BEGIN;
ALTER TABLE "FacultyOnlineClass"
  DROP CONSTRAINT "FacultyOnlineClass_status_check",
  ADD CONSTRAINT "FacultyOnlineClass_status_check"
    CHECK ("status" IN ('SCHEDULED', 'LIVE', 'COMPLETED', 'CANCELLED'));
COMMIT;
