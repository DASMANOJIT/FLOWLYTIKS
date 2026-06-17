import "../config/loadEnv.js";
import {
  getFacultyPayoutEmailConfigStatus,
  sendFacultyExtraIncentiveEmail,
  sendFacultyWeeklyPayoutEmail,
} from "../services/emailNotificationService.js";

const parseArgs = (argv) => {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--to") args.to = argv[index + 1];
    if (value === "--type") args.type = argv[index + 1];
  }
  return args;
};

const maskEmail = (email = "") => {
  const [local, domain] = String(email).split("@");
  if (!local || !domain) return "";
  return `${local.slice(0, 2)}***@${domain}`;
};

const main = async () => {
  const { to, type = "weekly" } = parseArgs(process.argv.slice(2));
  if (!to) {
    console.error("Usage: node scripts/testFacultyPayoutEmail.js --to test@example.com --type weekly");
    process.exit(1);
  }

  const normalizedType = String(type).toLowerCase();
  if (!["weekly", "extra"].includes(normalizedType)) {
    console.error("Type must be weekly or extra.");
    process.exit(1);
  }

  const config = getFacultyPayoutEmailConfigStatus();
  console.log("Faculty payout email test config:", {
    notificationEmailEnabledValue: process.env.NOTIFICATION_EMAIL_ENABLED || "",
    notificationsEnabled: config.enabled,
    resendApiConfigured: config.resendApiConfigured,
    resendFromConfigured: config.resendFromConfigured,
    fromEmail: config.fromEmail || "",
    recipientEmail: maskEmail(to),
    type: normalizedType,
  });

  const faculty = {
    id: "test-faculty",
    facultyId: "FAC-TEST",
    fullName: "Test Faculty",
    email: to,
  };

  const now = new Date();
  const result =
    normalizedType === "weekly"
      ? await sendFacultyWeeklyPayoutEmail({
          faculty,
          payout: {
            id: `test-weekly-${Date.now()}`,
            amount: 2500,
            paidAmount: 2500,
            paymentMode: "CASH",
            paidAt: now,
            transactionId: "TEST-WEEKLY-REF",
          },
          breakdown: {
            weekStart: new Date("2026-06-12T00:00:00.000Z"),
            weekEnd: new Date("2026-06-18T00:00:00.000Z"),
            paymentMethod: "Cash",
            paidAmount: 2500,
            payableAmount: 2500,
            paidAt: now,
            reference: "TEST-WEEKLY-REF",
          },
          idempotencyKey: `test-faculty-weekly-payout-paid-${Date.now()}`,
          skipNotificationLog: true,
        })
      : await sendFacultyExtraIncentiveEmail({
          faculty,
          payment: {
            id: `test-extra-${Date.now()}`,
            totalAmount: 600,
            paymentMethod: "CASH",
            paidAt: now,
            transactionId: "TEST-EXTRA-REF",
          },
          lineItems: [
            { name: "Mock Test Bonus", quantity: 3, rate: 100, amount: 300 },
            { name: "Workshop Incentive", quantity: 2, rate: 150, amount: 300 },
          ],
          idempotencyKey: `test-faculty-extra-incentive-paid-${Date.now()}`,
          skipNotificationLog: true,
        });

  console.log("Faculty payout email test result:", {
    success: Boolean(result.success),
    skipped: Boolean(result.skipped),
    duplicate: Boolean(result.duplicate),
    reason: result.reason || null,
    providerMessageId: result.providerMessageId || null,
    statusCode: result.statusCode || null,
    error: result.error || null,
  });

  if (!result.success && !result.skipped) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error("Faculty payout email test failed:", {
    name: error?.name || "Error",
    message: error?.message || "Unknown error",
    statusCode: error?.statusCode || null,
  });
  process.exit(1);
});
