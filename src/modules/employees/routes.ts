import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createEmployeeSchema,
  listEmployeeQuerySchema,
  updateEmployeeSchema,
} from './schema.js';

export const employeeRouter = Router();

employeeRouter.use(requireAuth);

employeeRouter.post('/', validate(createEmployeeSchema), asyncHandler(controller.create));
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
  asyncHandler(controller.update),
);
employeeRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
