-- Student dashboard and directory filters
CREATE INDEX IF NOT EXISTS "Student_class_idx" ON "Student"("class");
CREATE INDEX IF NOT EXISTS "Student_school_idx" ON "Student"("school");
CREATE INDEX IF NOT EXISTS "Student_joinDate_idx" ON "Student"("joinDate");

-- Payment dashboard, reporting, and student history queries
CREATE INDEX IF NOT EXISTS "Payment_studentId_academicYear_createdAt_idx"
  ON "Payment"("studentId", "academicYear", "createdAt");

CREATE INDEX IF NOT EXISTS "Payment_academicYear_month_status_idx"
  ON "Payment"("academicYear", "month", "status");

CREATE INDEX IF NOT EXISTS "Payment_status_createdAt_idx"
  ON "Payment"("status", "createdAt");
