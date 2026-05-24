import { z } from 'zod';
import { WriteOffReason } from '@prisma/client';

export const createWriteOffSchema = z.object({
  storage_id: z.string().uuid(),
  supply_id: z.string().uuid(),
  quantity: z.number().positive(),
  reason: z.nativeEnum(WriteOffReason),
  notes: z.string().max(2000).optional(),
  date: z.coerce.date(),
});

export const createWriteOffBatchSchema = z.object({
  storage_id: z.string().uuid(),
  date: z.coerce.date(),
  reason: z.nativeEnum(WriteOffReason),
  notes: z.string().max(2000).optional(),
  items: z
    .array(
      z.object({
        supply_id: z.string().uuid(),
        quantity: z.number().positive(),
        // Per-line overrides — when omitted, the ticket-level reason/notes apply.
        reason: z.nativeEnum(WriteOffReason).optional(),
        notes: z.string().max(2000).optional(),
      }),
    )
    .min(1),
});

export const listWriteOffQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  storage_id: z.string().uuid().optional(),
  supply_id: z.string().uuid().optional(),
  reason: z.nativeEnum(WriteOffReason).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateWriteOffInput = z.infer<typeof createWriteOffSchema>;
export type CreateWriteOffBatchInput = z.infer<typeof createWriteOffBatchSchema>;
export type ListWriteOffQuery = z.infer<typeof listWriteOffQuerySchema>;
