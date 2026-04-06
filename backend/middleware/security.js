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
      const resolvedMessage =
        typeof message === "function" ? message(req) : message;
      return res.status(429).json({
        success: false,
        error: resolvedMessage,
        message: resolvedMessage,
        retryAfter,
      });
    }

    bucket.push(now);
    buckets.set(key, bucket);
    return next();
  };
};

const getPurpose = (req, fallback = "login") => {
  const purpose = String(req.body?.purpose || fallback).trim().toLowerCase();
  return purpose || fallback;
};

const getLoginMode = (req) => {
  if (req.body?.otp) return "otp";
  if (req.body?.password) return "password";
  return "request";
};

const authKeyGenerator = (req, { fallbackToIp = true, includePurpose = false, mode } = {}) => {
  const email = normalizeEmail(req.body?.email);
  const parts = [];
  if (includePurpose) {
    parts.push(getPurpose(req));
  }
  if (mode) {
    parts.push(typeof mode === "function" ? mode(req) : mode);
  }
  if (email) {
    parts.push(email);
  } else if (fallbackToIp) {
    parts.push(getRequesterIp(req));
  }
  return parts.join(":");
};

export const authNoStore = (req, res, next) => {
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, private");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
  next();
};

export const otpSendRateLimit = createRateLimiter({
  namespace: "auth:send-otp",
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: "You have requested OTP too many times for this email. Please try again after 15 minutes.",
  keyGenerator: (req) => authKeyGenerator(req, { includePurpose: true }),
});

export const otpVerifyRateLimit = createRateLimiter({
  namespace: "auth:verify-otp",
  windowMs: 10 * 60 * 1000,
  max: 10,
  message:
    "Too many OTP verification attempts for this email. Please try again after 10 minutes.",
  keyGenerator: (req) => authKeyGenerator(req, { includePurpose: true }),
});

export const loginRateLimit = createRateLimiter({
  namespace: "auth:login",
  windowMs: 15 * 60 * 1000,
  max: 12,
  message: "Too many login attempts for this account. Please try again later.",
  keyGenerator: (req) => authKeyGenerator(req, { mode: getLoginMode }),
});

export const signupRateLimit = createRateLimiter({
  namespace: "auth:signup",
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: "Too many signup attempts for this email. Please try again later.",
  keyGenerator: (req) => authKeyGenerator(req),
});

export const passwordResetRateLimit = createRateLimiter({
  namespace: "auth:reset-password",
  windowMs: 15 * 60 * 1000,
  max: 8,
  message: "Too many password reset attempts for this email. Please try again later.",
  keyGenerator: (req) => authKeyGenerator(req),
});
