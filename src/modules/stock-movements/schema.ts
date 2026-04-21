import { z } from 'zod';
import { StockMovementType } from '@prisma/client';

export const listStockMovementQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  supply_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  type: z.nativeEnum(StockMovementType).optional(),
  reference_type: z.string().max(64).optional(),
  reference_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListStockMovementQuery = z.infer<typeof listStockMovementQuerySchema>;
