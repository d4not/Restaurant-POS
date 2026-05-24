import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createAttendanceSchema,
  listAttendanceQuerySchema,
  updateAttendanceSchema,
} from './schema.js';

// Reads stay open to all authenticated users so the terminal can prefill
// employee schedules and show attendance status next to active orders. Writes
// (logging an absence, marking late, deleting a record) require manager+ —
// floor staff shouldn't be able to retroactively edit their own attendance.
const ATTENDANCE_WRITERS = requireRole('MANAGER', 'ADMIN');

export const attendanceRouter = Router();

attendanceRouter.use(requireAuth);

attendanceRouter.post(
  '/',
  validate(createAttendanceSchema),
  ATTENDANCE_WRITERS,
  asyncHandler(controller.create),
);
attendanceRouter.get(
  '/',
  validate(listAttendanceQuerySchema, 'query'),
  asyncHandler(controller.list),
);
attendanceRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateAttendanceSchema),
  ATTENDANCE_WRITERS,
  asyncHandler(controller.update),
);
attendanceRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  ATTENDANCE_WRITERS,
  asyncHandler(controller.remove),
);
