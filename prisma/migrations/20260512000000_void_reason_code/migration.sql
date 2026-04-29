-- CreateEnum
CREATE TYPE "VoidReasonCode" AS ENUM ('PRODUCT_CHANGE', 'PRODUCT_DEFECT', 'BEFORE_PREP', 'OTHER');

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN "void_reason_code" "VoidReasonCode";
