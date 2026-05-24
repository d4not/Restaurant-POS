import { z } from 'zod';

// Filters mirror REPORTS-SPEC §3.2: from/to scoping by closed_at, optional
// user_id (manager filtering by cashier). Cursor pagination matches the rest
// of the API.
export const listShiftReportQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  user_id: z.string().uuid().optional(),
});

export type ListShiftReportQuery = z.infer<typeof listShiftReportQuerySchema>;
