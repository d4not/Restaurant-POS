import { z } from 'zod';

const layoutFields = {
  pos_x: z.number().int().min(-10_000).max(10_000).optional(),
  pos_y: z.number().int().min(-10_000).max(10_000).optional(),
  width: z.number().int().min(24).max(2_000).optional(),
  height: z.number().int().min(16).max(2_000).optional(),
  font_size: z.number().int().min(8).max(96).optional(),
  rotation: z.number().int().min(0).max(359).optional(),
};

export const createZoneLabelSchema = z
  .object({
    zone_id: z.string().uuid(),
    text: z.string().min(1).max(120),
    ...layoutFields,
  })
  .strict();

export const updateZoneLabelSchema = z
  .object({
    zone_id: z.string().uuid().optional(),
    text: z.string().min(1).max(120).optional(),
    ...layoutFields,
  })
  .strict();

export const listZoneLabelQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  zone_id: z.string().uuid().optional(),
});

export type CreateZoneLabelInput = z.infer<typeof createZoneLabelSchema>;
export type UpdateZoneLabelInput = z.infer<typeof updateZoneLabelSchema>;
export type ListZoneLabelQuery = z.infer<typeof listZoneLabelQuerySchema>;
