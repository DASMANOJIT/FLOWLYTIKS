import "./config/loadEnv.js";
import { pathToFileURL } from "url";
import prisma from "./prisma/client.js";
import { validateEnv } from "./config/env.js";
import { registerScheduledJobs } from "./services/scheduler.js";
import { startBackgroundJobWorker } from "./services/backgroundJobService.js";

validateEnv();

let stopBackgroundWorker = null;

export const startJobs = async () => {
  try {
    await prisma.$connect();
    registerScheduledJobs();
    stopBackgroundWorker = startBackgroundJobWorker();
    console.log("⏰ Scheduler worker started");
  } catch (error) {
    console.error("Failed to start scheduler worker:", error?.message || error);
    process.exit(1);
  }
};

process.on("SIGTERM", async () => {
  if (typeof stopBackgroundWorker === "function") {
    stopBackgroundWorker();
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", async () => {
  if (typeof stopBackgroundWorker === "function") {
    stopBackgroundWorker();
  }
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
});

const isDirectExecution =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  void startJobs();
}
