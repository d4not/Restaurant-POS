import { z } from 'zod';
import { DecorType } from '@prisma/client';

// Layout bounds match the Table layout schema so the canvas scales the same
// way for both. Decor never holds orders or status; it's pure geometry + label.
const decorLayoutFields = {
  pos_x: z.number().int().min(-10_000).max(10_000).optional(),
  pos_y: z.number().int().min(-10_000).max(10_000).optional(),
  width: z.number().int().min(8).max(2_000).optional(),
  height: z.number().int().min(8).max(2_000).optional(),
  rotation: z.number().int().min(0).max(359).optional(),
  label: z.string().max(40).nullable().optional(),
};

export const createFloorDecorSchema = z
  .object({
    zone_id: z.string().uuid(),
    type: z.nativeEnum(DecorType),
    ...decorLayoutFields,
  })
  .strict();

export const updateFloorDecorSchema = z
  .object({
    zone_id: z.string().uuid().optional(),
    type: z.nativeEnum(DecorType).optional(),
    active: z.boolean().optional(),
    ...decorLayoutFields,
  })
  .strict();

export const listFloorDecorQuerySchema = z.object({
  zone_id: z.string().uuid().optional(),
  type: z.nativeEnum(DecorType).optional(),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateFloorDecorInput = z.infer<typeof createFloorDecorSchema>;
export type UpdateFloorDecorInput = z.infer<typeof updateFloorDecorSchema>;
export type ListFloorDecorQuery = z.infer<typeof listFloorDecorQuerySchema>;
