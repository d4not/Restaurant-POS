import { z } from 'zod';

const groupBody = z.object({
  name: z.string().min(1).max(200),
  min_selection: z.number().int().nonnegative().optional(),
  max_selection: z.number().int().min(1).optional(),
  required: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

export const createModifierGroupSchema = groupBody.refine(
  (d) => (d.min_selection ?? 0) <= (d.max_selection ?? 1),
  { message: 'min_selection cannot exceed max_selection', path: ['min_selection'] },
);

export const updateModifierGroupSchema = groupBody.partial();

export const listModifierGroupQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(200).optional(),
});

const modifierBody = z.object({
  name: z.string().min(1).max(200),
  extra_price: z.number().int().nonnegative().optional(),
  supply_id: z.string().uuid().nullable().optional(),
  supply_quantity: z.number().positive().nullable().optional(),
  supply_unit: z.string().min(1).max(10).nullable().optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

// supply_id + supply_quantity + supply_unit must all be present together
// (a modifier that deducts from inventory) or all absent (purely informational,
// e.g., "extra hot", "no foam"). Anything in between would leave the sale
// deduction flow unable to figure out what to deduct.
const supplyTripletConstraint = (d: z.infer<typeof modifierBody>): boolean => {
  const hasSupply = d.supply_id != null;
  const hasQty = d.supply_quantity != null;
  const hasUnit = d.supply_unit != null;
  if (!hasSupply && !hasQty && !hasUnit) return true;
  return hasSupply && hasQty && hasUnit;
};

export const createModifierSchema = modifierBody.refine(supplyTripletConstraint, {
  message: 'supply_id, supply_quantity, and supply_unit must all be provided together',
  path: ['supply_id'],
});

export const updateModifierSchema = modifierBody.partial();

export const listModifierQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateModifierGroupInput = z.infer<typeof createModifierGroupSchema>;
export type UpdateModifierGroupInput = z.infer<typeof updateModifierGroupSchema>;
export type ListModifierGroupQuery = z.infer<typeof listModifierGroupQuerySchema>;
export type CreateModifierInput = z.infer<typeof createModifierSchema>;
export type UpdateModifierInput = z.infer<typeof updateModifierSchema>;
export type ListModifierQuery = z.infer<typeof listModifierQuerySchema>;
