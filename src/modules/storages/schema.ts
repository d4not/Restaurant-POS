import { z } from 'zod';

export const createStorageSchema = z.object({
  name: z.string().min(1).max(120),
  address: z.string().max(500).optional(),
  active: z.boolean().optional(),
});

export const updateStorageSchema = createStorageSchema.partial();

export const listStorageQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(120).optional(),
});

export const storageStockQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  low_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export const updateStorageStockSchema = z.object({
  min_stock: z.number().nonnegative().nullable().optional(),
});

export type CreateStorageInput = z.infer<typeof createStorageSchema>;
export type UpdateStorageInput = z.infer<typeof updateStorageSchema>;
export type ListStorageQuery = z.infer<typeof listStorageQuerySchema>;
export type StorageStockQuery = z.infer<typeof storageStockQuerySchema>;
export type UpdateStorageStockInput = z.infer<typeof updateStorageStockSchema>;
