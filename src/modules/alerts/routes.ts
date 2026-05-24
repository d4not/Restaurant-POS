import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  listAlertQuerySchema,
  lowStockQuerySchema,
  resolveAlertSchema,
} from './schema.js';

export const alertRouter = Router();

alertRouter.use(requireAuth);

// Low-stock rollup — open to any signed-in user since the floor staff use it
// to plan transfers and aren't gated like the audit alerts below.
alertRouter.get(
  '/low-stock',
  validate(lowStockQuerySchema, 'query'),
  asyncHandler(controller.lowStock),
);

// Auto-generated audit alerts (cash shortage, voids, etc.). Gated to
// MANAGER/ADMIN per REPORTS-SPEC §3.4 — only the people who can act on them
// get to read them.
alertRouter.get(
  '/',
  requireRole('MANAGER', 'ADMIN'),
  validate(listAlertQuerySchema, 'query'),
  asyncHandler(controller.list),
);

// PATCH /:id/resolve — manager+ marks an alert resolved with a short note.
alertRouter.patch(
  '/:id/resolve',
  requireRole('MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  validate(resolveAlertSchema),
  asyncHandler(controller.resolve),
);
