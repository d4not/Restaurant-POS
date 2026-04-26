-- Add cancel audit fields to orders so the terminal can record who pulled the
-- trigger and why. cancelled_by_user_id ON DELETE SET NULL keeps history if
-- the cashier is later deactivated and removed.
ALTER TABLE "orders"
  ADD COLUMN "cancel_reason" TEXT,
  ADD COLUMN "cancelled_by_user_id" UUID,
  ADD COLUMN "cancelled_at" TIMESTAMP(3);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_cancelled_by_user_id_fkey"
  FOREIGN KEY ("cancelled_by_user_id")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
