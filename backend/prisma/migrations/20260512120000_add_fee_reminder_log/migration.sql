CREATE TABLE "FeeReminderLog" (
  "id" TEXT NOT NULL,
  "studentId" INTEGER NOT NULL,
  "adminId" INTEGER,
  "month" TEXT NOT NULL,
  "academicYear" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "lastRemindedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "FeeReminderLog_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FeeReminderLog_studentId_month_academicYear_channel_key"
  ON "FeeReminderLog"("studentId", "month", "academicYear", "channel");
CREATE INDEX "FeeReminderLog_studentId_idx" ON "FeeReminderLog"("studentId");
CREATE INDEX "FeeReminderLog_adminId_idx" ON "FeeReminderLog"("adminId");
CREATE INDEX "FeeReminderLog_month_idx" ON "FeeReminderLog"("month");
CREATE INDEX "FeeReminderLog_academicYear_idx" ON "FeeReminderLog"("academicYear");
CREATE INDEX "FeeReminderLog_lastRemindedAt_idx" ON "FeeReminderLog"("lastRemindedAt");

ALTER TABLE "FeeReminderLog"
  ADD CONSTRAINT "FeeReminderLog_studentId_fkey"
  FOREIGN KEY ("studentId") REFERENCES "Student"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeeReminderLog"
  ADD CONSTRAINT "FeeReminderLog_adminId_fkey"
  FOREIGN KEY ("adminId") REFERENCES "Admin"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
