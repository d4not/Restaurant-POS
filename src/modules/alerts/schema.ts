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
  })
  .strict();

export type ResolveAlertInput = z.infer<typeof resolveAlertSchema>;
