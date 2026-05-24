-- Employee Discounts feature: a separate catalogue of products the business
-- gives to its own staff at admin-set prices (no markup formula), plus an
-- audit log of each sale at that price. Lives outside the regular order
-- pipeline so daily-sales reports stay clean.

-- CreateTable
CREATE TABLE "employee_products" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "employee_price" DECIMAL(14,0) NOT NULL,
    "label" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employee_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_sales" (
    "id" UUID NOT NULL,
    "employee_product_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "employee_user_id" UUID NOT NULL,
    "recorded_by_user_id" UUID NOT NULL,
    "register_id" UUID,
    "product_name" TEXT NOT NULL,
    "unit_price" DECIMAL(14,0) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "total" DECIMAL(14,0) NOT NULL,
    "notes" TEXT,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employee_sales_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employee_products_product_id_variant_id_key" ON "employee_products"("product_id", "variant_id");
CREATE INDEX "employee_products_product_id_idx" ON "employee_products"("product_id");
CREATE INDEX "employee_products_active_idx" ON "employee_products"("active");

CREATE INDEX "employee_sales_employee_product_id_idx" ON "employee_sales"("employee_product_id");
CREATE INDEX "employee_sales_product_id_idx" ON "employee_sales"("product_id");
CREATE INDEX "employee_sales_variant_id_idx" ON "employee_sales"("variant_id");
CREATE INDEX "employee_sales_employee_user_id_idx" ON "employee_sales"("employee_user_id");
CREATE INDEX "employee_sales_recorded_by_user_id_idx" ON "employee_sales"("recorded_by_user_id");
CREATE INDEX "employee_sales_register_id_idx" ON "employee_sales"("register_id");
CREATE INDEX "employee_sales_date_idx" ON "employee_sales"("date");

-- AddForeignKey
ALTER TABLE "employee_products" ADD CONSTRAINT "employee_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_products" ADD CONSTRAINT "employee_products_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_employee_product_id_fkey" FOREIGN KEY ("employee_product_id") REFERENCES "employee_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_variant_id_fkey" FOREIGN KEY ("variant_id") REFERENCES "product_variants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_employee_user_id_fkey" FOREIGN KEY ("employee_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_recorded_by_user_id_fkey" FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "employee_sales" ADD CONSTRAINT "employee_sales_register_id_fkey" FOREIGN KEY ("register_id") REFERENCES "cash_registers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
