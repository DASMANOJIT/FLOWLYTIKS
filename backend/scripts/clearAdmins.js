import "../config/loadEnv.js";
import prisma from "../prisma/client.js";

const confirmationFlag = "--confirm-delete-admins";

if (!process.argv.includes(confirmationFlag)) {
  console.error(
    `Refusing to delete admins without explicit confirmation. Re-run with ${confirmationFlag}.`
  );
  process.exit(1);
}

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to delete admins while NODE_ENV=production.");
  process.exit(1);
}

try {
  const summary = await prisma.$transaction(async (tx) => {
    const [adminCount, paymentLinks, gatewayLinks, sessionLinks] = await Promise.all([
      tx.admin.count(),
      tx.payment.count({ where: { teacherAdminId: { not: null } } }),
      tx.paymentGatewayOrder.count({ where: { teacherAdminId: { not: null } } }),
      tx.userSession.count({ where: { role: "admin" } }),
    ]);

    if (paymentLinks > 0) {
      await tx.payment.updateMany({
        where: { teacherAdminId: { not: null } },
        data: { teacherAdminId: null },
      });
    }

    if (gatewayLinks > 0) {
      await tx.paymentGatewayOrder.updateMany({
        where: { teacherAdminId: { not: null } },
        data: { teacherAdminId: null },
      });
    }

    if (sessionLinks > 0) {
      await tx.userSession.deleteMany({
        where: { role: "admin" },
      });
    }

    const deletedAdmins = await tx.admin.deleteMany({});

    return {
      adminCount,
      clearedPaymentLinks: paymentLinks,
      clearedGatewayLinks: gatewayLinks,
      clearedSessions: sessionLinks,
      deletedAdmins: deletedAdmins.count,
    };
  });

  console.log("Admin cleanup complete:", summary);
} catch (error) {
  console.error("Failed to clear admins:", error?.message || error);
  process.exit(1);
} finally {
  await prisma.$disconnect();
}
