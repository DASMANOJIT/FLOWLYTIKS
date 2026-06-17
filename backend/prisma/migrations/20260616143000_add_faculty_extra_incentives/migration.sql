-- CreateTable
CREATE TABLE "ExtraIncentiveType" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rate" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExtraIncentiveType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyExtraIncentivePayment" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "totalAmount" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "paidByAdminId" INTEGER NOT NULL,
    "paidByAdminName" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyExtraIncentivePayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FacultyExtraIncentiveEntry" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "incentiveTypeId" TEXT NOT NULL,
    "quantityChange" INTEGER NOT NULL,
    "rateSnapshot" DECIMAL(12,2) NOT NULL,
    "amountSnapshot" DECIMAL(12,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentRecordId" TEXT,
    "createdByType" TEXT NOT NULL,
    "createdById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyExtraIncentiveEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExtraIncentiveType_isActive_idx" ON "ExtraIncentiveType"("isActive");
CREATE INDEX "ExtraIncentiveType_createdAt_idx" ON "ExtraIncentiveType"("createdAt");
CREATE INDEX "FacultyExtraIncentivePayment_facultyId_idx" ON "FacultyExtraIncentivePayment"("facultyId");
CREATE INDEX "FacultyExtraIncentivePayment_status_idx" ON "FacultyExtraIncentivePayment"("status");
CREATE INDEX "FacultyExtraIncentivePayment_paidAt_idx" ON "FacultyExtraIncentivePayment"("paidAt");
CREATE INDEX "FacultyExtraIncentiveEntry_facultyId_idx" ON "FacultyExtraIncentiveEntry"("facultyId");
CREATE INDEX "FacultyExtraIncentiveEntry_incentiveTypeId_idx" ON "FacultyExtraIncentiveEntry"("incentiveTypeId");
CREATE INDEX "FacultyExtraIncentiveEntry_status_idx" ON "FacultyExtraIncentiveEntry"("status");
CREATE INDEX "FacultyExtraIncentiveEntry_paymentRecordId_idx" ON "FacultyExtraIncentiveEntry"("paymentRecordId");
CREATE INDEX "FacultyExtraIncentiveEntry_createdAt_idx" ON "FacultyExtraIncentiveEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "FacultyExtraIncentivePayment" ADD CONSTRAINT "FacultyExtraIncentivePayment_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacultyExtraIncentiveEntry" ADD CONSTRAINT "FacultyExtraIncentiveEntry_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacultyExtraIncentiveEntry" ADD CONSTRAINT "FacultyExtraIncentiveEntry_incentiveTypeId_fkey" FOREIGN KEY ("incentiveTypeId") REFERENCES "ExtraIncentiveType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FacultyExtraIncentiveEntry" ADD CONSTRAINT "FacultyExtraIncentiveEntry_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "FacultyExtraIncentivePayment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
