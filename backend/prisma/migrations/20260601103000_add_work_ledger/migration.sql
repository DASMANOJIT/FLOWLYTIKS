-- CreateEnum
CREATE TYPE "WorkLedgerShift" AS ENUM ('MORNING', 'AFTERNOON', 'EVENING');

-- CreateEnum
CREATE TYPE "LedgerAuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE');

-- CreateTable
CREATE TABLE "WorkLedgerEntry" (
    "id" TEXT NOT NULL,
    "facultyId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "shift" "WorkLedgerShift" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "remarks" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkLedgerEntryAudit" (
    "id" TEXT NOT NULL,
    "entryId" TEXT,
    "action" "LedgerAuditAction" NOT NULL,
    "changedBy" TEXT NOT NULL,
    "previousData" JSONB,
    "newData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkLedgerEntryAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkLedgerEntry_facultyId_idx" ON "WorkLedgerEntry"("facultyId");

-- CreateIndex
CREATE INDEX "WorkLedgerEntry_date_idx" ON "WorkLedgerEntry"("date");

-- CreateIndex
CREATE INDEX "WorkLedgerEntry_shift_idx" ON "WorkLedgerEntry"("shift");

-- CreateIndex
CREATE INDEX "WorkLedgerEntry_createdBy_idx" ON "WorkLedgerEntry"("createdBy");

-- CreateIndex
CREATE INDEX "WorkLedgerEntryAudit_entryId_idx" ON "WorkLedgerEntryAudit"("entryId");

-- CreateIndex
CREATE INDEX "WorkLedgerEntryAudit_changedBy_idx" ON "WorkLedgerEntryAudit"("changedBy");

-- CreateIndex
CREATE INDEX "WorkLedgerEntryAudit_createdAt_idx" ON "WorkLedgerEntryAudit"("createdAt");

-- AddForeignKey
ALTER TABLE "WorkLedgerEntry" ADD CONSTRAINT "WorkLedgerEntry_facultyId_fkey" FOREIGN KEY ("facultyId") REFERENCES "Faculty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkLedgerEntryAudit" ADD CONSTRAINT "WorkLedgerEntryAudit_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "WorkLedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
