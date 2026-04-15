import "./config/loadEnv.js";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import prisma from "./prisma/client.js";
import { validateEnv } from "./config/env.js";
import { logError, logInfo } from "./utils/appLogger.js";
import { verifyRequiredSchemaColumns } from "./utils/schemaGuard.js";

// Import routes
import authRoutes from "./routes/authroute.js";
import studentRoutes from "./routes/studentroute.js";
import paymentRoutes from "./routes/paymentroute.js";
import settingsRoutes from "./routes/settingsroute.js";
import adminAssistantRoutes from "./routes/adminassistantroute.js";
import adminRoutes from "./routes/adminroute.js";

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
app.use(
  express.json({
    limit: "16kb",
    verify(req, res, buf) {
      if (req.originalUrl === "/api/payments/cashfree/webhook") {
        req.rawBody = buf.toString("utf8");
      }
    },
  })
);
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
      logInfo("settings.bootstrap_initialized", { monthlyFee: 600 });
    }
  } catch (err) {
    if (isProduction) {
      throw err;
    }
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
      await verifyRequiredSchemaColumns();
      await ensureAppSettings();
      logInfo("server.database_connected");
    } catch (err) {
      if (err?.code === "SCHEMA_MISMATCH") {
        logError("server.schema_mismatch", {
          details: err?.details || [],
        });
        process.exit(1);
      }
      if (isProduction && attempt >= maxAttempts) {
        logError("server.database_connect_failed", {
          attempt,
          maxAttempts,
          message: err?.message || err,
        });
        process.exit(1);
      }
      if (!warned) {
        console.error(
          isProduction
            ? "Database unavailable, retrying before shutdown"
            : "Database unavailable, continuing without DB"
        );
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
logInfo("server.background_jobs_disabled");

// ================================
// Routes
// ================================
app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/settings", settingsRoutes);
app.use("/api/admin-assistant", adminAssistantRoutes);
app.use("/api/admin", adminRoutes);


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
  const status =
    err?.statusCode ||
    err?.status ||
    (err instanceof SyntaxError && "body" in err ? 400 : null) ||
    (/cors origin not allowed/i.test(String(err?.message || "")) ? 403 : null) ||
    500;
  logError("server.request_failed", {
    method: req.method,
    path: req.originalUrl || req.url,
    ip: req.ip,
    status,
    message: err?.message || err,
  });
  if (res.headersSent) return next(err);
  return res.status(status).json({
    success: false,
    error:
      status === 400
        ? "Invalid request payload"
        : status === 403
        ? "Request origin is not allowed"
        : "Internal server error",
    message:
      status === 400
        ? "Invalid request payload"
        : status === 403
        ? "Request origin is not allowed"
        : "Internal server error",
  });
});

// Start server
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  logInfo("server.started", { port: PORT });
});

export default app;
