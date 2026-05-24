import { z } from 'zod';
import {
  NOTIFICATION_EVENT_TYPES,
  NOTIFICATION_SEVERITIES,
} from './event-types.js';

export const listNotificationsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  unread_only: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListNotificationsQuery = z.infer<
  typeof listNotificationsQuerySchema
>;

/**
 * Body of `POST /notifications/test`. All fields optional — sensible
 * defaults so an admin can hit the endpoint without any payload to verify
 * the wiring.
 */
export const sendTestSchema = z
  .object({
    type: z.enum(NOTIFICATION_EVENT_TYPES).optional(),
    severity: z.enum(NOTIFICATION_SEVERITIES).optional(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(1_000).optional(),
    recipient_roles: z
      .array(z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'BARISTA', 'WAITER']))
      .optional(),
    recipient_user_ids: z.array(z.string().uuid()).optional(),
  })
  .strict();
export type SendTestInput = z.infer<typeof sendTestSchema>;
