CREATE TABLE "FacultyOnlineClassBatch" (
    "classId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "nameSnapshot" TEXT NOT NULL,
    CONSTRAINT "FacultyOnlineClassBatch_pkey" PRIMARY KEY ("classId", "batchId")
);
CREATE INDEX "FacultyOnlineClassBatch_batchId_idx" ON "FacultyOnlineClassBatch"("batchId");
ALTER TABLE "FacultyOnlineClassBatch" ADD CONSTRAINT "FacultyOnlineClassBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "FacultyOnlineClass"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FacultyOnlineClassBatch" ADD CONSTRAINT "FacultyOnlineClassBatch_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OnlineClassBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
