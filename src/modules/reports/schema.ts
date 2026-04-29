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

// Products-sold report — Poster-style breakdown of every (product × variant ×
// modifier-combo) sold in a window. Optional filters narrow by category, the
// waiter who took the order, or a free-text product-name search.
export const productsSoldQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    category_id: z.string().uuid().optional(),
    user_id: z.string().uuid().optional(),
    q: z.string().trim().min(1).max(120).optional(),
  })
  .refine((v) => v.from <= v.to, {
    message: 'from must be <= to',
    path: ['from'],
  });

export type ProductsSoldQuery = z.infer<typeof productsSoldQuerySchema>;

// Daily summary: one cashier-facing snapshot of a single day's sales activity.
// `date` is interpreted in UTC against the Order.order_date column (a DATE).
// `register_id` scopes to a single shift and unlocks `expected_cash`.
const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((s) => {
    // Reject overflowed dates like "2026-13-99". Parse strictly: re-emit YYYY-MM-DD
    // from the parsed components and require an exact match.
    const [y, m, d] = s.split('-').map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
    );
  }, 'date is not a valid calendar date');

export const dailySummaryQuerySchema = z.object({
  date: dateString.optional(),
  register_id: z.string().uuid().optional(),
});

export type DailySummaryQuery = z.infer<typeof dailySummaryQuerySchema>;
