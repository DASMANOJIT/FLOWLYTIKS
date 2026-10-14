CREATE TABLE "StaffStudentFollowUp" (
    "id" TEXT NOT NULL,
    "studentId" INTEGER NOT NULL,
    "staffId" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "StaffStudentFollowUp_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "StaffStudentFollowUp_studentId_createdAt_idx" ON "StaffStudentFollowUp"("studentId", "createdAt");
CREATE INDEX "StaffStudentFollowUp_staffId_idx" ON "StaffStudentFollowUp"("staffId");
ALTER TABLE "StaffStudentFollowUp" ADD CONSTRAINT "StaffStudentFollowUp_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StaffStudentFollowUp" ADD CONSTRAINT "StaffStudentFollowUp_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
