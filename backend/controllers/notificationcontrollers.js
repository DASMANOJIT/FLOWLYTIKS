import { listAdminNotificationLogs } from "../services/notificationService.js";

export const getAdminNotificationLogs = async (req, res) => {
  try {
    const notifications = await listAdminNotificationLogs({
      eventType: req.query.eventType,
      channel: req.query.channel,
      status: req.query.status,
      limit: req.query.limit,
    });

    return res.json({ success: true, notifications });
  } catch (error) {
    console.error("Admin notification log error:", error?.message || error);
    return res.status(500).json({
      success: false,
      message: "Failed to load notification logs.",
    });
  }
};
