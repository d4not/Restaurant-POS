import { z } from 'zod';

export const createProfileSchema = z.object({
  name: z.string().min(1).max(100),
  connection_type: z.enum(['NETWORK', 'USB']).default('NETWORK'),
  address: z.string().max(200).default(''),
  paper_width: z.number().int().refine((v) => [32, 42, 48].includes(v)).default(48),
  printer_model: z.enum(['epson', 'star', 'tanca', 'daruma', 'brother', 'custom']).default('epson'),
  character_set: z.string().max(50).default('PC850_MULTILINGUAL'),
  prints_comandas: z.boolean().default(true),
  prints_receipts: z.boolean().default(false),
  display_order: z.number().int().default(0),
});

export const updateProfileSchema = createProfileSchema.partial();

export const assignCategoriesSchema = z.object({
  category_ids: z.array(z.string().uuid()),
});

export type CreateProfileInput = z.infer<typeof createProfileSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
