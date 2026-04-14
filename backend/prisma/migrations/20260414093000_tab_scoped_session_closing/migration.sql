-- AlterTable
ALTER TABLE "UserSession"
ADD COLUMN "closingRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UserSession_closingRequestedAt_idx" ON "UserSession"("closingRequestedAt");
