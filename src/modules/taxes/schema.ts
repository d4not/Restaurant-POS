import { z } from 'zod';

// Tax rate stored as a percentage (e.g. 16.00 for IVA 16%). Allow up to 4
// digits + 2 decimals to match the Decimal(6,2) column.
export const createTaxSchema = z.object({
  name: z.string().min(1).max(200),
  rate: z.number().min(0).max(9999.99),
  active: z.boolean().optional(),
});

export const updateTaxSchema = createTaxSchema.partial();

export const listTaxQuerySchema = z.object({
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateTaxInput = z.infer<typeof createTaxSchema>;
export type UpdateTaxInput = z.infer<typeof updateTaxSchema>;
export type ListTaxQuery = z.infer<typeof listTaxQuerySchema>;
