import { z } from 'zod';
import { ZoneKind } from '@prisma/client';

// Floor-canvas geometry. Bounds match the table layout schema so the canvas
// scales the same way for both. TAKEOUT zones never paint on the canvas, so
// these are layout-only metadata for them.
const zoneLayoutFields = {
  pos_x: z.number().int().min(-10_000).max(10_000).optional(),
  pos_y: z.number().int().min(-10_000).max(10_000).optional(),
  width: z.number().int().min(24).max(2_000).optional(),
  height: z.number().int().min(24).max(2_000).optional(),
};

export const createZoneSchema = z
  .object({
    name: z.string().min(1).max(120),
    display_order: z.number().int().min(0).optional(),
    kind: z.nativeEnum(ZoneKind).optional(),
    active: z.boolean().optional(),
    ...zoneLayoutFields,
  })
  .strict();

export const updateZoneSchema = createZoneSchema.partial();

export const listZoneQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  active: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  // include_tables=true populates each Zone with its tables (sorted by number).
  // The dedicated /tables endpoint is the right answer for table-heavy views;
  // this flag exists so the small Tables & Zones management page can render
  // everything in a single round-trip.
  include_tables: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});

export type CreateZoneInput = z.infer<typeof createZoneSchema>;
export type UpdateZoneInput = z.infer<typeof updateZoneSchema>;
export type ListZoneQuery = z.infer<typeof listZoneQuerySchema>;
