-- CreateEnum
CREATE TYPE "SalaryType" AS ENUM ('MONTHLY_FIXED', 'PER_CLASS', 'ATTENDANCE_BASED');

-- CreateEnum
CREATE TYPE "FacultyStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateTable
CREATE TABLE "Faculty" (
    "id" TEXT NOT NULL,
    "adminId" INTEGER,
    "facultyId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "gender" TEXT,
    "dob" TIMESTAMP(3),
    "address" TEXT,
    "designation" TEXT,
    "qualification" TEXT,
    "experienceYears" INTEGER,
    "joiningDate" TIMESTAMP(3) NOT NULL,
    "employmentType" TEXT,
    "salaryType" "SalaryType" NOT NULL,
    "salaryAmount" DECIMAL(12,2),
    "paymentNotes" TEXT,
    "status" "FacultyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Faculty_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_facultyId_key" ON "Faculty"("facultyId");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_username_key" ON "Faculty"("username");

-- CreateIndex
CREATE UNIQUE INDEX "Faculty_phone_key" ON "Faculty"("phone");

-- CreateIndex
CREATE INDEX "Faculty_adminId_idx" ON "Faculty"("adminId");

-- CreateIndex
CREATE INDEX "Faculty_status_idx" ON "Faculty"("status");

-- CreateIndex
CREATE INDEX "Faculty_createdAt_idx" ON "Faculty"("createdAt");

-- AddForeignKey
ALTER TABLE "Faculty" ADD CONSTRAINT "Faculty_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
