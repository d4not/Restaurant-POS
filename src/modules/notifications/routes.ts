import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  listNotificationsQuerySchema,
  sendTestSchema,
} from './schema.js';

export const notificationsRouter = Router();

notificationsRouter.use(requireAuth);

// Any signed-in user sees their own bell list.
notificationsRouter.get(
  '/',
  validate(listNotificationsQuerySchema, 'query'),
  asyncHandler(controller.listMine),
);

notificationsRouter.post(
  '/:id/read',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.markRead),
);

// ADMIN-only — synthetic dispatch for ops verification.
notificationsRouter.post(
  '/test',
  requireRole('ADMIN'),
  validate(sendTestSchema),
  asyncHandler(controller.sendTest),
);
