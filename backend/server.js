import "./config/loadEnv.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import prisma from "./prisma/client.js";
import { validateEnv } from "./config/env.js";

// Import routes
import authRoutes from "./routes/authroute.js";
import studentRoutes from "./routes/studentroute.js";
import paymentRoutes from "./routes/paymentroute.js";
import settingsRoutes from "./routes/settingsroute.js";
import adminAssistantRoutes from "./routes/adminassistantroute.js";
import { registerScheduledJobs } from "./services/scheduler.js";

validateEnv();

// Initialize app
const app = express();
const isProduction = process.env.NODE_ENV === "production";
const defaultDevOrigins = [
  "http://localhost:3000",
  "http://127.0.0.1:3000",
  "http://localhost:3001",
  "http://127.0.0.1:3001",
];
const defaultProductionOrigins = [
  "https://flowlytiks-frontend.onrender.com",
];

const sanitizeOrigin = (origin) => {
  const trimmed = String(origin || "").trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
};

const configuredOrigins = (
  process.env.ALLOWED_ORIGINS ||
  process.env.CORS_ORIGIN ||
  process.env.FRONTEND_URL ||
  ""
)
  .split(",")
  .map(sanitizeOrigin)
  .filter(Boolean);

const corsOrigins = [
  ...new Set(
    isProduction
      ? [...defaultProductionOrigins, ...configuredOrigins]
      : [...configuredOrigins, ...defaultDevOrigins]
  ),
];

app.disable("x-powered-by");
app.set("trust proxy", 1);

// Middlewares
app.use(
  cors(
    {
      origin(origin, callback) {
        if (!origin) return callback(null, true);
        if (!isProduction && !corsOrigins.length) {
          return callback(null, true);
        }
        if (corsOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("CORS origin not allowed"));
      },
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 86400,
    }
  )
);
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
    frameguard: { action: "deny" },
    referrerPolicy: { policy: "no-referrer" },
  })
);
app.use((req, res, next) => {
  res.setHeader(
    "Permissions-Policy",
    "accelerometer=(), autoplay=(), camera=(), geolocation=(), gyroscope=(), microphone=(), payment=(), usb=()"
  );
  next();
});
app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ extended: true, limit: "16kb" }));
app.use("/api/payments", paymentRoutes);
// ================================
// ENSURE APP SETTINGS EXISTS
// ================================
async function ensureAppSettings() {
  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 1 },
    });

    if (!settings) {
      await prisma.appSettings.create({
        data: { id: 1, monthlyFee: 600 },
      });
      console.log("✅ AppSettings initialized with ₹600");
    }
  } catch (err) {
    console.error("Database unavailable, continuing without DB");
  }
}

const initDatabase = async () => {
  const maxAttempts = 5;
  let attempt = 0;
  let warned = false;

  const tryConnect = async () => {
    attempt += 1;
    try {
      await prisma.$connect();
      await ensureAppSettings();
    } catch (err) {
      if (!warned) {
        console.error("Database unavailable, continuing without DB");
        warned = true;
      }
      if (process.env.DEBUG_DB === "1") {
        console.error("DB init error:", err?.message || err);
      }
      if (attempt < maxAttempts) {
        const delayMs = Math.min(30_000, 1000 * 2 ** (attempt - 1));
        setTimeout(tryConnect, delayMs);
      }
    }
  };

  void tryConnect();
};

initDatabase();
registerScheduledJobs();


// ================================
// Routes
// ================================
app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin-assistant", adminAssistantRoutes);


// Health check
app.get("/", (req, res) => {
  res.send("Server is running...");
});

process.on("unhandledRejection", (reason) => {
  // eslint-disable-next-line no-console
  console.error("UNHANDLED REJECTION:", reason?.message || reason);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("UNCAUGHT EXCEPTION:", err?.message || err);
});

// Global express error handler (ensures JSON response instead of connection drop)
app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error("EXPRESS ERROR:", err?.message || err);
  if (res.headersSent) return next(err);
  return res.status(500).json({
    success: false,
    error: "Internal server error",
    message: "Internal server error",
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔥 Server running on port ${PORT}`);
});

export default app;
