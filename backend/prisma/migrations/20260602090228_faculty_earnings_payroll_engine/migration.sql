-- CreateEnum
CREATE TYPE "FacultyEarningsPayrollStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PAID', 'REJECTED', 'LOCKED');

-- CreateTable
CREATE TABLE "payroll_cycles" (
    "id" TEXT NOT NULL,
    "cycleNumber" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "FacultyEarningsPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "ledgerLocked" BOOLEAN NOT NULL DEFAULT false,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_cycles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculty_payrolls" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "payrollCycleId" TEXT NOT NULL,
    "totalEntries" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "FacultyEarningsPayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "paidBy" TEXT,
    "paidAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "faculty_payrolls_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payroll_cycles_cycleNumber_key" ON "payroll_cycles"("cycleNumber");

-- CreateIndex
CREATE INDEX "payroll_cycles_status_idx" ON "payroll_cycles"("status");

-- CreateIndex
CREATE INDEX "payroll_cycles_ledgerLocked_idx" ON "payroll_cycles"("ledgerLocked");

-- CreateIndex
CREATE INDEX "payroll_cycles_startDate_endDate_idx" ON "payroll_cycles"("startDate", "endDate");

-- CreateIndex
CREATE UNIQUE INDEX "payroll_cycles_startDate_endDate_key" ON "payroll_cycles"("startDate", "endDate");

-- CreateIndex
CREATE INDEX "faculty_payrolls_facultyId_idx" ON "faculty_payrolls"("facultyId");

-- CreateIndex
CREATE INDEX "faculty_payrolls_payrollCycleId_idx" ON "faculty_payrolls"("payrollCycleId");

-- CreateIndex
CREATE INDEX "faculty_payrolls_status_idx" ON "faculty_payrolls"("status");

-- CreateIndex
CREATE INDEX "faculty_payrolls_approvedAt_idx" ON "faculty_payrolls"("approvedAt");

-- CreateIndex
CREATE INDEX "faculty_payrolls_paidAt_idx" ON "faculty_payrolls"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "faculty_payrolls_facultyId_payrollCycleId_key" ON "faculty_payrolls"("facultyId", "payrollCycleId");

-- AddForeignKey
ALTER TABLE "faculty_payrolls" ADD CONSTRAINT "faculty_payrolls_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "faculty_payrolls" ADD CONSTRAINT "faculty_payrolls_payrollCycleId_fkey" FOREIGN KEY ("payrollCycleId") REFERENCES "payroll_cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
