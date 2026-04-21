import { z } from 'zod';

export const lowStockQuerySchema = z.object({
  storage_id: z.string().uuid().optional(),
});

export type LowStockQuery = z.infer<typeof lowStockQuerySchema>;
