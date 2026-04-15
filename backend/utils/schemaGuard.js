import prisma from "../prisma/client.js";

const REQUIRED_COLUMNS = [
  { table: "Payment", columns: ["isLatePayment", "paidAt", "paymentProvider"] },
  { table: "UserSession", columns: ["closingRequestedAt"] },
];

const fetchTableColumns = async (tableName) => {
  const rows = await prisma.$queryRaw`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_name = ${tableName}
  `;

  return new Set(
    (rows || [])
      .map((row) => row?.column_name || row?.COLUMN_NAME)
      .filter(Boolean)
      .map((value) => String(value))
  );
};

export const verifyRequiredSchemaColumns = async () => {
  const mismatches = [];

  for (const requirement of REQUIRED_COLUMNS) {
    const availableColumns = await fetchTableColumns(requirement.table);
    const missingColumns = requirement.columns.filter((column) => !availableColumns.has(column));
    if (missingColumns.length) {
      mismatches.push({
        table: requirement.table,
        missingColumns,
      });
    }
  }

  if (mismatches.length) {
    const error = new Error("Required database columns are missing.");
    error.code = "SCHEMA_MISMATCH";
    error.details = mismatches;
    throw error;
  }
};
