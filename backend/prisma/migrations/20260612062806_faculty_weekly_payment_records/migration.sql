-- CreateTable
CREATE TABLE "WeeklyFacultyPaymentRecord" (
    "id" TEXT NOT NULL,
    "weekStart" DATE NOT NULL,
    "weekEnd" DATE NOT NULL,
    "totalEntries" INTEGER NOT NULL DEFAULT 0,
    "facultyCount" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paidAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "pendingAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'ONLINE',
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "paidAt" TIMESTAMP(3),
    "paidByAdminId" INTEGER,
    "paidByAdminName" TEXT,
    "remarks" TEXT,
    "payrollCycleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyFacultyPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPaymentRecord" (
    "id" TEXT NOT NULL,
    "weeklyPaymentRecordId" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "facultyCode" TEXT,
    "facultyName" TEXT,
    "attendanceEntries" INTEGER NOT NULL DEFAULT 0,
    "amount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "paymentMode" TEXT NOT NULL DEFAULT 'ONLINE',
    "status" TEXT NOT NULL DEFAULT 'UNPAID',
    "cashfreeTransferId" TEXT,
    "cashfreeReferenceId" TEXT,
    "utr" TEXT,
    "transactionId" TEXT,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "remarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyPaymentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyFacultyPaymentRecord_status_idx" ON "WeeklyFacultyPaymentRecord"("status");

-- CreateIndex
CREATE INDEX "WeeklyFacultyPaymentRecord_paymentMode_idx" ON "WeeklyFacultyPaymentRecord"("paymentMode");

-- CreateIndex
CREATE INDEX "WeeklyFacultyPaymentRecord_paidAt_idx" ON "WeeklyFacultyPaymentRecord"("paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyFacultyPaymentRecord_weekStart_weekEnd_key" ON "WeeklyFacultyPaymentRecord"("weekStart", "weekEnd");

-- CreateIndex
CREATE INDEX "FacultyPaymentRecord_facultyId_idx" ON "FacultyPaymentRecord"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyPaymentRecord_status_idx" ON "FacultyPaymentRecord"("status");

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPaymentRecord_weeklyPaymentRecordId_facultyId_key" ON "FacultyPaymentRecord"("weeklyPaymentRecordId", "facultyId");

-- AddForeignKey
ALTER TABLE "FacultyPaymentRecord" ADD CONSTRAINT "FacultyPaymentRecord_weeklyPaymentRecordId_fkey" FOREIGN KEY ("weeklyPaymentRecordId") REFERENCES "WeeklyFacultyPaymentRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPaymentRecord" ADD CONSTRAINT "FacultyPaymentRecord_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
