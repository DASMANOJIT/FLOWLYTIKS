-- CreateTable
CREATE TABLE "FacultyPasswordOtp" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT 'reset',
    "otpHash" TEXT NOT NULL,
    "resetToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FacultyPasswordOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FacultyPasswordOtp_phone_purpose_key" ON "FacultyPasswordOtp"("phone", "purpose");

-- CreateIndex
CREATE INDEX "FacultyPasswordOtp_expiresAt_idx" ON "FacultyPasswordOtp"("expiresAt");
