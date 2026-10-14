import prisma from "../prisma/client.js";
import { readAdminDashboard } from "../services/adminDashboardService.js";

export const getAdminDashboardSummary = async (req, res) => {
  try {
    return res.json(await readAdminDashboard(req.query));
  } catch (error) {
    console.error("Admin dashboard summary failed", { code: error?.code || "SUMMARY_ERROR" });
    return res.status(error.status || 503).json({ success: false, message: error.status === 400 ? error.message : "Dashboard summary is unavailable. Please try again." });
  }
};

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
