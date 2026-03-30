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

export const validateEnv = () => {
  required("DATABASE_URL");
  required("JWT_SECRET");

  const databaseUrl = String(process.env.DATABASE_URL || "").trim();
  if (!/^postgres(ql)?:\/\//i.test(databaseUrl)) {
    throw new Error("DATABASE_URL must be a Postgres connection string.");
  }

  required("TWILIO_ACCOUNT_SID");
  required("TWILIO_AUTH_TOKEN");

  // Prefer the canonical Verify Service SID name.
  if (process.env.TWILIO_VERIFY_SERVICE_SID) {
    required("TWILIO_VERIFY_SERVICE_SID");
  } else {
    required("TWILIO_VERIFY_SID");
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(
        "ENV NOTICE: Using legacy TWILIO_VERIFY_SID. Prefer TWILIO_VERIFY_SERVICE_SID."
      );
    }
  }
};
