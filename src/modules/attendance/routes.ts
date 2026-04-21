import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createAttendanceSchema,
  listAttendanceQuerySchema,
  updateAttendanceSchema,
} from './schema.js';

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

attendanceRouter.post('/', validate(createAttendanceSchema), asyncHandler(controller.create));
attendanceRouter.get(
  '/',
  validate(listAttendanceQuerySchema, 'query'),
  asyncHandler(controller.list),
);
attendanceRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateAttendanceSchema),
  asyncHandler(controller.update),
);
attendanceRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
