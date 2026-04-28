import { z } from 'zod';
import { ShiftType } from '@prisma/client';

// Filters mirror REPORTS-SPEC §3.2: from/to scoping by closed_at, optional
// user_id (manager filtering by cashier), and optional type to surface
// provisionals separately. Cursor pagination matches the rest of the API.
export const listShiftReportQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  user_id: z.string().uuid().optional(),
  type: z.nativeEnum(ShiftType).optional(),
});

export type ListShiftReportQuery = z.infer<typeof listShiftReportQuerySchema>;
