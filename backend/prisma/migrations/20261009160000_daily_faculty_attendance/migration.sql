-- Add a daily entry type without changing historical shifts, amounts or payroll.
ALTER TYPE "WorkLedgerShift" ADD VALUE IF NOT EXISTS 'DAILY';
