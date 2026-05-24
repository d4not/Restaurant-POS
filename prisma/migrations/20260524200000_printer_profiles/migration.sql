-- CreateEnum
CREATE TYPE "PrinterConnectionType" AS ENUM ('NETWORK', 'USB');

-- CreateTable
CREATE TABLE "printer_profiles" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "connection_type" "PrinterConnectionType" NOT NULL DEFAULT 'NETWORK',
    "address" TEXT NOT NULL DEFAULT '',
    "paper_width" INTEGER NOT NULL DEFAULT 48,
    "printer_model" TEXT NOT NULL DEFAULT 'epson',
    "character_set" TEXT NOT NULL DEFAULT 'PC850_MULTILINGUAL',
    "prints_comandas" BOOLEAN NOT NULL DEFAULT true,
    "prints_receipts" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "printer_profiles_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "product_categories" ADD COLUMN "printer_profile_id" UUID;

-- CreateIndex
CREATE INDEX "product_categories_printer_profile_id_idx" ON "product_categories"("printer_profile_id");

-- AddForeignKey
ALTER TABLE "product_categories" ADD CONSTRAINT "product_categories_printer_profile_id_fkey" FOREIGN KEY ("printer_profile_id") REFERENCES "printer_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
