-- Phase: Employee orders + payroll-deduct payments.
--
-- An employee tab is a regular Order with order_type='EMPLOYEE' and
-- employee_user_id pointing at the User whose payroll absorbs any
-- PAYROLL_DEDUCT payment on it. The new payment method is a deferred
-- settlement: it never moves cash through the drawer and never counts
-- toward CashRegister.expected_amount.

-- AlterEnum
ALTER TYPE "OrderType" ADD VALUE 'EMPLOYEE';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'PAYROLL_DEDUCT';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN "employee_user_id" UUID;

-- CreateIndex
CREATE INDEX "orders_employee_user_id_idx" ON "orders"("employee_user_id");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_employee_user_id_fkey"
  FOREIGN KEY ("employee_user_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
