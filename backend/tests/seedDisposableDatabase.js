import "./setupDisposableDatabase.js";
import db from "../prisma/client.js";
import bcrypt from "bcryptjs";
const hash = await bcrypt.hash("Isolated-Test-Password1!", 10);
try {
  await db.admin.upsert({ where: { email: "admin@example.invalid" }, update: {}, create: { name: "Test Admin", email: "admin@example.invalid", password: hash } });
  await db.faculty.upsert({ where: { username: "phase2-faculty" }, update: {}, create: { facultyId: "FAC_PHASE2", username: "phase2-faculty", email: "faculty@example.invalid", passwordHash: hash, fullName: "Test Faculty", phone: "9000000001", joiningDate: new Date(), salaryType: "ATTENDANCE_BASED", status: "ACTIVE" } });
  await db.extraIncentiveType.upsert({ where: { id: "phase2-online-incentive" }, update: {}, create: { id: "phase2-online-incentive", name: "ONLINE DOUBT CLASS", rate: 200 } });
  await db.appSettings.upsert({ where: { id: 1 }, update: {}, create: { id: 1, monthlyFee: 600 } });
  console.log("Disposable fixtures ready; application database not used.");
} finally { await db.$disconnect(); }
