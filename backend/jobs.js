import "./config/loadEnv.js";
import prisma from "./prisma/client.js";
import { validateEnv } from "./config/env.js";
import { registerScheduledJobs } from "./services/scheduler.js";

validateEnv();

const startJobs = async () => {
  try {
    await prisma.$connect();
    registerScheduledJobs();
    console.log("⏰ Scheduler worker started");
  } catch (error) {
    console.error("Failed to start scheduler worker:", error?.message || error);
    process.exit(1);
  }
};

process.on("SIGTERM", async () => {
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});

void startJobs();
