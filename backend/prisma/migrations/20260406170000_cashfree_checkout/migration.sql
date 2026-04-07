-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('CASH', 'PHONEPE', 'CASHFREE');

-- CreateEnum
CREATE TYPE "GatewayPaymentStatus" AS ENUM ('PENDING', 'INITIATED', 'PAID', 'FAILED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "TeacherSettlementStatus" AS ENUM ('NOT_CONFIGURED', 'PENDING', 'ACTIVE', 'DISABLED');

-- AlterTable
ALTER TABLE "Admin"
  ADD COLUMN "cashfreeVendorId" TEXT,
  ADD COLUMN "cashfreeSettlementStatus" "TeacherSettlementStatus" NOT NULL DEFAULT 'NOT_CONFIGURED';

-- AlterTable
ALTER TABLE "Payment"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "paidAt" TIMESTAMP(3),
  ADD COLUMN "paymentProvider" "PaymentProvider",
  ADD COLUMN "teacherAdminId" INTEGER;

-- CreateTable
CREATE TABLE "PaymentGatewayOrder" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'CASHFREE',
  "status" "GatewayPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "paymentId" INTEGER NOT NULL,
  "studentId" INTEGER NOT NULL,
  "teacherAdminId" INTEGER,
  "amount" INTEGER NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'INR',
  "month" TEXT NOT NULL,
  "academicYear" INTEGER NOT NULL,
  "cashfreeOrderId" TEXT,
  "cashfreeCfOrderId" TEXT,
  "paymentSessionId" TEXT,
  "paymentMethodHint" TEXT,
  "paymentMethod" TEXT,
  "returnUrl" TEXT,
  "notifyUrl" TEXT,
  "orderStatus" TEXT,
  "orderExpiryTime" TIMESTAMP(3),
  "gatewayReference" TEXT,
  "metadata" JSONB,
  "rawCreateResponse" JSONB,
  "paidAt" TIMESTAMP(3),
  "verifiedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentGatewayOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAttempt" (
  "id" TEXT NOT NULL,
  "gatewayOrderId" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'CASHFREE',
  "status" "GatewayPaymentStatus" NOT NULL DEFAULT 'PENDING',
  "cashfreeOrderId" TEXT,
  "cfPaymentId" TEXT,
  "paymentGroup" TEXT,
  "paymentMethod" TEXT,
  "paymentMessage" TEXT,
  "bankReference" TEXT,
  "gatewayPaymentId" TEXT,
  "gatewayOrderReference" TEXT,
  "paymentAmount" DOUBLE PRECISION,
  "paymentTime" TIMESTAMP(3),
  "rawPayload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "PaymentAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentWebhookEvent" (
  "id" TEXT NOT NULL,
  "provider" "PaymentProvider" NOT NULL DEFAULT 'CASHFREE',
  "gatewayOrderId" TEXT,
  "dedupeKey" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "cashfreeOrderId" TEXT,
  "cfPaymentId" TEXT,
  "signature" TEXT,
  "payload" JSONB NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PaymentWebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Admin_cashfreeVendorId_key" ON "Admin"("cashfreeVendorId");

-- CreateIndex
CREATE INDEX "Payment_teacherAdminId_idx" ON "Payment"("teacherAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayOrder_cashfreeOrderId_key" ON "PaymentGatewayOrder"("cashfreeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentGatewayOrder_cashfreeCfOrderId_key" ON "PaymentGatewayOrder"("cashfreeCfOrderId");

-- CreateIndex
CREATE INDEX "PaymentGatewayOrder_paymentId_status_idx" ON "PaymentGatewayOrder"("paymentId", "status");

-- CreateIndex
CREATE INDEX "PaymentGatewayOrder_studentId_month_academicYear_idx" ON "PaymentGatewayOrder"("studentId", "month", "academicYear");

-- CreateIndex
CREATE INDEX "PaymentGatewayOrder_teacherAdminId_idx" ON "PaymentGatewayOrder"("teacherAdminId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAttempt_cfPaymentId_key" ON "PaymentAttempt"("cfPaymentId");

-- CreateIndex
CREATE INDEX "PaymentAttempt_gatewayOrderId_createdAt_idx" ON "PaymentAttempt"("gatewayOrderId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAttempt_cashfreeOrderId_idx" ON "PaymentAttempt"("cashfreeOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentWebhookEvent_dedupeKey_key" ON "PaymentWebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_cashfreeOrderId_idx" ON "PaymentWebhookEvent"("cashfreeOrderId");

-- CreateIndex
CREATE INDEX "PaymentWebhookEvent_cfPaymentId_idx" ON "PaymentWebhookEvent"("cfPaymentId");

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_teacherAdminId_fkey" FOREIGN KEY ("teacherAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayOrder" ADD CONSTRAINT "PaymentGatewayOrder_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayOrder" ADD CONSTRAINT "PaymentGatewayOrder_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentGatewayOrder" ADD CONSTRAINT "PaymentGatewayOrder_teacherAdminId_fkey" FOREIGN KEY ("teacherAdminId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAttempt" ADD CONSTRAINT "PaymentAttempt_gatewayOrderId_fkey" FOREIGN KEY ("gatewayOrderId") REFERENCES "PaymentGatewayOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentWebhookEvent" ADD CONSTRAINT "PaymentWebhookEvent_gatewayOrderId_fkey" FOREIGN KEY ("gatewayOrderId") REFERENCES "PaymentGatewayOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
