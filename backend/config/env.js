const required = (name) => {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    // Do not print secrets; only print the missing key name.
    // eslint-disable-next-line no-console
    console.error("ENV ERROR:", name, "is missing");
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
};

const requiredAny = (names) => {
  for (const name of names) {
    const value = process.env[name];
    if (value && String(value).trim()) {
      return value;
    }
  }

  const label = names.join(" or ");
  // eslint-disable-next-line no-console
  console.error("ENV ERROR:", label, "is missing");
  throw new Error(`Missing required env var: ${label}`);
};

const assertOptionalHttpUrls = (name, { allowLocal = true } = {}) => {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return;

  const values =
    name === "CORS_ORIGIN" || name === "ALLOWED_ORIGINS" ? raw.split(",") : [raw];
  for (const value of values.map((item) => item.trim()).filter(Boolean)) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${name} must contain valid http(s) URLs.`);
    }

    if (!["http:", "https:"].includes(parsed.protocol)) {
      throw new Error(`${name} must use http or https.`);
    }

    if (!allowLocal && parsed.hostname === "localhost") {
      throw new Error(`${name} must not use localhost in production.`);
    }
  }
};

const assertOptionalPositiveInt = (name) => {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return;

  const numeric = Number.parseInt(raw, 10);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
};

const warnOptionalMissing = (names, label = names.join(" or ")) => {
  const hasAny = names.some((name) => {
    const value = process.env[name];
    return value && String(value).trim();
  });
  if (!hasAny) {
    // Optional integrations should fail cleanly when used, not crash startup.
    // eslint-disable-next-line no-console
    console.warn("ENV WARNING:", label, "is not configured");
  }
};

export const validateEnv = () => {
  required("DATABASE_URL");
  const jwtSecret = required("JWT_SECRET");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a Postgres connection string.");
  }
  if (String(jwtSecret).trim().length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long.");
  }

  const cashfreeClientId = process.env.CASHFREE_CLIENT_ID || process.env.CASHFREE_APP_ID;
  const cashfreeClientSecret = process.env.CASHFREE_CLIENT_SECRET || process.env.CASHFREE_SECRET_KEY;
  const cashfreeEnvironment = String(process.env.CASHFREE_ENVIRONMENT || "").trim().toLowerCase();
  if (cashfreeClientId && String(cashfreeClientId).trim().length < 8) {
    throw new Error("CASHFREE_CLIENT_ID/CASHFREE_APP_ID appears invalid.");
  }
  if (cashfreeClientSecret && String(cashfreeClientSecret).trim().length < 16) {
    throw new Error("CASHFREE_CLIENT_SECRET/CASHFREE_SECRET_KEY appears invalid.");
  }
  if (cashfreeEnvironment && !["sandbox", "production"].includes(cashfreeEnvironment)) {
    throw new Error("CASHFREE_ENVIRONMENT must be either sandbox or production.");
  }

  const isProduction = process.env.NODE_ENV === "production";
  warnOptionalMissing(["CASHFREE_CLIENT_ID", "CASHFREE_APP_ID"], "Cashfree student client id");
  warnOptionalMissing(["CASHFREE_CLIENT_SECRET", "CASHFREE_SECRET_KEY"], "Cashfree student client secret");
  warnOptionalMissing(["CASHFREE_ENVIRONMENT"], "Cashfree student environment");
  warnOptionalMissing(["CASHFREE_RETURN_URL"], "Cashfree student return URL");
  warnOptionalMissing(["BACKEND_URL"], "Backend public URL");
  warnOptionalMissing(["EMAIL_FROM"], "Email sender");
  warnOptionalMissing(["RESEND_API_KEY"], "Resend API key");
  warnOptionalMissing(["CASHFREE_PAYOUT_CLIENT_ID"], "Cashfree payout client id");
  warnOptionalMissing(["CASHFREE_PAYOUT_CLIENT_SECRET"], "Cashfree payout client secret");

  assertOptionalHttpUrls("FRONTEND_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("BACKEND_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("ALLOWED_ORIGINS", { allowLocal: true });
  assertOptionalHttpUrls("CORS_ORIGIN", { allowLocal: true });
  assertOptionalHttpUrls("PHONEPE_BASE_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("WHATSAPP_GRAPH_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("CASHFREE_RETURN_URL", { allowLocal: !isProduction });

  const runScheduledJobs = String(process.env.RUN_SCHEDULED_JOBS || "").trim();
  if (runScheduledJobs && !["0", "1"].includes(runScheduledJobs)) {
    throw new Error("RUN_SCHEDULED_JOBS must be either 0 or 1.");
  }

  assertOptionalPositiveInt("BACKGROUND_JOB_POLL_INTERVAL_MS");
  assertOptionalPositiveInt("BACKGROUND_JOB_BATCH_SIZE");
  assertOptionalPositiveInt("BACKGROUND_JOB_STALE_MINUTES");
  assertOptionalPositiveInt("MAX_ACTIVE_SESSIONS_PER_USER");
  assertOptionalPositiveInt("SESSION_IDLE_TIMEOUT_MINUTES");
  assertOptionalPositiveInt("ACCESS_TOKEN_EXPIRY_MINUTES");
};
