-- Suggestion approval queue. Cashiers create suggestions, admin approves or
-- rejects. Payload is opaque JSON, validated by Zod at create + approve time.

CREATE TYPE "SuggestionType" AS ENUM (
  'TABLE_CREATE',
  'TABLE_UPDATE',
  'TABLE_DELETE',
  'PRODUCT_CREATE',
  'PRODUCT_UPDATE',
  'PRODUCT_DELETE'
);

CREATE TYPE "SuggestionStatus" AS ENUM (
  'PENDING',
  'APPROVED',
  'REJECTED'
);

CREATE TABLE "suggestions" (
  "id"                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "type"              "SuggestionType" NOT NULL,
  "status"            "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
  "payload"           JSONB NOT NULL,
  "note"              TEXT,
  "target_table_id"   UUID,
  "target_product_id" UUID,
  "created_by"        UUID NOT NULL,
  "reviewed_by"       UUID,
  "review_note"       TEXT,
  "reviewed_at"       TIMESTAMP(3),
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "suggestions_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "suggestions_reviewed_by_fkey"
    FOREIGN KEY ("reviewed_by") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "suggestions_target_table_id_fkey"
    FOREIGN KEY ("target_table_id") REFERENCES "tables"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "suggestions_target_product_id_fkey"
    FOREIGN KEY ("target_product_id") REFERENCES "products"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "suggestions_status_idx"            ON "suggestions"("status");
CREATE INDEX "suggestions_type_idx"              ON "suggestions"("type");
CREATE INDEX "suggestions_created_by_idx"        ON "suggestions"("created_by");
CREATE INDEX "suggestions_reviewed_by_idx"       ON "suggestions"("reviewed_by");
CREATE INDEX "suggestions_target_table_id_idx"   ON "suggestions"("target_table_id");
CREATE INDEX "suggestions_target_product_id_idx" ON "suggestions"("target_product_id");
