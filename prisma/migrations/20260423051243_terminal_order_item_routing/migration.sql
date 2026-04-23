-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "added_by" UUID,
ADD COLUMN     "sent_at" TIMESTAMP(3),
ADD COLUMN     "sent_to_kitchen" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "order_items_added_by_idx" ON "order_items"("added_by");

-- CreateIndex
CREATE INDEX "order_items_order_id_sent_to_kitchen_idx" ON "order_items"("order_id", "sent_to_kitchen");

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
