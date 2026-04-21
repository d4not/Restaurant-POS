import { z } from 'zod';

const basePayload = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  image_url: z.string().max(500).nullable().optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color must be a 6-digit hex like #AABBCC')
    .nullable()
    .optional(),
  display_order: z.number().int().nonnegative().optional(),
  visible_in_pos: z.boolean().optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

export const createProductCategorySchema = basePayload;
export const updateProductCategorySchema = basePayload.partial();

export const listProductCategoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  parent_id: z.union([z.literal('null'), z.string().uuid()]).optional(),
  visible_in_pos: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(120).optional(),
});

export type CreateProductCategoryInput = z.infer<typeof createProductCategorySchema>;
export type UpdateProductCategoryInput = z.infer<typeof updateProductCategorySchema>;
export type ListProductCategoryQuery = z.infer<typeof listProductCategoryQuerySchema>;
