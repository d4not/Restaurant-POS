import { z } from 'zod';
import { ModifierGroupType } from '@prisma/client';

const groupBody = z.object({
  name: z.string().min(1).max(200),
  type: z.nativeEnum(ModifierGroupType).optional(),
  replaces_supply_id: z.string().uuid().nullable().optional(),
  min_selection: z.number().int().nonnegative().optional(),
  max_selection: z.number().int().min(1).optional(),
  required: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

// A SWAP group must target a supply (otherwise the engine has no recipe line to
// replace). An ADD group must NOT carry replaces_supply_id.
const swapTargetConstraint = (d: z.infer<typeof groupBody>): boolean => {
  const type = d.type ?? ModifierGroupType.ADD;
  if (type === ModifierGroupType.SWAP) return d.replaces_supply_id != null;
  return d.replaces_supply_id == null;
};

export const createModifierGroupSchema = groupBody
  .refine((d) => (d.min_selection ?? 0) <= (d.max_selection ?? 1), {
    message: 'min_selection cannot exceed max_selection',
    path: ['min_selection'],
  })
  .refine(swapTargetConstraint, {
    message:
      'SWAP groups must provide replaces_supply_id; ADD groups must leave it null',
    path: ['replaces_supply_id'],
  });

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
  ratio: z.number().positive().optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

// supply_id + supply_quantity + supply_unit must all be present together
// (a modifier that deducts from inventory) or all absent (purely informational,
// e.g., "extra hot", "no foam"). SWAP modifiers can omit supply_quantity/unit
// because they scale the original recipe line — but if any of the three are
// present, the full triplet must be.
const supplyTripletConstraint = (d: z.infer<typeof modifierBody>): boolean => {
  const hasSupply = d.supply_id != null;
  const hasQty = d.supply_quantity != null;
  const hasUnit = d.supply_unit != null;
  if (!hasSupply && !hasQty && !hasUnit) return true;
  // SWAP modifiers only need supply_id (quantity/unit come from the recipe via
  // the ratio). But if any quantity/unit is supplied, both must be.
  if (hasSupply && !hasQty && !hasUnit) return true;
  return hasSupply && hasQty && hasUnit;
};

export const createModifierSchema = modifierBody.refine(supplyTripletConstraint, {
  message:
    'supply_id, supply_quantity, and supply_unit must all be provided together (or only supply_id for SWAP modifiers)',
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
