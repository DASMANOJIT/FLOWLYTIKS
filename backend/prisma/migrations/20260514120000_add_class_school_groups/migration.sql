ALTER TABLE "Student"
  ADD COLUMN "adminId" INTEGER;

CREATE TABLE "ClassSchoolGroup" (
  "id" TEXT NOT NULL,
  "adminId" INTEGER NOT NULL,
  "className" TEXT NOT NULL,
  "schoolName" TEXT NOT NULL,
  "normalizedClassName" TEXT NOT NULL,
  "normalizedSchoolName" TEXT NOT NULL,
  "whatsappGroupLink" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ClassSchoolGroup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Student_adminId_idx" ON "Student"("adminId");
CREATE INDEX "ClassSchoolGroup_adminId_idx" ON "ClassSchoolGroup"("adminId");
CREATE INDEX "ClassSchoolGroup_normalizedClassName_idx" ON "ClassSchoolGroup"("normalizedClassName");
CREATE INDEX "ClassSchoolGroup_normalizedSchoolName_idx" ON "ClassSchoolGroup"("normalizedSchoolName");
CREATE UNIQUE INDEX "ClassSchoolGroup_adminId_normalizedClassName_normalizedSchool_key"
  ON "ClassSchoolGroup"("adminId", "normalizedClassName", "normalizedSchoolName");

ALTER TABLE "Student"
  ADD CONSTRAINT "Student_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ClassSchoolGroup"
  ADD CONSTRAINT "ClassSchoolGroup_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
