import "./../config/loadEnv.js";
import prisma from "../prisma/client.js";
import { pathToFileURL } from "url";

const maskPhone = (phone) => {
  const s = String(phone || "");
  if (s.length < 6) return "***";
  return `${s.slice(0, 3)}***${s.slice(-2)}`;
};

const isConfirm = () => process.env.CONFIRM_DEDUPE === "YES";

const run = async () => {
  const dryRun = !isConfirm();
  // eslint-disable-next-line no-console
  console.log(dryRun ? "DRY RUN: no data will be changed" : "APPLY: deduping phones");

  // 1) Remove obviously-invalid rows (optional) where phone is empty string.
  // NOTE: `Student.phone` is non-nullable in Prisma schema; null phones require raw SQL to clean up.
  const emptyCount = await prisma.student.count({
    where: { phone: "" },
  });
  // eslint-disable-next-line no-console
  console.log("Students with empty phone:", emptyCount);

  if (!dryRun && emptyCount > 0) {
    const deleted = await prisma.student.deleteMany({
      where: { phone: "" },
    });
    // eslint-disable-next-line no-console
    console.log("Deleted students with empty phone:", deleted.count);
  }

  // 2) Find duplicate phone values.
  const duplicates = await prisma.student.groupBy({
    by: ["phone"],
    _count: { phone: true },
    having: { phone: { _count: { gt: 1 } } },
  });

  // eslint-disable-next-line no-console
  console.log("Duplicate phone groups:", duplicates.length);

  for (const group of duplicates) {
    const phone = group.phone;
    const students = await prisma.student.findMany({
      where: { phone },
      select: { id: true },
      orderBy: { id: "asc" },
    });

    if (students.length <= 1) continue;
    const keepId = students[0].id;
    const removeIds = students.slice(1).map((s) => s.id);

    // eslint-disable-next-line no-console
    console.log("Duplicate:", maskPhone(phone), "keep:", keepId, "remove:", removeIds);

    if (dryRun) continue;

    // Reassign related payments to the kept student, then delete dup students.
    await prisma.payment.updateMany({
      where: { studentId: { in: removeIds } },
      data: { studentId: keepId },
    });

    await prisma.student.deleteMany({
      where: { id: { in: removeIds } },
    });
  }

  // eslint-disable-next-line no-console
  console.log("Done.");
};

const isDirectRun = () => {
  const argvPath = process.argv?.[1];
  if (!argvPath) return false;
  return import.meta.url === pathToFileURL(argvPath).href;
};

if (isDirectRun()) {
  run()
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("Dedup script failed:", err?.message || err);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect().catch(() => {});
    });
}
