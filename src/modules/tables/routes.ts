import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createTableSchema,
  listTableQuerySchema,
  updateTableSchema,
  updateTableStatusSchema,
} from './schema.js';

// Floor-plan auth model:
// - All authenticated users can READ tables and flip status (occupied/free).
// - CASHIER + MANAGER + ADMIN can mutate layout (move/resize/relabel/rotate).
// - Only ADMIN can create new tables or delete existing ones — destructive
//   schema changes go through admin (or, in the future, the suggestion queue).
const LAYOUT_EDITORS = requireRole('CASHIER', 'MANAGER', 'ADMIN');
const LAYOUT_ADMINS = requireRole('ADMIN');

export const tableRouter = Router();

tableRouter.use(requireAuth);

tableRouter.post(
  '/',
  LAYOUT_ADMINS,
  validate(createTableSchema),
  asyncHandler(controller.create),
);
tableRouter.get('/', validate(listTableQuerySchema, 'query'), asyncHandler(controller.list));
tableRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
tableRouter.patch(
  '/:id',
  LAYOUT_EDITORS,
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
  LAYOUT_ADMINS,
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
