import "../config/loadEnv.js";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { formatIndianPhone, sendOTP, verifyOTP } from "../services/twilioVerifyService.js";

const rawPhone = process.argv[2];
if (!rawPhone) {
  // eslint-disable-next-line no-console
  console.error("Usage: node scripts/twilioVerifySmoke.js <phone>");
  process.exit(1);
}

const phone = formatIndianPhone(rawPhone);

// eslint-disable-next-line no-console
console.log("PHONE (formatted):", phone);
// eslint-disable-next-line no-console
console.log("Sending OTP...");
await sendOTP(phone);
// eslint-disable-next-line no-console
console.log("OTP requested. Enter the code you received.");

const rl = readline.createInterface({ input, output });
try {
  const code = String(await rl.question("OTP: ")).trim();
  // eslint-disable-next-line no-console
  console.log("Verifying OTP...");
  const result = await verifyOTP(phone, code);
  // eslint-disable-next-line no-console
  console.log("VERIFY RESULT:", result);
  process.exit(result?.ok ? 0 : 2);
} finally {
  rl.close();
}

