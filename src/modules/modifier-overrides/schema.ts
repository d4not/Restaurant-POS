import { z } from 'zod';
import { ModifierOverrideType } from '@prisma/client';

const overrideBody = z.object({
  modifier_id: z.string().uuid(),
  override_type: z.nativeEnum(ModifierOverrideType),
  override_ratio: z.number().positive().nullable().optional(),
  override_quantity: z.number().positive().nullable().optional(),
  override_unit: z.string().min(1).max(10).nullable().optional(),
});

// RATIO overrides store a single scalar in override_ratio.
// FIXED_QTY overrides store quantity + unit (ratio must be null).
const shapeConstraint = (d: z.infer<typeof overrideBody>): boolean => {
  if (d.override_type === ModifierOverrideType.RATIO) {
    return d.override_ratio != null && d.override_quantity == null && d.override_unit == null;
  }
  return d.override_quantity != null && d.override_unit != null && d.override_ratio == null;
};

export const createOverrideSchema = overrideBody.refine(shapeConstraint, {
  message:
    'RATIO overrides require override_ratio; FIXED_QTY overrides require override_quantity + override_unit',
  path: ['override_type'],
});

const updateBody = z.object({
  override_type: z.nativeEnum(ModifierOverrideType).optional(),
  override_ratio: z.number().positive().nullable().optional(),
  override_quantity: z.number().positive().nullable().optional(),
  override_unit: z.string().min(1).max(10).nullable().optional(),
});

export const updateOverrideSchema = updateBody;

export type CreateOverrideInput = z.infer<typeof createOverrideSchema>;
export type UpdateOverrideInput = z.infer<typeof updateOverrideSchema>;
