import prisma from "../prisma/client.js";
import { isLatePaymentForPeriod } from "../utils/paymentPeriod.js";
import {
  getDueMonthsForReminder,
  sendFeePaidWhatsAppNotification,
  sendFeeReminderWhatsApp,
} from "./whatsappservice.js";
import {
  isPaymentSchemaCompatibilityError,
  logPaymentCompatibilityFallback,
  stripExtendedPaymentWriteData,
} from "../utils/paymentCompat.js";

const getPaidMonthsSet = (payments) => {
  const set = new Set();
  for (const payment of payments || []) {
    if (payment?.status === "paid" && payment?.month) {
      set.add(payment.month);
    }
  }
  return set;
};

export const markPaidForStudent = async ({
  student,
  month,
  academicYear,
  monthlyFee,
  teacherAdminId = null,
}) => {
  const existing = await prisma.payment.findUnique({
    where: {
      studentId_month_academicYear: {
        studentId: Number(student.id),
        month,
        academicYear,
      },
    },
  });

  if (existing?.status === "paid") {
    return { status: "already_paid", payment: existing };
  }

  const paidAt = new Date();
  const paymentData = {
    amount: Number(monthlyFee),
    status: "paid",
    currency: "INR",
    paymentProvider: "CASH",
    paidAt,
    isLatePayment: isLatePaymentForPeriod({
      month,
      academicYear,
      paidAt,
    }),
    phonepeTransactionId: null,
    phonepePaymentId: null,
    teacherAdminId: teacherAdminId ? Number(teacherAdminId) : null,
  };

  let payment;
  try {
    if (existing) {
      payment = await prisma.payment.update({
        where: { id: existing.id },
        data: paymentData,
      });
    } else {
      payment = await prisma.payment.create({
        data: {
          studentId: Number(student.id),
          month,
          academicYear,
          ...paymentData,
        },
      });
    }
  } catch (err) {
    if (!isPaymentSchemaCompatibilityError(err)) throw err;
    logPaymentCompatibilityFallback("markPaidForStudent", err);
    if (existing) {
      payment = await prisma.payment.update({
        where: { id: existing.id },
        data: stripExtendedPaymentWriteData(paymentData),
      });
    } else {
      payment = await prisma.payment.create({
        data: stripExtendedPaymentWriteData({
          studentId: Number(student.id),
          month,
          academicYear,
          ...paymentData,
        }),
      });
    }
  }

  sendFeePaidWhatsAppNotification({
    student,
    payment,
    mode: "cash",
  }).catch((err) => {
    console.error("Fee-paid WhatsApp send failed:", err.message);
  });

  return { status: "created", payment };
};

export const sendReminderToStudent = async ({
  student,
  month,
  academicYear,
  monthlyFee,
}) => {
  const paidMonths = (student.payments || []).map((payment) => payment.month);
  const paidSet = getPaidMonthsSet(student.payments);

  let dueMonths = [];
  if (month) {
    if (!paidSet.has(month)) dueMonths = [month];
  } else {
    dueMonths = getDueMonthsForReminder({ paidMonths });
  }

  if (!dueMonths.length) {
    return { sent: false, reason: "No due months" };
  }

  await sendFeeReminderWhatsApp({
    student,
    dueMonths,
    monthlyFee,
    academicYear,
  });

  return { sent: true, dueMonths };
};
