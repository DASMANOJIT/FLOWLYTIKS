CREATE TABLE "FacultyOnlineClass" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "incentiveTypeId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "batchName" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "message" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "meetUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "incentiveEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "FacultyOnlineClass_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FacultyOnlineClass_time_check" CHECK ("endsAt" > "startsAt"),
    CONSTRAINT "FacultyOnlineClass_status_check" CHECK ("status" IN ('SCHEDULED', 'COMPLETED', 'CANCELLED'))
);
CREATE UNIQUE INDEX "FacultyOnlineClass_incentiveEntryId_key" ON "FacultyOnlineClass"("incentiveEntryId");
CREATE UNIQUE INDEX "FacultyOnlineClass_facultyId_requestId_key" ON "FacultyOnlineClass"("facultyId", "requestId");
CREATE INDEX "FacultyOnlineClass_facultyId_startsAt_id_idx" ON "FacultyOnlineClass"("facultyId", "startsAt", "id");
CREATE INDEX "FacultyOnlineClass_incentiveTypeId_idx" ON "FacultyOnlineClass"("incentiveTypeId");
ALTER TABLE "FacultyOnlineClass" ADD CONSTRAINT "FacultyOnlineClass_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacultyOnlineClass" ADD CONSTRAINT "FacultyOnlineClass_incentiveTypeId_fkey" FOREIGN KEY ("incentiveTypeId") REFERENCES "ExtraIncentiveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacultyOnlineClass" ADD CONSTRAINT "FacultyOnlineClass_incentiveEntryId_fkey" FOREIGN KEY ("incentiveEntryId") REFERENCES "FacultyExtraIncentiveEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
