-- Idempotent safety migration for environments that applied the first faculty table
-- before account credentials were added.
ALTER TABLE "Faculty" ADD COLUMN IF NOT EXISTS "username" TEXT;
ALTER TABLE "Faculty" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE "Faculty" ADD COLUMN IF NOT EXISTS "employmentType" TEXT;

UPDATE "Faculty"
SET "username" = COALESCE(NULLIF("username", ''), "facultyId")
WHERE "username" IS NULL OR "username" = '';

-- bcrypt hash for temporary value "ChangeMe123"; admins should reset any legacy rows.
UPDATE "Faculty"
SET "passwordHash" = COALESCE(NULLIF("passwordHash", ''), '$2a$10$8K1p/a0dL1LXMIgoEDFrwOfuXaPhuW6Gzn97eQBQqL1cn0bd6xQOa')
WHERE "passwordHash" IS NULL OR "passwordHash" = '';

ALTER TABLE "Faculty" ALTER COLUMN "username" SET NOT NULL;
ALTER TABLE "Faculty" ALTER COLUMN "passwordHash" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "Faculty_username_key" ON "Faculty"("username");

DROP INDEX IF EXISTS "Faculty_department_idx";
ALTER TABLE "Faculty" DROP COLUMN IF EXISTS "department";
