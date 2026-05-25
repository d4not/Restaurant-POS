-- Create printers table (physical printer devices)
CREATE TABLE "printers" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" VARCHAR NOT NULL,
  "connection_type" "PrinterConnectionType" NOT NULL DEFAULT 'NETWORK',
  "address" VARCHAR NOT NULL DEFAULT '',
  "paper_width" INT NOT NULL DEFAULT 48,
  "printer_model" VARCHAR NOT NULL DEFAULT 'epson',
  "character_set" VARCHAR NOT NULL DEFAULT 'PC850_MULTILINGUAL',
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY ("id")
);

-- Add printer_id FK to printer_profiles
ALTER TABLE "printer_profiles" ADD COLUMN "printer_id" UUID;
ALTER TABLE "printer_profiles"
  ADD CONSTRAINT "printer_profiles_printer_id_fkey"
  FOREIGN KEY ("printer_id") REFERENCES "printers"("id") ON DELETE SET NULL;
CREATE INDEX "printer_profiles_printer_id_idx" ON "printer_profiles"("printer_id");

-- Auto-migrate: create Printer records from existing profiles with addresses
-- and link them back. Uses a CTE to avoid duplicating printers for the same address.
WITH new_printers AS (
  INSERT INTO "printers" ("id", "name", "connection_type", "address", "paper_width", "printer_model", "character_set")
  SELECT DISTINCT ON (address)
    gen_random_uuid(),
    name,
    connection_type,
    address,
    paper_width,
    printer_model,
    character_set
  FROM "printer_profiles"
  WHERE address != '' AND active = true
  ORDER BY address, created_at ASC
  RETURNING *
)
UPDATE "printer_profiles" pp
SET "printer_id" = np.id
FROM new_printers np
WHERE pp.address = np.address
  AND pp.address != ''
  AND pp.active = true;
