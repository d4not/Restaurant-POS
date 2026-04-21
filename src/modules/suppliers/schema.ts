import { z } from 'zod';

export const createSupplierSchema = z.object({
  name: z.string().min(1).max(200),
  contact_name: z.string().max(200).optional(),
  phone: z.string().max(40).optional(),
  email: z.string().email().max(200).optional(),
  address: z.string().max(500).optional(),
  credit_days: z.number().int().min(0).max(365).default(0),
  notes: z.string().max(2000).optional(),
  active: z.boolean().optional(),
});

export const updateSupplierSchema = createSupplierSchema.partial();

export const listSupplierQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  search: z.string().min(1).max(200).optional(),
});

export type CreateSupplierInput = z.infer<typeof createSupplierSchema>;
export type UpdateSupplierInput = z.infer<typeof updateSupplierSchema>;
export type ListSupplierQuery = z.infer<typeof listSupplierQuerySchema>;
