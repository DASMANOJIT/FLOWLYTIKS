const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|clientsecret|apikey|api_key|session|rawbody)/i;

const sanitizeValue = (value, depth = 0) => {
  if (value == null) return value;
  if (depth > 4) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, entry]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : sanitizeValue(entry, depth + 1),
        ])
    );
  }

  if (typeof value === "string") {
    return value.length > 240 ? `${value.slice(0, 237)}...` : value;
  }

  return value;
};

const baseLog = (level, event, meta = {}) => {
  const payload = {
    event,
    timestamp: new Date().toISOString(),
    ...sanitizeValue(meta),
  };

  // eslint-disable-next-line no-console
  console[level](`[flowlytiks] ${event}`, payload);
};

export const logInfo = (event, meta = {}) => baseLog("info", event, meta);
export const logWarn = (event, meta = {}) => baseLog("warn", event, meta);
export const logError = (event, meta = {}) => baseLog("error", event, meta);

export const getRequestIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
};

export const buildRequestLogMeta = (req, extra = {}) => ({
  method: req.method,
  path: req.originalUrl || req.url,
  ip: getRequestIp(req),
  userId: req.user?.id || null,
  role: req.userRole || null,
  ...extra,
});
