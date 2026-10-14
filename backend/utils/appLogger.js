const REDACTED = "[redacted]";

const SENSITIVE_KEY_PATTERN =
  /(password|token|secret|authorization|cookie|otp|clientsecret|apikey|api_key|session|rawbody|^state$|^code$|credential|^headers$|client[_-]?id|salt[_-]?key|^signature$)/i;

export const getRequestPath = (value) => {
  try {
    return new URL(String(value || "/"), "http://log.invalid").pathname;
  } catch {
    return "[invalid path]";
  }
};

const sanitizeText = (value) => value
  .replace(/\b(?:postgres(?:ql)?:\/\/)[^\s"'<>]+/gi, REDACTED)
  .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => {
    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch { return REDACTED; }
  })
  .replace(/\bBearer\s+\S+/gi, `Bearer ${REDACTED}`)
  .replace(/\/[^\s"'<>?]+\?[^\s"'<>]+/g, (url) => getRequestPath(url))
  .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]+\b/g, REDACTED)
  .replace(/\b(password|(?:access|refresh|id)[_-]?token|token|client[_-]?secret|secret|authorization|cookie|otp|api[_-]?key|state|code|salt[_-]?key|signature|client[_-]?id)\s*[=:]\s*[^\s,;]+/gi, `$1=${REDACTED}`);

const sanitizeValue = (value, depth = 0) => {
  if (value == null) return value;
  if (depth > 4) return "[truncated]";

  if (Array.isArray(value)) {
    return value.slice(0, 25).map((entry) => sanitizeValue(entry, depth + 1));
  }

  if (value instanceof Error) {
    return {
      name: value.name,
      ...(value.code ? { code: /^(P\d{4}|E[A-Z_]+)$/.test(String(value.code)) ? value.code : REDACTED } : {}),
      ...(Number.isInteger(value.statusCode || value.status) ? { status: value.statusCode || value.status } : {}),
      message: sanitizeValue(value.message, depth + 1),
    };
  }

  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 40)
        .map(([key, entry]) => [
          key,
          key === "code" && /^(P\d{4}|E[A-Z_]+)$/.test(String(entry)) ? entry
            : SENSITIVE_KEY_PATTERN.test(key) ? REDACTED
            : /^(path|url|originalUrl)$/i.test(key) ? getRequestPath(entry)
            : sanitizeValue(entry, depth + 1),
        ])
    );
  }

  if (typeof value === "string") {
    const sanitized = sanitizeText(value);
    return sanitized.length > 240 ? `${sanitized.slice(0, 237)}...` : sanitized;
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
  return req.ip || req.socket?.remoteAddress || "unknown";
};

export const buildRequestLogMeta = (req, extra = {}) => ({
  method: req.method,
  path: getRequestPath(req.originalUrl || req.url),
  ip: getRequestIp(req),
  userId: req.user?.id || null,
  role: req.userRole || null,
  ...extra,
});
