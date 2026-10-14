CREATE TABLE "FacultyExtraIncentiveOperationLock" (
  "facultyId" TEXT NOT NULL,
  "leaseId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FacultyExtraIncentiveOperationLock_pkey" PRIMARY KEY ("facultyId"),
  CONSTRAINT "FacultyExtraIncentiveOperationLock_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
