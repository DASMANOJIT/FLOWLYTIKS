ALTER TABLE "Payment"
ADD COLUMN "isLatePayment" BOOLEAN NOT NULL DEFAULT false;

WITH payment_periods AS (
  SELECT
    "id",
    COALESCE("paidAt", "createdAt") AS "effectivePaidAt",
    CASE "month"
      WHEN 'January' THEN make_date("academicYear" + 1, 1, 1)
      WHEN 'February' THEN make_date("academicYear" + 1, 2, 1)
      WHEN 'March' THEN make_date("academicYear", 3, 1)
      WHEN 'April' THEN make_date("academicYear", 4, 1)
      WHEN 'May' THEN make_date("academicYear", 5, 1)
      WHEN 'June' THEN make_date("academicYear", 6, 1)
      WHEN 'July' THEN make_date("academicYear", 7, 1)
      WHEN 'August' THEN make_date("academicYear", 8, 1)
      WHEN 'September' THEN make_date("academicYear", 9, 1)
      WHEN 'October' THEN make_date("academicYear", 10, 1)
      WHEN 'November' THEN make_date("academicYear", 11, 1)
      WHEN 'December' THEN make_date("academicYear", 12, 1)
      ELSE NULL
    END AS "periodStart"
  FROM "Payment"
)
UPDATE "Payment" AS payment
SET "isLatePayment" = (
  payment_periods."periodStart" IS NOT NULL
  AND payment_periods."effectivePaidAt" IS NOT NULL
  AND payment_periods."effectivePaidAt" > (
    date_trunc('month', payment_periods."periodStart"::timestamp)
    + interval '1 month'
    - interval '1 millisecond'
  )
)
FROM payment_periods
WHERE payment."id" = payment_periods."id";
