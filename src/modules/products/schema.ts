import { z } from 'zod';
import { ProductType } from '@prisma/client';

const productBody = z.object({
  name: z.string().min(1).max(200),
  type: z.nativeEnum(ProductType),
  category_id: z.string().uuid().nullable().optional(),
  station_id: z.string().uuid().nullable().optional(),
  sell_price: z.number().int().nonnegative().nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  icon_color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'icon_color must be a 6-digit hex like #AABBCC')
    .nullable()
    .optional(),
  display_order: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
  allow_discount: z.boolean().optional(),
  sold_by_weight: z.boolean().optional(),
  barcode: z.string().min(1).max(64).nullable().optional(),
  tax_id: z.string().uuid().nullable().optional(),
  supply_id: z.string().uuid().nullable().optional(),
});

// PREPARATION is a sub-recipe — it must not carry a POS-facing sell price,
// and it shouldn't live under a POS category; both would imply it's sellable.
const preparationConstraints = (data: z.infer<typeof productBody>): boolean => {
  if (data.type !== ProductType.PREPARATION) return true;
  if (data.sell_price != null) return false;
  if (data.category_id != null) return false;
  if (data.supply_id != null) return false;
  return true;
};

// Only packaged PRODUCTs (think "bottled water") can link to a supply item.
const supplyLinkConstraint = (data: z.infer<typeof productBody>): boolean => {
  if (data.supply_id == null) return true;
  return data.type === ProductType.PRODUCT;
};

export const createProductSchema = productBody
  .refine(preparationConstraints, {
    message: 'PREPARATION products cannot have sell_price, category_id, or supply_id',
  })
  .refine(supplyLinkConstraint, {
    message: 'supply_id is only valid for type=PRODUCT',
    path: ['supply_id'],
  });

export const updateProductSchema = productBody
  .partial()
  .refine(
    (data) => {
      if (data.type !== ProductType.PREPARATION) return true;
      if (data.sell_price != null) return false;
      if (data.category_id != null) return false;
      if (data.supply_id != null) return false;
      return true;
    },
    { message: 'PREPARATION products cannot have sell_price, category_id, or supply_id' },
  );

export const listProductQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(ProductType).optional(),
  category_id: z.string().uuid().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  include_deleted: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(200).optional(),
});

const variantBody = z.object({
  name: z.string().min(1).max(200),
  sell_price: z.number().int().nonnegative(),
  barcode: z.string().min(1).max(64).nullable().optional(),
  display_order: z.number().int().nonnegative().optional(),
  active: z.boolean().optional(),
});

export const createVariantSchema = variantBody;
export const updateVariantSchema = variantBody.partial();

export const attachModifierGroupSchema = z.object({
  modifier_group_id: z.string().uuid(),
});

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
export type ListProductQuery = z.infer<typeof listProductQuerySchema>;
export type CreateVariantInput = z.infer<typeof createVariantSchema>;
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;
export type AttachModifierGroupInput = z.infer<typeof attachModifierGroupSchema>;
