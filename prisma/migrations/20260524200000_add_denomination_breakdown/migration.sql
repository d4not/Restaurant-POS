-- Add denomination_breakdown (bill/coin counts) to cash registers and shift reports
ALTER TABLE "cash_registers" ADD COLUMN "denomination_breakdown" JSONB;
ALTER TABLE "shift_reports"  ADD COLUMN "denomination_breakdown" JSONB;
