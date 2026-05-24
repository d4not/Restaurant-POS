-- Re-introduce provisional shifts as a flag on cash_registers.
--
-- Floor staff (waiter/barista) may open a shift when no cashier is on site;
-- the register is marked is_provisional=true. Cash movements are blocked
-- while provisional. A cashier+ later runs verifyProvisional, counts the
-- drawer, and the diff is recorded on the same row — the shift then
-- continues with is_provisional=false until the regular close flow.
--
-- ShiftReport denormalises the verification snapshot so the admin panel
-- renders the partial cut alongside the final close totals.

ALTER TABLE "cash_registers"
  ADD COLUMN "is_provisional"               BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN "provisional_verified_by_id"   UUID,
  ADD COLUMN "provisional_verified_at"      TIMESTAMP(3),
  ADD COLUMN "provisional_expected_amount"  DECIMAL(14, 0),
  ADD COLUMN "provisional_actual_amount"    DECIMAL(14, 0),
  ADD COLUMN "provisional_difference"       DECIMAL(14, 0);

ALTER TABLE "cash_registers"
  ADD CONSTRAINT "cash_registers_provisional_verified_by_id_fkey"
  FOREIGN KEY ("provisional_verified_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cash_registers_is_provisional_idx" ON "cash_registers"("is_provisional");

ALTER TABLE "shift_reports"
  ADD COLUMN "was_provisional"              BOOLEAN     NOT NULL DEFAULT FALSE,
  ADD COLUMN "provisional_opened_by_role"   TEXT,
  ADD COLUMN "provisional_verified_by_id"   UUID,
  ADD COLUMN "provisional_verified_by_name" TEXT,
  ADD COLUMN "provisional_verified_at"      TIMESTAMP(3),
  ADD COLUMN "provisional_expected_amount"  INTEGER,
  ADD COLUMN "provisional_actual_amount"    INTEGER,
  ADD COLUMN "provisional_difference"       INTEGER;

CREATE INDEX "shift_reports_was_provisional_idx" ON "shift_reports"("was_provisional");
