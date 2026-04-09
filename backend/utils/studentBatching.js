export const yieldToEventLoop = () =>
  new Promise((resolve) => setImmediate(resolve));

const mergeStudentBatchWhere = (where, lastSeenId) => {
  if (!lastSeenId) return where;

  return {
    ...where,
    id: {
      ...(where?.id || {}),
      gt: lastSeenId,
    },
  };
};

export const forEachStudentBatch = async ({
  prisma,
  where = {},
  select,
  batchSize = 50,
  processBatch,
}) => {
  let lastSeenId = null;
  let batchNumber = 0;
  let totalProcessed = 0;

  while (true) {
    const students = await prisma.student.findMany({
      where: mergeStudentBatchWhere(where, lastSeenId),
      orderBy: { id: "asc" },
      take: batchSize,
      select,
    });

    if (!students.length) {
      break;
    }

    batchNumber += 1;
    totalProcessed += students.length;
    lastSeenId = students[students.length - 1].id;

    await processBatch(students, {
      batchNumber,
      totalProcessed,
    });

    await yieldToEventLoop();
  }

  return {
    batchesProcessed: batchNumber,
    totalProcessed,
  };
};
