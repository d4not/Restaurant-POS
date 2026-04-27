import { z } from 'zod';
import { StockMovementType } from '@prisma/client';

const movementTypeEnum = z.nativeEnum(StockMovementType);

// Accept either a single type or a comma-separated list. The Movements tab
// strip on the admin uses the multi-type form to group Transfers (which are
// always paired TRANSFER_OUT + TRANSFER_IN rows under a single conceptual
// event) and to surface them under one tab without two queries.
const typeFilter = z
  .union([movementTypeEnum, z.string()])
  .transform((value) => {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [value as StockMovementType];
    const parts = value
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return parts.map((p) => movementTypeEnum.parse(p));
  })
  .optional();

export const listStockMovementQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  supply_id: z.string().uuid().optional(),
  storage_id: z.string().uuid().optional(),
  type: typeFilter,
  reference_type: z.string().max(64).optional(),
  reference_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListStockMovementQuery = z.infer<typeof listStockMovementQuerySchema>;
