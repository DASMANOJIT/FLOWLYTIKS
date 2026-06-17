-- AlterTable
ALTER TABLE "FacultyExtraIncentivePayment"
ADD COLUMN "paymentMethod" TEXT NOT NULL DEFAULT 'CASH',
ADD COLUMN "facultyPayoutId" TEXT,
ADD COLUMN "cashfreeTransferId" TEXT,
ADD COLUMN "cashfreeReferenceId" TEXT,
ADD COLUMN "utr" TEXT,
ADD COLUMN "transactionId" TEXT,
ADD COLUMN "failureReason" TEXT;

-- CreateIndex
CREATE INDEX "FacultyExtraIncentivePayment_paymentMethod_idx" ON "FacultyExtraIncentivePayment"("paymentMethod");
CREATE INDEX "FacultyExtraIncentivePayment_facultyPayoutId_idx" ON "FacultyExtraIncentivePayment"("facultyPayoutId");
