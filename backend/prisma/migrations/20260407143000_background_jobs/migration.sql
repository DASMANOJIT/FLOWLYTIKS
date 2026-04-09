CREATE TYPE "BackgroundJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "BackgroundJobType" AS ENUM (
  'DAILY_FEE_REMINDER',
  'ANNUAL_STUDENT_PROMOTION',
  'ASSISTANT_BULK_REMINDER',
  'ASSISTANT_BULK_MARK_PAID',
  'PAYMENT_RECONCILIATION',
  'REPORT_GENERATION'
);

CREATE TABLE "BackgroundJob" (
  "id" TEXT NOT NULL,
  "type" "BackgroundJobType" NOT NULL,
  "status" "BackgroundJobStatus" NOT NULL DEFAULT 'PENDING',
  "source" TEXT NOT NULL,
  "requestedByRole" TEXT,
  "requestedByUserId" INTEGER,
  "dedupeKey" TEXT,
  "payload" JSONB,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "processedItems" INTEGER NOT NULL DEFAULT 0,
  "succeededItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "errorMessage" TEXT,
  "result" JSONB,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "lastHeartbeatAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "BackgroundJob_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackgroundJob_dedupeKey_key" ON "BackgroundJob"("dedupeKey");
CREATE INDEX "BackgroundJob_status_createdAt_idx" ON "BackgroundJob"("status", "createdAt");
CREATE INDEX "BackgroundJob_type_status_idx" ON "BackgroundJob"("type", "status");
CREATE INDEX "BackgroundJob_requestedByRole_requestedByUserId_idx" ON "BackgroundJob"("requestedByRole", "requestedByUserId");
