-- Add tab_deductions column to payroll_periods: tracks the sum of
-- PAYROLL_DEDUCT payments on the employee's EMPLOYEE-tab orders settled
-- during the week. Kept separate from `deductions` (unpaid-absence math)
-- so the audit trail keeps the two debt sources distinct.

ALTER TABLE "payroll_periods"
  ADD COLUMN "tab_deductions" DECIMAL(14, 0) NOT NULL DEFAULT 0;
