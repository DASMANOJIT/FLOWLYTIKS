import "./setupDisposableDatabase.js";
import db from "../prisma/client.js";
import { createRateLimiter } from "../middleware/security.js";
import express from "express";
const limit = createRateLimiter({ namespace: process.env.TEST_RATE_NAMESPACE, max: 7, windowMs: 60000, message: "Limited", keyGenerator: () => "shared" });
const app = express(); app.get("/limited", limit, (req, res) => res.sendStatus(200));
const server = app.listen(0, "127.0.0.1");
await new Promise(resolve => server.once("listening", resolve));
process.send({ ready: true });
process.once("message", async () => {
  try {
    const codes = await Promise.all(Array.from({ length: 15 }, async () => {
      const response = await fetch(`http://127.0.0.1:${server.address().port}/limited`);
      await response.arrayBuffer();
      return response.status;
    }));
    process.send({ codes });
  } finally { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); process.disconnect(); }
});
