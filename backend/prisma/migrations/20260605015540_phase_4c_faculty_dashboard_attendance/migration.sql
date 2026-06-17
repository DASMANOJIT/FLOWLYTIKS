/*
  Warnings:

  - A unique constraint covering the columns `[facultyId,date,shift]` on the table `WorkLedgerEntry` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "BankVerificationStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "FacultyPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED', 'CANCELLED', 'REVERSED');

-- CreateTable
CREATE TABLE "FacultyBankAccount" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "payoutMode" TEXT NOT NULL DEFAULT 'NONE',
    "accountHolderName" TEXT,
    "accountNumber" TEXT,
    "ifscCode" TEXT,
    "bankName" TEXT,
    "branchName" TEXT,
    "upiId" TEXT,
    "panNumber" TEXT,
    "payoutContactName" TEXT,
    "payoutContactPhone" TEXT,
    "payoutContactEmail" TEXT,
    "verificationStatus" "BankVerificationStatus" NOT NULL DEFAULT 'PENDING',
    "payoutEligible" BOOLEAN NOT NULL DEFAULT false,
    "payoutBlockedReason" TEXT,
    "payoutRemarks" TEXT,
    "payoutDetailsUpdatedBy" TEXT,
    "payoutDetailsUpdatedAt" TIMESTAMP(3),
    "cashfreeBeneficiaryId" TEXT,
    "cashfreeBeneficiaryStatus" TEXT,
    "cashfreeBeneficiaryCreatedAt" TIMESTAMP(3),
    "cashfreeBeneficiaryUpdatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyBankAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPayout" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "payrollId" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "FacultyPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "referenceId" TEXT,
    "transactionId" TEXT,
    "gatewayReference" TEXT,
    "cashfreeTransferId" TEXT,
    "cashfreeReferenceId" TEXT,
    "utr" TEXT,
    "paymentMethod" TEXT,
    "payoutMode" TEXT,
    "payoutAmount" DECIMAL(12,2),
    "paidAmount" DECIMAL(12,2),
    "unpaidAmount" DECIMAL(12,2),
    "failureReason" TEXT,
    "adminPayoutRemark" TEXT,
    "cashfreeStatus" TEXT,
    "idempotencyKey" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "lastRetryAt" TIMESTAMP(3),
    "payoutRequestedAt" TIMESTAMP(3),
    "payoutProcessedAt" TIMESTAMP(3),
    "payoutCompletedAt" TIMESTAMP(3),
    "payoutFailedAt" TIMESTAMP(3),
    "processingTimeMs" INTEGER,
    "createdBy" TEXT,
    "approvedBy" TEXT,
    "paidBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "payoutDate" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyPayout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyPayoutEvent" (
    "id" TEXT NOT NULL,
    "payoutId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "oldStatus" TEXT,
    "newStatus" TEXT,
    "cashfreeReferenceId" TEXT,
    "cashfreeTransferId" TEXT,
    "utr" TEXT,
    "message" TEXT,
    "rawPayloadJson" JSONB,
    "dedupeKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FacultyPayoutEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FacultyBankAccount_facultyId_idx" ON "FacultyBankAccount"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyBankAccount_verificationStatus_idx" ON "FacultyBankAccount"("verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPayout_idempotencyKey_key" ON "FacultyPayout"("idempotencyKey");

-- CreateIndex
CREATE INDEX "FacultyPayout_facultyId_idx" ON "FacultyPayout"("facultyId");

-- CreateIndex
CREATE INDEX "FacultyPayout_payrollId_idx" ON "FacultyPayout"("payrollId");

-- CreateIndex
CREATE INDEX "FacultyPayout_status_idx" ON "FacultyPayout"("status");

-- CreateIndex
CREATE INDEX "FacultyPayout_cashfreeReferenceId_idx" ON "FacultyPayout"("cashfreeReferenceId");

-- CreateIndex
CREATE INDEX "FacultyPayout_cashfreeTransferId_idx" ON "FacultyPayout"("cashfreeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPayoutEvent_dedupeKey_key" ON "FacultyPayoutEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "FacultyPayoutEvent_payoutId_idx" ON "FacultyPayoutEvent"("payoutId");

-- CreateIndex
CREATE INDEX "FacultyPayoutEvent_eventType_idx" ON "FacultyPayoutEvent"("eventType");

-- CreateIndex
CREATE INDEX "FacultyPayoutEvent_createdAt_idx" ON "FacultyPayoutEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorkLedgerEntry_facultyId_date_shift_key" ON "WorkLedgerEntry"("facultyId", "date", "shift");

-- AddForeignKey
ALTER TABLE "FacultyBankAccount" ADD CONSTRAINT "FacultyBankAccount_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPayout" ADD CONSTRAINT "FacultyPayout_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPayout" ADD CONSTRAINT "FacultyPayout_payrollId_fkey" FOREIGN KEY ("payrollId") REFERENCES "faculty_payrolls"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FacultyPayoutEvent" ADD CONSTRAINT "FacultyPayoutEvent_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "FacultyPayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
