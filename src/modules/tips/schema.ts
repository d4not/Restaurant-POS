import { z } from 'zod';
import { TipPoolStatus } from '@prisma/client';

export const listPoolsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.nativeEnum(TipPoolStatus).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  })
  .strict();

// At-most-one open pool exists per week. GET /pools/current looks up the
// Monday for today and creates the row if missing — no body needed.
export const currentPoolQuerySchema = z
  .object({
    // Optional date override so admins can review a week's pool from the
    // shape of its Monday — useful for backdated cleanups.
    date: z.coerce.date().optional(),
  })
  .strict();

export const updateAllocationSchema = z
  .object({
    included: z.boolean().optional(),
    // Pass null in override_amount to clear a previous manual override and
    // fall back to base_amount on the next refresh / close.
    override_amount: z.number().int().nonnegative().nullable().optional(),
    note: z.string().max(500).nullable().optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.included !== undefined ||
      v.override_amount !== undefined ||
      v.note !== undefined,
    { message: 'at least one field must be provided' },
  );

export const poolIdParamSchema = z.object({ id: z.string().uuid() });

export const poolAndUserParamSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

export type ListPoolsQuery = z.infer<typeof listPoolsQuerySchema>;
export type CurrentPoolQuery = z.infer<typeof currentPoolQuerySchema>;
export type UpdateAllocationInput = z.infer<typeof updateAllocationSchema>;
