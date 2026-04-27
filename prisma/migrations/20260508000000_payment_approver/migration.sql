-- Waiter/Barista emergency-shift flow: when a non-cashier initiates a
-- payment, they must include a CASHIER+/MANAGER/ADMIN PIN. The matching
-- approver's user id is recorded here so the audit trail is preserved
-- (mirrors orders.cancelled_by_user_id and order_items.voided_by).

ALTER TABLE "payments"
    ADD COLUMN "approved_by_user_id" UUID;

ALTER TABLE "payments"
    ADD CONSTRAINT "payments_approved_by_user_id_fkey"
    FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "payments_approved_by_user_id_idx" ON "payments"("approved_by_user_id");
