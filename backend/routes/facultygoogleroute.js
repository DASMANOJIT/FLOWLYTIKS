import express from "express";
import { protect } from "../middleware/authmiddleware.js";
import { createRateLimiter } from "../middleware/security.js";
import { googleConfig, startGoogleConnection, prepareGoogleConnection, launchGoogleConnection, finishGoogleConnection, googleConnectionStatus, disconnectGoogle } from "../services/facultyGoogleService.js";

const router = express.Router();
const googleRateLimit = createRateLimiter({ namespace: "faculty:google", windowMs: 10 * 60 * 1000, max: 20,
  message: "Too many Google connection requests. Please try again later.", keyGenerator: req => req.user.id });
const COOKIE = "flowlytiks_google_oauth";
const cookieOptions = secure => ({ httpOnly: true, secure, sameSite: secure ? "none" : "lax", path: "/api/faculty/google", maxAge: 10 * 60 * 1000 });
const browserNonce = req => {
  const raw = String(req.headers.cookie || "").split(";").map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
  return raw ? decodeURIComponent(raw.slice(COOKIE.length + 1)) : "";
};
const facultyOnly = (req, res, next) => req.userRole === "faculty" ? next() : res.status(403).json({ success: false, message: "Faculty access required." });
const safeError = (res, error) => {
  console.warn("faculty.google.failed", { name: error?.name, code: error?.code, status: error?.status });
  return res.status(error.status || 503).json({ success: false, message: error.status ? error.message : "Google connection is temporarily unavailable." });
};
const handle = handler => async (req, res) => { try { await handler(req, res); } catch (error) { safeError(res, error); } };
router.use((req, res, next) => { res.setHeader("Cache-Control", "no-store"); res.setHeader("Referrer-Policy", "no-referrer"); next(); });

router.get("/status", protect, facultyOnly, (req, res, next) => req.query.verify === "1" ? googleRateLimit(req, res, next) : next(), handle(async (req, res) => {
  res.json({ success: true, ...await googleConnectionStatus(req.user.id, { forceRefresh: req.query.verify === "1" }) });
}));
router.post("/connect", protect, facultyOnly, googleRateLimit, handle(async (req, res) => {
  res.json({ success: true, ...await startGoogleConnection(req.user.id) });
}));
router.post("/prepare", protect, facultyOnly, googleRateLimit, handle(async (req, res) => {
  const prepared = await prepareGoogleConnection(req.user.id, req.body?.ticket);
  res.cookie(COOKIE, prepared.nonce, cookieOptions(prepared.secure));
  res.json({ success: true });
}));
router.post("/disconnect", protect, facultyOnly, googleRateLimit, handle(async (req, res) => {
  res.json({ success: true, ...await disconnectGoogle(req.user.id) });
}));

router.get("/authorize", handle(async (req, res) => {
  const launch = await launchGoogleConnection(req.query.ticket, browserNonce(req));
  res.redirect(303, launch.url);
}));
router.get("/callback", async (req, res) => {
  let config;
  try { config = googleConfig(); } catch (error) { return safeError(res, error); }
  let result = "failed";
  try {
    const nonce = browserNonce(req);
    const response = await finishGoogleConnection({ state: req.query.state, nonce, code: req.query.code, denied: typeof req.query.error === "string" });
    result = response.result;
  } catch (error) {
    console.warn("faculty.google.callback_failed", { name: error?.name, code: error?.code, status: error?.status });
    result = error.status === 400 ? "expired" : "reconnect";
  }
  res.clearCookie(COOKIE, { ...cookieOptions(new URL(config.redirectUri).protocol === "https:"), maxAge: undefined });
  // Fixed destination and enumerated result only; no provider code, state or tokens escape.
  return res.redirect(303, `${config.frontendOrigin}/faculty/dashboard#google_connection=${result}`);
});
export default router;
