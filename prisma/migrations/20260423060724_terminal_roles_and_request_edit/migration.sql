-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'WAITER';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "attention_reason" TEXT,
ADD COLUMN     "needs_attention" BOOLEAN NOT NULL DEFAULT false;
