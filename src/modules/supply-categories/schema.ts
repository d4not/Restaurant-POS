import { z } from 'zod';

export const createSupplyCategorySchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).optional(),
});

export const updateSupplyCategorySchema = createSupplyCategorySchema.partial();

export const listSupplyCategoryQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  search: z.string().min(1).max(120).optional(),
});

export type CreateSupplyCategoryInput = z.infer<typeof createSupplyCategorySchema>;
export type UpdateSupplyCategoryInput = z.infer<typeof updateSupplyCategorySchema>;
export type ListSupplyCategoryQuery = z.infer<typeof listSupplyCategoryQuerySchema>;
