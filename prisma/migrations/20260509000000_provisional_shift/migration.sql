-- Provisional shift kind. Floor staff (barista/waiter) can open one when no
-- cashier is on site; a cashier+ must close it with a counted actual_amount
-- before a normal shift resumes.

CREATE TYPE "CashRegisterKind" AS ENUM ('NORMAL', 'PROVISIONAL');

ALTER TABLE "cash_registers"
  ADD COLUMN "kind" "CashRegisterKind" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN "closed_by_user_id" UUID;

ALTER TABLE "cash_registers"
  ADD CONSTRAINT "cash_registers_closed_by_user_id_fkey"
  FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "cash_registers_kind_idx" ON "cash_registers"("kind");
