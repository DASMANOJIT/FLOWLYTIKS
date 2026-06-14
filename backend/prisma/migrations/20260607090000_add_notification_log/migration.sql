-- CreateTable
CREATE TABLE "NotificationLog" (
    "id" TEXT NOT NULL,
    "recipientType" TEXT NOT NULL,
    "recipientId" TEXT,
    "recipientEmail" TEXT,
    "recipientPhone" TEXT,
    "channel" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "whatsappLink" TEXT,
    "relatedWeekStart" DATE,
    "relatedWeekEnd" DATE,
    "relatedPayrollId" TEXT,
    "relatedPayoutId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "NotificationLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationLog_idempotencyKey_key" ON "NotificationLog"("idempotencyKey");

-- CreateIndex
CREATE INDEX "NotificationLog_recipientType_recipientId_idx" ON "NotificationLog"("recipientType", "recipientId");

-- CreateIndex
CREATE INDEX "NotificationLog_channel_idx" ON "NotificationLog"("channel");

-- CreateIndex
CREATE INDEX "NotificationLog_eventType_idx" ON "NotificationLog"("eventType");

-- CreateIndex
CREATE INDEX "NotificationLog_status_idx" ON "NotificationLog"("status");

-- CreateIndex
CREATE INDEX "NotificationLog_relatedWeekStart_relatedWeekEnd_idx" ON "NotificationLog"("relatedWeekStart", "relatedWeekEnd");

-- CreateIndex
CREATE INDEX "NotificationLog_relatedPayrollId_idx" ON "NotificationLog"("relatedPayrollId");

-- CreateIndex
CREATE INDEX "NotificationLog_relatedPayoutId_idx" ON "NotificationLog"("relatedPayoutId");

-- CreateIndex
CREATE INDEX "NotificationLog_createdAt_idx" ON "NotificationLog"("createdAt");
