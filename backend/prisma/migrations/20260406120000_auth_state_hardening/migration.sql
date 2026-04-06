-- CreateTable
CREATE TABLE "AuthRateLimitEvent" (
    "id" TEXT NOT NULL,
    "namespace" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthRateLimitEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuthRateLimitEvent_namespace_key_createdAt_idx" ON "AuthRateLimitEvent"("namespace", "key", "createdAt");

-- CreateIndex
CREATE INDEX "AuthRateLimitEvent_createdAt_idx" ON "AuthRateLimitEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Student_email_key" ON "Student"("email");

-- CreateIndex
CREATE INDEX "UserSession_role_userId_idx" ON "UserSession"("role", "userId");

-- CreateIndex
CREATE INDEX "UserSession_expiresAt_idx" ON "UserSession"("expiresAt");

-- CreateIndex
CREATE INDEX "UserSession_revokedAt_idx" ON "UserSession"("revokedAt");

-- CreateIndex
CREATE INDEX "Payment_phonepeTransactionId_idx" ON "Payment"("phonepeTransactionId");

-- CreateIndex
CREATE INDEX "Payment_phonepePaymentId_idx" ON "Payment"("phonepePaymentId");
