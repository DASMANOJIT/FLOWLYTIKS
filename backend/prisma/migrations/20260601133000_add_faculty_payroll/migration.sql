-- CreateEnum
CREATE TYPE "PayrollBatchStatus" AS ENUM ('PENDING', 'PROCESSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayrollPaymentStatus" AS ENUM ('PENDING', 'PAID');

-- CreateEnum
CREATE TYPE "PayrollAuditAction" AS ENUM ('GENERATE', 'PROCESS', 'CANCEL');

-- CreateTable
CREATE TABLE "FacultyPayrollBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "PayrollBatchStatus" NOT NULL DEFAULT 'PENDING',
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyPayrollBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPayroll" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "presentDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "halfDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "absentDays" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "calculatedAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "bonus" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deduction" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "netAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentStatus" "PayrollPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyPayroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPaymentHistory" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "payrollId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "paymentDate" TIMESTAMP(3) NOT NULL,
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyPaymentHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPayrollAudit" (
    "id" TEXT NOT NULL,
    "batchId" TEXT,
    "action" "PayrollAuditAction" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyPayrollAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPayrollBatch_batchNumber_key" ON "FacultyPayrollBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "FacultyPayrollBatch_weekStart_weekEnd_idx" ON "FacultyPayrollBatch"("weekStart", "weekEnd");

-- CreateIndex
CREATE INDEX "FacultyPayrollBatch_status_idx" ON "FacultyPayrollBatch"("status");

-- CreateIndex
CREATE INDEX "FacultyPayrollBatch_createdAt_idx" ON "FacultyPayrollBatch"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPayroll_facultyId_batchId_key" ON "FacultyPayroll"("facultyId", "batchId");

-- CreateIndex
CREATE INDEX "FacultyPayroll_facultyId_idx" ON "FacultyPayroll"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyPayroll_batchId_idx" ON "FacultyPayroll"("batchId");

-- CreateIndex
CREATE INDEX "FacultyPayroll_paymentStatus_idx" ON "FacultyPayroll"("paymentStatus");

-- CreateIndex
CREATE INDEX "FacultyPaymentHistory_facultyId_idx" ON "FacultyPaymentHistory"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyPaymentHistory_payrollId_idx" ON "FacultyPaymentHistory"("payrollId");

-- CreateIndex
CREATE INDEX "FacultyPaymentHistory_paymentDate_idx" ON "FacultyPaymentHistory"("paymentDate");

-- CreateIndex
CREATE INDEX "FacultyPayrollAudit_batchId_idx" ON "FacultyPayrollAudit"("batchId");

-- CreateIndex
CREATE INDEX "FacultyPayrollAudit_changedBy_idx" ON "FacultyPayrollAudit"("changedBy");

-- CreateIndex
CREATE INDEX "FacultyPayrollAudit_createdAt_idx" ON "FacultyPayrollAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "FacultyPayroll" ADD CONSTRAINT "FacultyPayroll_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPayroll" ADD CONSTRAINT "FacultyPayroll_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FacultyPayrollBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPaymentHistory" ADD CONSTRAINT "FacultyPaymentHistory_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPaymentHistory" ADD CONSTRAINT "FacultyPaymentHistory_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "FacultyPayroll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPayrollAudit" ADD CONSTRAINT "FacultyPayrollAudit_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "FacultyPayrollBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
