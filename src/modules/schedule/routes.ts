import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import {
  replaceWeekSchema,
  upsertDaySchema,
  userIdParamSchema,
  userIdAndDayParamSchema,
} from './schema.js';

// Reads are open to any authenticated user — the terminal needs to read
// schedules to render the read-only grid and prefill the absence form. Writes
// require manager+ since changing a schedule changes payroll expectations.
const SCHEDULE_WRITERS = requireRole('MANAGER', 'ADMIN');

export const scheduleRouter = Router();

scheduleRouter.use(requireAuth);

scheduleRouter.get('/', asyncHandler(controller.listRoster));

scheduleRouter.get(
  '/users/:userId',
  validate(userIdParamSchema, 'params'),
  asyncHandler(controller.getForUser),
);

scheduleRouter.put(
  '/users/:userId',
  validate(userIdParamSchema, 'params'),
  validate(replaceWeekSchema),
  SCHEDULE_WRITERS,
  asyncHandler(controller.replaceForUser),
);

scheduleRouter.patch(
  '/users/:userId/days/:dayOfWeek',
  validate(userIdAndDayParamSchema, 'params'),
  validate(upsertDaySchema),
  SCHEDULE_WRITERS,
  asyncHandler(controller.upsertDay),
);

scheduleRouter.delete(
  '/users/:userId/days/:dayOfWeek',
  validate(userIdAndDayParamSchema, 'params'),
  SCHEDULE_WRITERS,
  asyncHandler(controller.clearDay),
);
