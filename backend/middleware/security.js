import { normalizeEmail } from "../utils/authValidation.js";

const buckets = new Map();

const getRequesterIp = (req) => {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "unknown";
};

const pruneBucket = (bucket, now, windowMs) => {
  while (bucket.length && now - bucket[0] > windowMs) {
    bucket.shift();
  }
};

export const createRateLimiter = ({
  namespace,
  windowMs,
  max,
  message,
  keyGenerator,
}) => {
  return (req, res, next) => {
    const now = Date.now();
    const suffix = keyGenerator ? keyGenerator(req) : getRequesterIp(req);
    const key = `${namespace}:${suffix}`;
    const bucket = buckets.get(key) || [];

    pruneBucket(bucket, now, windowMs);

    if (bucket.length >= max) {
      const retryAfter = Math.max(1, Math.ceil((windowMs - (now - bucket[0])) / 1000));
      res.setHeader("Retry-After", String(retryAfter));
      return res.status(429).json({
        success: false,
        error: message,
        message,
        retryAfter,
      });
    }

    bucket.push(now);
    buckets.set(key, bucket);
    return next();
  };
};

const authKeyGenerator = (req) => {
  const ip = getRequesterIp(req);
  const email = normalizeEmail(req.body?.email);
  return email ? `${ip}:${email}` : ip;
};

export const authNoStore = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

export const otpSendRateLimit = createRateLimiter({
  namespace: "auth:send-otp",
  windowMs: 10 * 60 * 1000,
  max: 8,
  message: "Too many OTP requests. Please try again later.",
  keyGenerator: authKeyGenerator,
});

export const otpVerifyRateLimit = createRateLimiter({
  namespace: "auth:verify-otp",
  windowMs: 10 * 60 * 1000,
  max: 15,
  message: "Too many OTP verification attempts. Please try again later.",
  keyGenerator: authKeyGenerator,
});

export const loginRateLimit = createRateLimiter({
  namespace: "auth:login",
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Too many login attempts. Please try again later.",
  keyGenerator: authKeyGenerator,
});

export const signupRateLimit = createRateLimiter({
  namespace: "auth:signup",
  windowMs: 20 * 60 * 1000,
  max: 10,
  message: "Too many signup attempts. Please try again later.",
  keyGenerator: authKeyGenerator,
});

export const passwordResetRateLimit = createRateLimiter({
  namespace: "auth:reset-password",
  windowMs: 20 * 60 * 1000,
  max: 8,
  message: "Too many password reset attempts. Please try again later.",
  keyGenerator: authKeyGenerator,
});
