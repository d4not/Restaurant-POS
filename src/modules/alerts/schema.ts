import { z } from 'zod';
import { AlertSeverity, AlertType } from '@prisma/client';

export const lowStockQuerySchema = z.object({
  storage_id: z.string().uuid().optional(),
});

export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;

// Filters mirror REPORTS-SPEC §3.4: by type/severity, by resolution status,
// and by created_at window. Cursor pagination matches the rest of the API.
export const listAlertQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(AlertType).optional(),
  severity: z.nativeEnum(AlertSeverity).optional(),
  resolved: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  shift_report_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListAlertQuery = z.infer<typeof listAlertQuerySchema>;

// Body for PATCH /api/v1/alerts/:id/resolve. The resolution string is the
// short audit note ("Counted again, matches"). Required so the trail isn't
// silent on why the alert was cleared.
export const resolveAlertSchema = z
  .object({
    resolution: z.string().min(1).max(500),
    resolution_type: z.enum(['no_action', 'resolved', 'charge_to_payroll']).optional(),
    charge_amount: z.number().int().min(1).optional(),
  })
  .strict()
  .refine(
    (d) => d.resolution_type !== 'charge_to_payroll' || (d.charge_amount && d.charge_amount > 0),
    { message: 'charge_amount is required when resolution_type is charge_to_payroll' },
  );

export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
