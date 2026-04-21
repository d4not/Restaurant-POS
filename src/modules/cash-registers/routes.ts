import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  closeRegisterSchema,
  createCashMovementSchema,
  listCashMovementQuerySchema,
  listRegisterQuerySchema,
  openRegisterSchema,
} from './schema.js';

export const cashRegisterRouter = Router();

cashRegisterRouter.use(requireAuth);

cashRegisterRouter.post('/', validate(openRegisterSchema), asyncHandler(controller.open));
cashRegisterRouter.get(
  '/',
  validate(listRegisterQuerySchema, 'query'),
  asyncHandler(controller.list),
);
cashRegisterRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
cashRegisterRouter.post(
  '/:id/close',
  validate(uuidParamSchema, 'params'),
  validate(closeRegisterSchema),
  asyncHandler(controller.close),
);

cashRegisterRouter.post(
  '/:id/cash-movements',
  validate(uuidParamSchema, 'params'),
  validate(createCashMovementSchema),
  asyncHandler(controller.addCashMovement),
);
cashRegisterRouter.get(
  '/:id/cash-movements',
  validate(uuidParamSchema, 'params'),
  validate(listCashMovementQuerySchema, 'query'),
  asyncHandler(controller.listCashMovements),
);
