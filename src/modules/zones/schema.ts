import { z } from 'zod';

export const createZoneSchema = z
  .object({
    name: z.string().min(1).max(120),
    display_order: z.number().int().min(0).optional(),
    active: z.boolean().optional(),
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
