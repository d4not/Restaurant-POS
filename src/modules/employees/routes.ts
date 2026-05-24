import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createEmployeeSchema,
  listEmployeeQuerySchema,
  updateEmployeeSchema,
} from './schema.js';

// Reads stay open — the terminal needs to look up employees for
// payroll-deduct tabs, the absence prefill picker, and the tip pool table.
// Anything that mutates an employee's profile, role, salary, or PIN is
// manager+ only.
const EMPLOYEE_WRITERS = requireRole('MANAGER', 'ADMIN');

export const employeeRouter = Router();

employeeRouter.use(requireAuth);

employeeRouter.post(
  '/',
  validate(createEmployeeSchema),
  EMPLOYEE_WRITERS,
  asyncHandler(controller.create),
);
employeeRouter.get(
  '/',
  validate(listEmployeeQuerySchema, 'query'),
  asyncHandler(controller.list),
);
employeeRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
employeeRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateEmployeeSchema),
  EMPLOYEE_WRITERS,
  asyncHandler(controller.update),
);
employeeRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  EMPLOYEE_WRITERS,
  asyncHandler(controller.remove),
);
