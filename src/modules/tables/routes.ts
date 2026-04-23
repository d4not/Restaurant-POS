import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createTableSchema,
  listTableQuerySchema,
  updateTableSchema,
  updateTableStatusSchema,
} from './schema.js';

export const tableRouter = Router();

tableRouter.use(requireAuth);

tableRouter.post('/', validate(createTableSchema), asyncHandler(controller.create));
tableRouter.get('/', validate(listTableQuerySchema, 'query'), asyncHandler(controller.list));
tableRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
tableRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateTableSchema),
  asyncHandler(controller.update),
);
tableRouter.patch(
  '/:id/status',
  validate(uuidParamSchema, 'params'),
  validate(updateTableStatusSchema),
  asyncHandler(controller.updateStatus),
);
tableRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
