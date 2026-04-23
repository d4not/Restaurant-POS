import { z } from 'zod';
import { TableShape, TableStatus } from '@prisma/client';

// Layout fields shared by create + update. Kept lenient (large ranges, small
// minimums) so the canvas can handle arbitrary floor sizes. rotation wraps at
// 360 — the UI normalizes but we accept any non-negative integer for API
// robustness (0-359 is the canonical range).
const layoutFields = {
  pos_x: z.number().int().min(-10_000).max(10_000).optional(),
  pos_y: z.number().int().min(-10_000).max(10_000).optional(),
  width: z.number().int().min(24).max(2_000).optional(),
  height: z.number().int().min(24).max(2_000).optional(),
  shape: z.nativeEnum(TableShape).optional(),
  label: z.string().max(40).nullable().optional(),
  rotation: z.number().int().min(0).max(359).optional(),
};

export const createTableSchema = z
  .object({
    zone_id: z.string().uuid(),
    number: z.number().int().positive(),
    capacity: z.number().int().positive().max(100).optional(),
    status: z.nativeEnum(TableStatus).optional(),
    active: z.boolean().optional(),
    ...layoutFields,
  })
  .strict();

export const updateTableSchema = z
  .object({
    zone_id: z.string().uuid().optional(),
    number: z.number().int().positive().optional(),
    capacity: z.number().int().positive().max(100).optional(),
    active: z.boolean().optional(),
    ...layoutFields,
  })
  .strict();

// Status changes flow through their own endpoint so the front-of-house can
// "Mark reserved" / "Mark available" without touching capacity or zone.
export const updateTableStatusSchema = z
  .object({
    status: z.nativeEnum(TableStatus),
  })
  .strict();

export const listTableQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  zone_id: z.string().uuid().optional(),
  status: z.nativeEnum(TableStatus).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateTableInput = z.infer<typeof createTableSchema>;
export type UpdateTableInput = z.infer<typeof updateTableSchema>;
export type UpdateTableStatusInput = z.infer<typeof updateTableStatusSchema>;
export type ListTableQuery = z.infer<typeof listTableQuerySchema>;
