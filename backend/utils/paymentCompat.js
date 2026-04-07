const PAYMENT_COMPAT_COLUMNS = [
  "currency",
  "paymentProvider",
  "paidAt",
  "teacherAdminId",
];

export const legacyPaymentSelect = {
  id: true,
  month: true,
  academicYear: true,
  amount: true,
  status: true,
  phonepeTransactionId: true,
  phonepePaymentId: true,
  studentId: true,
  createdAt: true,
  updatedAt: true,
};

export const stripExtendedPaymentWriteData = (data = {}) => {
  const sanitized = { ...data };
  for (const key of PAYMENT_COMPAT_COLUMNS) {
    delete sanitized[key];
  }
  return sanitized;
};

export const isPaymentSchemaCompatibilityError = (error) => {
  const message = String(error?.message || "");
  if (!/does not exist|Unknown argument|Unknown field/i.test(message)) {
    return false;
  }

  return PAYMENT_COMPAT_COLUMNS.some(
    (column) =>
      message.includes(`Payment.${column}`) ||
      message.includes(`"${column}"`) ||
      message.includes(`\`${column}\``)
  );
};

export const logPaymentCompatibilityFallback = (label, error) => {
  console.warn(`${label} falling back to legacy Payment schema:`, error?.message || error);
};
