import { z } from 'zod';

export const availabilityQuerySchema = z.object({
  register_id: z.string().uuid().optional(),
  station_id: z.string().uuid().optional(),
});

export type AvailabilityQuery = z.infer<typeof availabilityQuerySchema>;
