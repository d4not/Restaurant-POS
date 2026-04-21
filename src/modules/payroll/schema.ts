import { z } from 'zod';
import { PayrollStatus } from '@prisma/client';

const dateField = z.coerce.date();

export const generatePayrollSchema = z
  .object({
    week_start: dateField,
    days_expected: z.number().int().min(1).max(7).default(6),
  })
  .strict();

// Drives status transitions DRAFT→APPROVED→PAID via PATCH. Only the bonuses /
// notes fields are mutable directly; status goes through its own rail.
export const updatePayrollSchema = z
  .object({
    bonuses: z.number().int().nonnegative().optional(),
    notes: z.string().max(2000).nullable().optional(),
    status: z.nativeEnum(PayrollStatus).optional(),
  })
  .strict()
  .refine((v) => v.bonuses !== undefined || v.notes !== undefined || v.status !== undefined, {
    message: 'at least one field must be provided',
  });

export const listPayrollQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  user_id: z.string().uuid().optional(),
  status: z.nativeEnum(PayrollStatus).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type UpdatePayrollInput = z.infer<typeof updatePayrollSchema>;
export type ListPayrollQuery = z.infer<typeof listPayrollQuerySchema>;
