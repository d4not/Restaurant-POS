-- Manager-authorised soft delete on orders. Hides from the default history
-- listing without affecting reports or inventory state.
ALTER TABLE "orders"
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "deleted_by_user_id" UUID;

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_deleted_by_user_id_fkey"
  FOREIGN KEY ("deleted_by_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "orders_deleted_at_idx" ON "orders"("deleted_at");
