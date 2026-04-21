import { z } from 'zod';
import { AttendanceStatus } from '@prisma/client';

// Accept YYYY-MM-DD or full ISO — we normalize to midnight UTC in the service
// so @@unique([user_id, date]) reliably collapses a day to a single row.
const dateField = z.coerce.date();

export const createAttendanceSchema = z
  .object({
    user_id: z.string().uuid(),
    date: dateField,
    status: z.nativeEnum(AttendanceStatus),
    reason: z.string().max(500).optional(),
    is_paid: z.boolean().optional(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const updateAttendanceSchema = z
  .object({
    status: z.nativeEnum(AttendanceStatus).optional(),
    reason: z.string().max(500).nullable().optional(),
    is_paid: z.boolean().optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const listAttendanceQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  user_id: z.string().uuid().optional(),
  status: z.nativeEnum(AttendanceStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateAttendanceInput = z.infer<typeof createAttendanceSchema>;
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;
export type ListAttendanceQuery = z.infer<typeof listAttendanceQuerySchema>;
