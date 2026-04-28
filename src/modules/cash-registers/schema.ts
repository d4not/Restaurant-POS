import { z } from 'zod';
import { CashMovementType, CashRegisterKind, CashRegisterStatus } from '@prisma/client';

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

export const listRegisterQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  status: z.nativeEnum(CashRegisterStatus).optional(),
  kind: z.nativeEnum(CashRegisterKind).optional(),
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

export const listCashMovementQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  type: z.nativeEnum(CashMovementType).optional(),
});

export type OpenRegisterInput = z.infer<typeof openRegisterSchema>;
export type CloseRegisterInput = z.infer<typeof closeRegisterSchema>;
export type ListRegisterQuery = z.infer<typeof listRegisterQuerySchema>;
export type CreateCashMovementInput = z.infer<typeof createCashMovementSchema>;
export type ListCashMovementQuery = z.infer<typeof listCashMovementQuerySchema>;
