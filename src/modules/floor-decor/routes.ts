import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createFloorDecorSchema,
  listFloorDecorQuerySchema,
  updateFloorDecorSchema,
} from './schema.js';

// Decor is layout-only and has no operational meaning, so the auth model is
// stricter than tables: ADMINs only. CASHIERs/MANAGERs can edit existing
// tables (their numbers and seating capacity matter to the floor) but they
// don't get to add bar counters or plants.
const DECOR_ADMINS = requireRole('ADMIN');

export const floorDecorRouter = Router();

floorDecorRouter.use(requireAuth);

floorDecorRouter.post(
  '/',
  DECOR_ADMINS,
  validate(createFloorDecorSchema),
  asyncHandler(controller.create),
);
floorDecorRouter.get(
  '/',
  validate(listFloorDecorQuerySchema, 'query'),
  asyncHandler(controller.list),
);
floorDecorRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
floorDecorRouter.patch(
  '/:id',
  DECOR_ADMINS,
  validate(uuidParamSchema, 'params'),
  validate(updateFloorDecorSchema),
  asyncHandler(controller.update),
);
floorDecorRouter.delete(
  '/:id',
  DECOR_ADMINS,
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
