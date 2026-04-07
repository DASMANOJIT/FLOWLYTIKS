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

export const validateEnv = () => {
  required("DATABASE_URL");
  const jwtSecret = required("JWT_SECRET");
  const cashfreeClientId = requiredAny(["CASHFREE_CLIENT_ID", "CASHFREE_APP_ID"]);
  const cashfreeClientSecret = requiredAny([
    "CASHFREE_CLIENT_SECRET",
    "CASHFREE_SECRET_KEY",
  ]);
  const cashfreeEnvironment = required("CASHFREE_ENVIRONMENT");
  required("CASHFREE_RETURN_URL");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a Postgres connection string.");
  }
  if (String(jwtSecret).trim().length < 32) {
    throw new Error("JWT_SECRET must be at least 32 characters long.");
  }
  if (String(cashfreeClientId).trim().length < 8) {
    throw new Error("CASHFREE_CLIENT_ID/CASHFREE_APP_ID appears invalid.");
  }
  if (String(cashfreeClientSecret).trim().length < 16) {
    throw new Error("CASHFREE_CLIENT_SECRET/CASHFREE_SECRET_KEY appears invalid.");
  }
  if (!["sandbox", "production"].includes(String(cashfreeEnvironment).trim().toLowerCase())) {
    throw new Error("CASHFREE_ENVIRONMENT must be either sandbox or production.");
  }

  required("EMAIL_FROM");

  const isProduction = process.env.NODE_ENV === "production";
  if (isProduction) {
    required("RESEND_API_KEY");
    required("BACKEND_URL");
  }
  assertOptionalHttpUrls("FRONTEND_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("BACKEND_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("ALLOWED_ORIGINS", { allowLocal: !isProduction });
  assertOptionalHttpUrls("CORS_ORIGIN", { allowLocal: !isProduction });
  assertOptionalHttpUrls("PHONEPE_BASE_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("WHATSAPP_GRAPH_URL", { allowLocal: !isProduction });
  assertOptionalHttpUrls("CASHFREE_RETURN_URL", { allowLocal: !isProduction });

  const runScheduledJobs = String(process.env.RUN_SCHEDULED_JOBS || "").trim();
  if (runScheduledJobs && !["0", "1"].includes(runScheduledJobs)) {
    throw new Error("RUN_SCHEDULED_JOBS must be either 0 or 1.");
  }
};
