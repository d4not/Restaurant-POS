import { z } from 'zod';

export const createDeductionRuleSchema = z
  .object({
    station_id: z.string().uuid().nullable().optional(),
    pos_register_id: z.string().uuid().nullable().optional(),
    storage_id: z.string().uuid(),
  })
  .strict();

export const updateDeductionRuleSchema = z
  .object({
    station_id: z.string().uuid().nullable().optional(),
    pos_register_id: z.string().uuid().nullable().optional(),
    storage_id: z.string().uuid().optional(),
  })
  .strict();

export const listDeductionRuleQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  storage_id: z.string().uuid().optional(),
  station_id: z.string().uuid().optional(),
  pos_register_id: z.string().uuid().optional(),
});

export type CreateDeductionRuleInput = z.infer<typeof createDeductionRuleSchema>;
export type UpdateDeductionRuleInput = z.infer<typeof updateDeductionRuleSchema>;
export type ListDeductionRuleQuery = z.infer<typeof listDeductionRuleQuerySchema>;
