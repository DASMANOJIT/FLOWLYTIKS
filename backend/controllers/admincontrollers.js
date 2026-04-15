import prisma from "../prisma/client.js";

export const getAdminHealthCheck = async (req, res) => {
  try {
    const [dbProbe, latestPayment] = await Promise.all([
      prisma.$queryRaw`SELECT 1 as ok`,
      prisma.payment.findFirst({
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
    ]);

    return res.json({
      success: true,
      dbStatus: Array.isArray(dbProbe) && dbProbe.length ? "connected" : "unknown",
      prismaStatus: "ok",
      lastPaymentUpdateAt: latestPayment?.updatedAt
        ? new Date(latestPayment.updatedAt).toISOString()
        : null,
      paymentTestMode: process.env.NODE_ENV === "development",
      serverTimeUtc: new Date().toISOString(),
    });
  } catch (error) {
    return res.status(503).json({
      success: false,
      dbStatus: "unavailable",
      prismaStatus: "error",
      lastPaymentUpdateAt: null,
      paymentTestMode: process.env.NODE_ENV === "development",
      serverTimeUtc: new Date().toISOString(),
      message: "Health check failed",
    });
  }
};
