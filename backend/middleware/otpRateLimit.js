const buckets = new Map();

const nowMs = () => Date.now();

const getClientIp = (req) =>
  String(
    req.headers["x-forwarded-for"]?.split(",")[0]?.trim() ||
      req.ip ||
      req.connection?.remoteAddress ||
      ""
  );

const digitsOnly = (value) => String(value || "").replace(/[^\d]/g, "");

const phoneKeyFromBody = (req) => {
  const raw = req.body?.phone;
  const digits = digitsOnly(raw);
  if (!digits) return "";
  // Use last 10 digits to avoid +91/0 prefix differences.
  return digits.length >= 10 ? digits.slice(-10) : digits;
};

const makeLimiter = ({ windowMs, max, keyFn }) => {
  return (req, res, next) => {
    const key = String(keyFn(req) || "");
    if (!key) return next();

    const now = nowMs();
    const existing = buckets.get(key);
    const entry =
      existing && existing.resetAt > now
        ? existing
        : { count: 0, resetAt: now + windowMs };

    entry.count += 1;
    buckets.set(key, entry);

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        success: false,
        message: "Too many OTP requests. Please try again shortly.",
      });
    }

    return next();
  };
};

// 1 OTP request / 30s per phone+purpose (fallback: IP)
export const otpSendRateLimit = makeLimiter({
  windowMs: 30_000,
  max: 1,
  keyFn: (req) => {
    const purpose = String(req.body?.purpose || "").trim() || "unknown";
    const phoneKey = phoneKeyFromBody(req);
    return phoneKey ? `otp:send:${purpose}:${phoneKey}` : `otp:send:${purpose}:ip:${getClientIp(req)}`;
  },
});

// 10 verification attempts / 5 min per phone+purpose (fallback: IP)
export const otpVerifyRateLimit = makeLimiter({
  windowMs: 5 * 60_000,
  max: 10,
  keyFn: (req) => {
    const purpose = String(req.body?.purpose || "").trim() || "unknown";
    const phoneKey = phoneKeyFromBody(req);
    return phoneKey
      ? `otp:verify:${purpose}:${phoneKey}`
      : `otp:verify:${purpose}:ip:${getClientIp(req)}`;
  },
});

