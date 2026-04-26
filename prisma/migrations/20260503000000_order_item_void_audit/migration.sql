-- Soft-delete (void) audit fields for order_items. Once a line has been sent
-- to the kitchen we can't hard-delete it without losing the kitchen's record
-- of what was promised; instead we mark it voided so the ticket can show it
-- struck-through with a Restore option, and so the next kitchen comanda can
-- print a "REMOVED" notification.
--
--   voided_at        — when the void happened (NULL = active line)
--   voided_by        — who pulled the trigger (any active CASHIER+/MANAGER/ADMIN)
--   void_reason      — optional free-text the cashier may attach
--   void_printed_at  — when the void was acknowledged on a kitchen comanda;
--                      NULL means the next Send to Kitchen still owes the
--                      kitchen a notification

ALTER TABLE "order_items"
  ADD COLUMN "voided_at"       TIMESTAMP(3),
  ADD COLUMN "voided_by"       UUID,
  ADD COLUMN "void_reason"     TEXT,
  ADD COLUMN "void_printed_at" TIMESTAMP(3);

ALTER TABLE "order_items"
  ADD CONSTRAINT "order_items_voided_by_fkey"
  FOREIGN KEY ("voided_by")
  REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Indexed because the totals/deduction code now filters every read by
-- voided_at IS NULL, and the kitchen-routing query joins on
-- (order_id, voided_at IS NOT NULL, void_printed_at IS NULL).
CREATE INDEX "order_items_voided_at_idx" ON "order_items"("voided_at");
CREATE INDEX "order_items_order_id_voided_at_idx"
  ON "order_items"("order_id", "voided_at");
