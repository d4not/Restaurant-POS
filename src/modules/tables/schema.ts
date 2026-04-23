import { z } from 'zod';
import { TableStatus } from '@prisma/client';

export const createTableSchema = z
  .object({
    zone_id: z.string().uuid(),
    number: z.number().int().positive(),
    capacity: z.number().int().positive().max(100).optional(),
    status: z.nativeEnum(TableStatus).optional(),
    active: z.boolean().optional(),
  })
  .strict();

export const updateTableSchema = z
  .object({
    zone_id: z.string().uuid().optional(),
    number: z.number().int().positive().optional(),
    capacity: z.number().int().positive().max(100).optional(),
    active: z.boolean().optional(),
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
