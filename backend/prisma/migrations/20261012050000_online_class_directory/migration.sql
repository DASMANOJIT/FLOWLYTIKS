CREATE TABLE "OnlineClassBatch" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnlineClassBatch_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "OnlineClassGrade" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "OnlineClassGrade_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OnlineClassBatch_normalizedName_key" ON "OnlineClassBatch"("normalizedName");
CREATE UNIQUE INDEX "OnlineClassGrade_batchId_normalizedName_key" ON "OnlineClassGrade"("batchId", "normalizedName");
ALTER TABLE "OnlineClassGrade" ADD CONSTRAINT "OnlineClassGrade_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "OnlineClassBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacultyOnlineClass" ADD COLUMN "directoryGradeId" TEXT;
CREATE INDEX "FacultyOnlineClass_directoryGradeId_idx" ON "FacultyOnlineClass"("directoryGradeId");
ALTER TABLE "FacultyOnlineClass" ADD CONSTRAINT "FacultyOnlineClass_directoryGradeId_fkey" FOREIGN KEY ("directoryGradeId") REFERENCES "OnlineClassGrade"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
