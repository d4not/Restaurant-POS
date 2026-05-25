import { z } from 'zod';

export const createPrinterSchema = z.object({
  name: z.string().min(1).max(100),
  connection_type: z.enum(['NETWORK', 'USB']).default('NETWORK'),
  address: z.string().max(200).default(''),
  paper_width: z.number().int().refine((v) => [32, 42, 48].includes(v)).default(48),
  printer_model: z.enum(['epson', 'star', 'tanca', 'daruma', 'brother', 'custom']).default('epson'),
  character_set: z.string().max(50).default('PC850_MULTILINGUAL'),
});

export const updatePrinterSchema = createPrinterSchema.partial();

export type CreatePrinterInput = z.infer<typeof createPrinterSchema>;
export type UpdatePrinterInput = z.infer<typeof updatePrinterSchema>;
