import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load `backend/.env` as early as possible in the module graph.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.join(__dirname, "..", ".env");

const result = dotenv.config({ path: envPath, quiet: true });

if (result.error) {
  // Do not print env contents; only indicate the missing file/error.
  // If the file is missing, allow the process to continue using real env vars.
  // `validateEnv()` will still fail fast if required vars aren't set.
  if (result.error.code === "ENOENT") {
    // eslint-disable-next-line no-console
    console.warn("No .env file found at backend root:", envPath);
  } else {
    // eslint-disable-next-line no-console
    console.error("Failed to load .env from backend root:", envPath);
    throw result.error;
  }
}

if (process.env.DEBUG_ENV_LOAD === "1") {
  // eslint-disable-next-line no-console
  console.log("ENV loaded (.env keys):", Object.keys(result.parsed || {}).length);
  // eslint-disable-next-line no-console
  console.log("Twilio SID exists:", !!process.env.TWILIO_ACCOUNT_SID);
}
