import { z } from 'zod';

const modificationBody = z.object({
  name: z.string().min(1).max(200),
  sell_price: z.number().int().nonnegative(),
  barcode: z.string().min(1).max(64).nullable().optional(),
  supply_id: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
  display_order: z.number().int().nonnegative().optional(),
});

export const createProductModificationSchema = modificationBody;
export const updateProductModificationSchema = modificationBody.partial();

export type CreateProductModificationInput = z.infer<typeof createProductModificationSchema>;
export type UpdateProductModificationInput = z.infer<typeof updateProductModificationSchema>;
