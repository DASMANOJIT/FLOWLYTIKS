import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import express from "express";
import jwt from "jsonwebtoken";
import { requireDisposableDatabase } from "./disposableDatabase.js";

test("financial mutation routes reject unauthorized roles before body-supplied privilege or provider access", { skip: process.env.RUN_PHASE2_POSTGRES_TESTS !== "true" }, async () => {
  requireDisposableDatabase();
  const { default: db } = await import("../prisma/client.js");
  const { addSession } = await import("../utils/sessionStore.js");
  const app = express();
  app.use(express.json());
  app.use("/api/payments", (await import("../routes/paymentroute.js")).default);
  app.use("/api/faculty-weekly-payments", (await import("../routes/facultyweeklypaymentroute.js")).default);
  app.use("/api/faculty-extra-incentives", (await import("../routes/facultyextraincentiveroute.js")).default);
  app.use("/api/staff", (await import("../routes/staffroute.js")).default);
  const additional = [];
  for (const [prefix, file] of [["/api/faculty-payouts", "facultypayoutroute.js"], ["/api/faculty-payroll", "facultypayrollroute.js"], ["/api/work-ledger", "workledgerroute.js"]]) {
    const router = (await import(`../routes/${file}`)).default;
    app.use(prefix, router);
    for (const layer of router.stack) {
      if (!layer.route?.stack.some(item => item.handle.name === "adminOnly")) continue;
      for (const method of Object.keys(layer.route.methods).filter(value => ["post", "put", "patch", "delete"].includes(value))) {
        additional.push([prefix + layer.route.path.replace(/:[A-Za-z]+/g, "invalid-fixture-id"), ["admin"], method.toUpperCase()]);
      }
    }
  }
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const users = {
      admin: await db.admin.findFirstOrThrow(), student: await db.student.findFirstOrThrow(),
      faculty: await db.faculty.findFirstOrThrow({ where: { status: "ACTIVE" } }),
      staff: await db.staff.findFirstOrThrow({ where: { isActive: true } }),
    };
    const tokens = {};
    for (const [role, user] of Object.entries(users)) {
      const jti = randomUUID();
      await addSession(role, user.id, jti, Date.now() + 600000);
      tokens[role] = jwt.sign({ role, id: user.id, jti }, process.env.JWT_SECRET, { expiresIn: "10m" });
    }
    const endpoints = [
      ["/api/payments/mark-paid", ["admin"]], ["/api/payments/bulk-update", ["admin"]], ["/api/payments/reverse", ["admin"]],
      ["/api/payments/cashfree/create-order", ["admin", "student"]], ["/api/payments/cashfree/verify", ["admin", "student"]],
      ["/api/faculty-weekly-payments/pay-cash", ["admin"]], ["/api/faculty-weekly-payments/pay-online", ["admin"]],
      ["/api/faculty-extra-incentives/admin/pay/invalid-faculty", ["admin"]],
      ["/api/faculty-extra-incentives/my/invalid-type/sets", ["faculty"]],
      ["/api/faculty-extra-incentives/my/invalid-type/increment", ["faculty"]],
      ["/api/faculty-extra-incentives/my/online-classes/invalid-class/check", ["faculty"]],
      ["/api/staff/students/999999/pay-cash", ["staff"]],
      ...additional,
    ];
    for (const [path, allowed, method = "POST"] of endpoints) {
      for (const role of [null, "admin", "student", "faculty", "staff"]) {
        if (allowed.includes(role)) continue;
        const response = await fetch(base + path, { method, headers: { "Content-Type": "application/json", ...(role ? { Authorization: `Bearer ${tokens[role]}` } : {}) }, body: JSON.stringify({ studentId: users.student.id, month: "June", academicYear: 2026, role: "admin", adminId: users.admin.id, amount: 1, status: "PAID" }) });
        assert.equal(response.status, role ? 403 : 401, `${role || "anonymous"}: ${path}`);
      }
    }
  } finally { await new Promise(resolve => server.close(resolve)); await db.$disconnect(); }
});
