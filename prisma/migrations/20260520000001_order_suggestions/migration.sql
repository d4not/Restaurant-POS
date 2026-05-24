-- Cashier-suggested edits on history orders. A cashier proposes a reopen,
-- soft-delete, or change-payment-method action with their own PIN; a manager
-- later reviews the suggestion in Order History and approves or rejects it.
-- Approval re-runs the existing destructive flow with the saved payload.

ALTER TYPE "SuggestionType" ADD VALUE 'ORDER_REOPEN';
ALTER TYPE "SuggestionType" ADD VALUE 'ORDER_DELETE';
ALTER TYPE "SuggestionType" ADD VALUE 'ORDER_CHANGE_PAYMENT';

ALTER TABLE "suggestions"
  ADD COLUMN "target_order_id" UUID;

ALTER TABLE "suggestions"
  ADD CONSTRAINT "suggestions_target_order_id_fkey"
  FOREIGN KEY ("target_order_id") REFERENCES "orders"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "suggestions_target_order_id_idx" ON "suggestions"("target_order_id");

-- One pending suggestion per order at a time. Approved/rejected rows stay in
-- place for audit. The partial index ensures the constraint only applies to
-- PENDING rows; historical rows can repeat freely.
CREATE UNIQUE INDEX "suggestions_one_pending_per_order"
  ON "suggestions"("target_order_id")
  WHERE "status" = 'PENDING' AND "target_order_id" IS NOT NULL;
