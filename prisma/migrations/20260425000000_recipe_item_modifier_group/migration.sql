-- Recipe items can now link to a SWAP ModifierGroup as a display/metadata tag.
-- The line still carries a concrete supply_id (= group.replaces_supply_id) so
-- the deduction engine keeps working unchanged. Nullable and backwards
-- compatible with existing rows.

ALTER TABLE "recipe_items"
  ADD COLUMN "modifier_group_id" UUID;

ALTER TABLE "recipe_items"
  ADD CONSTRAINT "recipe_items_modifier_group_id_fkey"
    FOREIGN KEY ("modifier_group_id") REFERENCES "modifier_groups"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "recipe_items_modifier_group_id_idx"
  ON "recipe_items" ("modifier_group_id");
