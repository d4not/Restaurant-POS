import { z } from 'zod';
import { PayrollAdjustmentType, PayrollStatus } from '@prisma/client';

const dateField = z.coerce.date();

export const generatePayrollSchema = z
  .object({
    week_start: dateField,
    // Fallback days_expected used only when an employee has no active
    // schedule slots. Employees with a schedule derive days_expected from
    // count(active slots). Kept for back-compat with callers that still
    // pass it; new admin UIs will omit it once every employee has a schedule.
    days_expected: z.number().int().min(1).max(7).default(6),
  })
  .strict();

// PATCH /:id mutates notes + status only. Bonuses and deductions are now
// itemized via the adjustments sub-resource; trying to set them directly
// here is rejected by the .strict() schema below.
export const updatePayrollSchema = z
  .object({
    notes: z.string().max(2000).nullable().optional(),
    status: z.nativeEnum(PayrollStatus).optional(),
  })
  .strict()
  .refine((v) => v.notes !== undefined || v.status !== undefined, {
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

// POST /:id/adjustments — manager adds one BONUS or DEDUCTION row to the
// period. label is required so the audit trail explains why; amount is
// always positive (the type flips its sign in the formula).
export const createAdjustmentSchema = z
  .object({
    type: z.nativeEnum(PayrollAdjustmentType),
    label: z.string().min(1).max(160),
    amount: z.number().int().positive(),
  })
  .strict();

export const adjustmentParamSchema = z.object({
  id: z.string().uuid(),
  adjustmentId: z.string().uuid(),
});

export type GeneratePayrollInput = z.infer<typeof generatePayrollSchema>;
export type UpdatePayrollInput = z.infer<typeof updatePayrollSchema>;
export type ListPayrollQuery = z.infer<typeof listPayrollQuerySchema>;
export type CreateAdjustmentInput = z.infer<typeof createAdjustmentSchema>;
