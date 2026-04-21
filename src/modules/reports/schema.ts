import { z } from 'zod';

export const varianceQuerySchema = z
  .object({
    storage_id: z.string().uuid().optional(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type VarianceQuery = z.infer<typeof varianceQuerySchema>;

export const supplyMovementsQuerySchema = z
  .object({
    supply_id: z.string().uuid(),
    storage_id: z.string().uuid().optional(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type SupplyMovementsQuery = z.infer<typeof supplyMovementsQuerySchema>;

// Query booleans: `z.coerce.boolean()` uses JS truthiness, which means the
// string "false" would coerce to true. Parse "true"/"false"/"1"/"0" explicitly.
const queryBool = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((v) => v === true || v === 'true' || v === '1');

export const productCostsQuerySchema = z.object({
  active_only: queryBool.default(true),
});

export type ProductCostsQuery = z.infer<typeof productCostsQuerySchema>;

export const productAnalysisQuerySchema = z
  .object({
    product_id: z.string().uuid(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type ProductAnalysisQuery = z.infer<typeof productAnalysisQuerySchema>;
