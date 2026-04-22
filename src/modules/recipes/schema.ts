import { z } from 'zod';

// A recipe must belong to either a Product or a ProductVariant — never both.
// The enclosing recipe scope is determined by the URL, so the body only
// carries metadata (yield fields for preparations) and the initial items.
//
// A recipe item must reference EXACTLY ONE of supply_id, preparation_id, or
// modifier_group_id. The third form is a "slot" filled at sale time by the
// selected SWAP modifier — or the group's is_default modifier when the
// customer picks nothing.

const recipeItemBody = z.object({
  supply_id: z.string().uuid().nullable().optional(),
  preparation_id: z.string().uuid().nullable().optional(),
  modifier_group_id: z.string().uuid().nullable().optional(),
  quantity: z.number().positive(),
  unit: z.string().min(1).max(16),
  waste_pct: z.number().min(0).max(99).optional(),
});

const exactlyOneIngredientRef = (d: z.infer<typeof recipeItemBody>): boolean => {
  const count =
    (d.supply_id != null ? 1 : 0) +
    (d.preparation_id != null ? 1 : 0) +
    (d.modifier_group_id != null ? 1 : 0);
  return count === 1;
};

export const createRecipeItemSchema = recipeItemBody.refine(exactlyOneIngredientRef, {
  message:
    'Recipe item must reference exactly one of supply_id, preparation_id, or modifier_group_id',
});

export const updateRecipeItemSchema = recipeItemBody.partial();

export const createRecipeSchema = z.object({
  yield_quantity: z.number().positive().nullable().optional(),
  yield_unit: z.string().min(1).max(16).nullable().optional(),
  items: z.array(createRecipeItemSchema).optional(),
});

export const updateRecipeSchema = z.object({
  yield_quantity: z.number().positive().nullable().optional(),
  yield_unit: z.string().min(1).max(16).nullable().optional(),
});

export type CreateRecipeInput = z.infer<typeof createRecipeSchema>;
export type UpdateRecipeInput = z.infer<typeof updateRecipeSchema>;
export type CreateRecipeItemInput = z.infer<typeof createRecipeItemSchema>;
export type UpdateRecipeItemInput = z.infer<typeof updateRecipeItemSchema>;
