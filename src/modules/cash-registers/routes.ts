import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
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

// Opening, closing, and moving cash are cashier/admin-only — waiters and
// baristas can still read register state (their orders need an open register)
// but not mutate it.
cashRegisterRouter.post(
  '/',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(openRegisterSchema),
  asyncHandler(controller.open),
);
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
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  validate(closeRegisterSchema),
  asyncHandler(controller.close),
);

cashRegisterRouter.post(
  '/:id/cash-movements',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
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
