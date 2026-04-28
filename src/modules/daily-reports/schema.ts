import { z } from 'zod';
import { DailyReportStatus } from '@prisma/client';

// Body for POST /api/v1/daily-reports/close. The action always targets
// *today* (REPORTS-SPEC §4.2). All four fields are optional so the close can
// be performed in two modes: a quick-close (just the totals computed from
// shifts), or a full reconciliation with manager-counted cash, bills/coins
// breakdown, and a written verdict.
//
//   - actual_cash: total cash counted by the manager. When provided, it
//     overrides the sum of per-shift `actual_cash` values. When omitted,
//     the service falls back to the per-shift sum (existing behaviour).
//   - denomination_breakdown: optional bills/coins counts. Keys are
//     denomination values in centavos as strings ("100000" = $1,000 MXN);
//     values are non-negative integer counts. The sum of (denom × count)
//     must equal actual_cash, validated server-side.
//   - resolution: short text the manager writes describing the cash
//     verdict ("Cuadrado", "Faltante de $30, se descontará a Carlos").
//   - notes: free-text operational context ("busy lunch, Andrea covered").
export const closeDailyReportSchema = z
  .object({
    actual_cash: z.number().int().optional(),
    denomination_breakdown: z
      .record(z.string().regex(/^\d+$/), z.number().int().min(0))
      .optional(),
    resolution: z.string().max(2000).optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

// Filters mirror REPORTS-SPEC §3.3: from/to scoping by the report's date,
// optional status filter, cursor pagination matching the rest of the API.
export const listDailyReportQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  status: z.nativeEnum(DailyReportStatus).optional(),
});

export type CloseDailyReportInput = z.infer<typeof closeDailyReportSchema>;
export type ListDailyReportQuery = z.infer<typeof listDailyReportQuerySchema>;
