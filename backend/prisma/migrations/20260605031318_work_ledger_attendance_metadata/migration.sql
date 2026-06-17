-- AlterTable
ALTER TABLE "WorkLedgerEntry" ADD COLUMN     "updatedByAdminId" INTEGER,
ADD COLUMN     "updatedByFacultyId" TEXT,
ADD COLUMN     "updatedByName" TEXT,
ADD COLUMN     "updatedByRole" TEXT;
