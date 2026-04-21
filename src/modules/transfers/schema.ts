import { z } from 'zod';

const transferItemBody = z.object({
  supply_id: z.string().uuid(),
  quantity: z.number().positive(),
});

export const createTransferSchema = z
  .object({
    from_storage_id: z.string().uuid(),
    to_storage_id: z.string().uuid(),
    date: z.coerce.date(),
    notes: z.string().max(2000).optional(),
    items: z.array(transferItemBody).min(1),
  })
  .refine((v) => v.from_storage_id !== v.to_storage_id, {
    message: 'from_storage_id and to_storage_id must differ',
    path: ['to_storage_id'],
  });

export const listTransferQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  from_storage_id: z.string().uuid().optional(),
  to_storage_id: z.string().uuid().optional(),
  supply_id: z.string().uuid().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type CreateTransferInput = z.infer<typeof createTransferSchema>;
export type ListTransferQuery = z.infer<typeof listTransferQuerySchema>;
