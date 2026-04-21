import { z } from 'zod';
import { InventoryCheckType } from '@prisma/client';

export const createInventoryCheckSchema = z.object({
  storage_id: z.string().uuid(),
  type: z.nativeEnum(InventoryCheckType),
  date: z.coerce.date(),
  // Only required when type=PARTIAL — the service validates this.
  supply_ids: z.array(z.string().uuid()).optional(),
});

// Updating an in-progress check: set the actual counted quantities.
export const setCheckItemsSchema = z.object({
  items: z
    .array(
      z.object({
        supply_id: z.string().uuid(),
        actual_qty: z.number().nonnegative(),
      }),
    )
    .min(1),
});

export const listInventoryCheckQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  storage_id: z.string().uuid().optional(),
  status: z.enum(['IN_PROGRESS', 'COMPLETED']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateInventoryCheckInput = z.infer<typeof createInventoryCheckSchema>;
export type SetCheckItemsInput = z.infer<typeof setCheckItemsSchema>;
export type ListInventoryCheckQuery = z.infer<typeof listInventoryCheckQuerySchema>;
