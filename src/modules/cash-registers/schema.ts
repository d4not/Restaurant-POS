import { z } from 'zod';
import { CashMovementType, CashRegisterStatus } from '@prisma/client';

export const openRegisterSchema = z
  .object({
    opening_amount: z.number().int().nonnegative(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const closeRegisterSchema = z
  .object({
    actual_amount: z.number().int().nonnegative(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const verifyProvisionalSchema = z
  .object({
    actual_amount: z.number().int().nonnegative(),
    notes: z.string().max(2000).optional(),
  })
  .strict();

export const listRegisterQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(CashRegisterStatus).optional(),
  user_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export const createCashMovementSchema = z
  .object({
    type: z.nativeEnum(CashMovementType),
    amount: z.number().int().positive(),
    reason: z.string().min(1).max(500),
  })
  .strict();

// Admin edits: every field is optional but at least one must be present so
// the request is meaningful. Used by PATCH /registers/:rid/cash-movements/:mid.
export const updateCashMovementSchema = z
  .object({
    type: z.nativeEnum(CashMovementType).optional(),
    amount: z.number().int().positive().optional(),
    reason: z.string().min(1).max(500).optional(),
  })
  .strict()
  .refine(
    (v) => v.type !== undefined || v.amount !== undefined || v.reason !== undefined,
    { message: 'at least one of type, amount, reason is required' },
  );

export const listCashMovementQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(CashMovementType).optional(),
});

export type OpenRegisterInput = z.infer<typeof openRegisterSchema>;
export type CloseRegisterInput = z.infer<typeof closeRegisterSchema>;
export type VerifyProvisionalInput = z.infer<typeof verifyProvisionalSchema>;
export type ListRegisterQuery = z.infer<typeof listRegisterQuerySchema>;
export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;
export type UpdateCashMovementInput = z.infer<typeof updateCashMovementSchema>;
export type ListCashMovementQuery = z.infer<typeof listCashMovementQuerySchema>;
