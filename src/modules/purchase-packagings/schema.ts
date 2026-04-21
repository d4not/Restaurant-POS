import { z } from 'zod';

export const createPackagingSchema = z.object({
  supply_id: z.string().uuid(),
  supplier_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  units_per_package: z.number().positive(),
  active: z.boolean().optional(),
});

export const updatePackagingSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  units_per_package: z.number().positive().optional(),
  active: z.boolean().optional(),
});

export const listPackagingQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  supply_id: z.string().uuid().optional(),
  supplier_id: z.string().uuid().optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreatePackagingInput = z.infer<typeof createPackagingSchema>;
export type UpdatePackagingInput = z.infer<typeof updatePackagingSchema>;
export type ListPackagingQuery = z.infer<typeof listPackagingQuerySchema>;
