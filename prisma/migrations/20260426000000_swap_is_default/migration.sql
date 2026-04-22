-- SWAP redesign: modifier groups no longer carry replaces_supply_id. Recipes
-- link directly via RecipeItem.modifier_group_id, and each SWAP group declares
-- a default modifier via Modifier.is_default (used when the customer picks
-- nothing from the group at the POS).

-- Drop FK + index + column from modifier_groups.
ALTER TABLE "modifier_groups"
  DROP CONSTRAINT IF EXISTS "modifier_groups_replaces_supply_id_fkey";

DROP INDEX IF EXISTS "modifier_groups_replaces_supply_id_idx";

ALTER TABLE "modifier_groups"
  DROP COLUMN IF EXISTS "replaces_supply_id";

-- Recipe lines with modifier_group_id now own their quantity/unit and the
-- selected modifier owns the supply. Clear supply_id on any line that already
-- carries a modifier_group_id so the new "exactly one of the three" invariant
-- holds from the start.
UPDATE "recipe_items"
  SET "supply_id" = NULL
  WHERE "modifier_group_id" IS NOT NULL;

-- Add is_default to modifiers.
ALTER TABLE "modifiers"
  ADD COLUMN "is_default" BOOLEAN NOT NULL DEFAULT FALSE;
