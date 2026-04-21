import { z } from 'zod';

export const upsertTareWeightSchema = z
  .object({
    empty_weight_grams: z.number().positive(),
    full_weight_grams: z.number().positive(),
    net_content: z.number().positive(),
  })
  .refine((d) => d.full_weight_grams > d.empty_weight_grams, {
    message: 'full_weight_grams must be greater than empty_weight_grams',
    path: ['full_weight_grams'],
  });

export type UpsertTareWeightInput = z.infer<typeof upsertTareWeightSchema>;
