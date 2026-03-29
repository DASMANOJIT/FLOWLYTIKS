import "../config/loadEnv.js";
import twilio from "twilio";

let cachedClient = null;

export const getTwilioClient = () => {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;

  if (!accountSid || !authToken) {
    if (!accountSid) {
      throw new Error("Twilio not initialized: missing SID");
    }
    throw new Error("Twilio not initialized: missing auth token");
  }

  if (!cachedClient) {
    cachedClient = twilio(accountSid, authToken);
  }

  return cachedClient;
};
