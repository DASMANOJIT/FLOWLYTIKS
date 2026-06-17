import { listAuditLogs } from "../services/auditLogService.js";

export const getAuditLogs = async (req, res) => {
  try {
    for (const key of ["startDate", "endDate"]) {
      if (req.query?.[key] && Number.isNaN(new Date(`${req.query[key]}T00:00:00.000Z`).getTime())) {
        return res.status(400).json({ success: false, message: `${key} must be a valid date.` });
      }
    }

    const data = await listAuditLogs(req.query || {});
    return res.json({ success: true, ...data });
  } catch (error) {
    console.error("Audit log API error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "Failed to load audit logs.",
    });
  }
};
