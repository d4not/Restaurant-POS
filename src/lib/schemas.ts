import { z } from 'zod';

export const uuidParamSchema = z.object({
  id: z.string().uuid(),
});

export type UuidParam = z.infer<typeof uuidParamSchema>;

// Accepts integer cents from the wire as number or stringified number.
export const centsSchema = z
  .union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)])
  .transform((v) => (typeof v === 'number' ? v : Number.parseInt(v, 10)));

// Quantity: up to 4 decimal places, non-negative. Accepted as number or string.
export const quantitySchema = z
  .union([z.number().nonnegative(), z.string().regex(/^\d+(\.\d{1,4})?$/)])
  .transform((v) => (typeof v === 'number' ? v.toString() : v));
