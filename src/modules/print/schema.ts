import { z } from 'zod';

// Both print endpoints take only the order id. Kept as a body parameter (not
// a URL param) so the mobile app can send a JSON body — easier to add fields
// later (e.g. force-reprint, station hint) without a route rename.
export const printOrderSchema = z.object({
  order_id: z.string().uuid(),
});

export type PrintOrderInput = z.infer<typeof printOrderSchema>;
