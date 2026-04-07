import prisma from "../prisma/client.js";
import { phonepeConfig, generateChecksum } from "../config/phonepe.config.js";
import { getAcademicYear } from "../utils/academicYear.js";
import { sendFeePaidWhatsAppNotification } from "../services/whatsappservice.js";
import { autoPromoteIfEligible } from "./studentcontrollers.js";
import { withPgAdvisoryLock } from "../utils/dbLocks.js";
import {
  isPaymentSchemaCompatibilityError,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";

export const initiatePhonePePayment = async (req, res) => {
  try {
    const { studentId, amount, month } = req.body;
    const tokenStudentId = Number(req.user?.id);
    const requestedStudentId = Number(studentId);
    const numericAmount = Number(amount);
    const academicYear = getAcademicYear();
    const frontendBaseUrl = process.env.FRONTEND_URL || "http://localhost:3000";
    const backendBaseUrl = process.env.BACKEND_URL || "http://localhost:5000";

    if (req.userRole !== "student") {
      return res.status(403).json({ message: "Only students can initiate payment" });
    }

    if (!requestedStudentId || tokenStudentId !== requestedStudentId) {
      return res.status(403).json({ message: "You can only pay your own fees" });
    }

    if (!month || !numericAmount || numericAmount <= 0) {
      return res.status(400).json({ message: "Invalid payment payload" });
    }

    if (
      !phonepeConfig.merchantId ||
      !phonepeConfig.saltKey ||
      !phonepeConfig.saltIndex ||
      !phonepeConfig.baseUrl
    ) {
      return res.status(500).json({ message: "PhonePe is not configured on server" });
    }

    const paymentKey = `phonepe:initiate:${requestedStudentId}:${academicYear}:${month}`;
    const result = await withPgAdvisoryLock(
      prisma,
      paymentKey,
      async () => {
        const existing = await prisma.payment.findUnique({
          where: {
            studentId_month_academicYear: {
              studentId: requestedStudentId,
              month,
              academicYear,
            },
          },
        });

        if (existing?.status === "paid") {
          return { alreadyPaid: true };
        }

        const transactionId = `TXN_${requestedStudentId}_${Date.now()}`;
        const payload = {
          merchantId: phonepeConfig.merchantId,
          merchantTransactionId: transactionId,
          merchantUserId: `STU_${requestedStudentId}`,
          amount: numericAmount * 100,
          redirectUrl: `${frontendBaseUrl}/payment-success?txnid=${transactionId}`,
          redirectMode: "REDIRECT",
          callbackUrl: `${backendBaseUrl}/api/payments/phonepe/callback`,
          paymentInstrument: {
            type: "PAY_PAGE",
          },
        };

        const { base64Payload, checksum } = generateChecksum(payload);
        const phonePeResponse = await fetch(`${phonepeConfig.baseUrl}/pg/v1/pay`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-VERIFY": checksum,
            accept: "application/json",
          },
          body: JSON.stringify({ request: base64Payload }),
        });

        const phonePeData = await phonePeResponse.json();
        const redirectUrl =
          phonePeData?.data?.instrumentResponse?.redirectInfo?.url || null;

        if (!phonePeResponse.ok || !phonePeData?.success || !redirectUrl) {
          console.error("PhonePe initiation failed:", phonePeData);
          return { initiationFailed: true };
        }

        const paymentUpsertArgs = {
          where: {
            studentId_month_academicYear: {
              studentId: requestedStudentId,
              month,
              academicYear,
            },
          },
          update: {
            amount: numericAmount,
            currency: "INR",
            status: "created",
            paymentProvider: "PHONEPE",
            phonepeTransactionId: transactionId,
            phonepePaymentId: null,
          },
          create: {
            studentId: requestedStudentId,
            month,
            amount: numericAmount,
            academicYear,
            currency: "INR",
            status: "created",
            paymentProvider: "PHONEPE",
            phonepeTransactionId: transactionId,
          },
        };

        try {
          await prisma.payment.upsert(paymentUpsertArgs);
        } catch (err) {
          if (!isPaymentSchemaCompatibilityError(err)) throw err;
          logPaymentCompatibilityFallback("initiatePhonePePayment", err);
          await prisma.payment.upsert({
            ...paymentUpsertArgs,
            update: stripExtendedPaymentWriteData(paymentUpsertArgs.update),
            create: stripExtendedPaymentWriteData(paymentUpsertArgs.create),
          });
        }

        return {
          redirectUrl,
          merchantTransactionId: transactionId,
        };
      },
      {
        onLocked: () => ({ locked: true }),
      }
    );

    if (result?.locked) {
      return res.status(409).json({
        message: "A payment request for this month is already in progress. Please wait a moment.",
      });
    }

    if (result?.alreadyPaid) {
      return res.status(400).json({ message: "This month is already paid" });
    }

    if (result?.initiationFailed) {
      return res.status(502).json({ message: "PhonePe initiation failed" });
    }

    res.json(result);
  } catch (err) {
    console.error("PhonePe error:", err);
    res.status(500).json({ message: "PhonePe initiation failed" });
  }
};

export const phonePeCallback = async (req, res) => {
  try {
    let merchantTransactionId;
    let transactionId;
    let code;

    if (req.body?.response) {
      const decoded = JSON.parse(
        Buffer.from(req.body.response, "base64").toString("utf-8")
      );
      merchantTransactionId = decoded?.data?.merchantTransactionId;
      transactionId = decoded?.data?.transactionId;
      code = decoded?.code;
    } else {
      merchantTransactionId = req.body?.merchantTransactionId;
      transactionId = req.body?.transactionId;
      code = req.body?.code;
    }

    if (!merchantTransactionId) {
      return res.status(400).json({ message: "Invalid callback payload" });
    }

    const result = await withPgAdvisoryLock(
      prisma,
      `phonepe:callback:${merchantTransactionId}`,
      async () => {
        const payment = await prisma.payment.findFirst({
          where: { phonepeTransactionId: merchantTransactionId },
        });

        if (!payment) return { missing: true };

        if (code === "PAYMENT_SUCCESS" || code === "SUCCESS") {
          const paidData = {
            status: "paid",
            paymentProvider: "PHONEPE",
            paidAt: new Date(),
            phonepePaymentId: transactionId,
          };

          let transition;
          try {
            transition = await prisma.payment.updateMany({
              where: {
                id: payment.id,
                status: {
                  not: "paid",
                },
              },
              data: paidData,
            });
          } catch (err) {
            if (!isPaymentSchemaCompatibilityError(err)) throw err;
            logPaymentCompatibilityFallback("phonePeCallback:success", err);
            transition = await prisma.payment.updateMany({
              where: {
                id: payment.id,
                status: {
                  not: "paid",
                },
              },
              data: stripExtendedPaymentWriteData(paidData),
            });
          }

          const updatedPayment = await prisma.payment.findUnique({
            where: { id: payment.id },
          });

          return {
            payment: updatedPayment,
            firstSuccess: transition.count > 0,
          };
        }

        if (payment.status !== "paid") {
          await prisma.payment.update({
            where: { id: payment.id },
            data: { status: "failed", phonepePaymentId: transactionId || null },
          });
        }

        return {
          payment,
          firstSuccess: false,
        };
      }
    );

    if (result?.missing) {
      return res.status(400).json({ message: "Payment not found" });
    }

    if (result?.firstSuccess && result.payment) {
      await autoPromoteIfEligible(Number(result.payment.studentId), result.payment.academicYear);

      const student = await prisma.student.findUnique({
        where: { id: Number(result.payment.studentId) },
        select: { id: true, name: true, phone: true },
      });

      if (student) {
        sendFeePaidWhatsAppNotification({
          student,
          payment: result.payment,
          mode: "phonepe",
        }).catch((err) => {
          console.error("WhatsApp fee-paid send failed (phonepe):", err.message);
        });
      }
    }

    return res.json({ message: "Callback processed" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Callback error" });
  }
};

export const getPhonePePaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!transactionId) {
      return res.status(400).json({ message: "transactionId required" });
    }

    const payment = await prisma.payment.findFirst({
      where: { phonepeTransactionId: transactionId },
    });

    if (!payment) {
      return res.status(404).json({ message: "Payment not found" });
    }

    if (
      req.userRole === "student" &&
      Number(req.user?.id) !== Number(payment.studentId)
    ) {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (req.userRole !== "student" && req.userRole !== "admin") {
      return res.status(403).json({ message: "Forbidden" });
    }

    return res.json({
      status: payment.status,
      month: payment.month,
      amount: payment.amount,
      academicYear: payment.academicYear,
    });
  } catch (err) {
    console.error("PhonePe status error:", err);
    res.status(500).json({ message: "Failed to fetch payment status" });
  }
};
