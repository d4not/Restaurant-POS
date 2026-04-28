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

// Singleton lookup — returns the (single) currently-open shift or null. Open
// to all roles because the terminal gates the UI on this for every user.
cashRegisterRouter.get('/current', asyncHandler(controller.current));

// Opening a NORMAL shift requires a cashier+. The opener counts the drawer.
cashRegisterRouter.post(
  '/',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(openRegisterSchema),
  asyncHandler(controller.open),
);

// POST /provisional and POST /:id/verify are owned by the shifts router
// (mounted before this one in src/app.ts). The new contract requires a
// parent_shift_id and produces a manager-verified report-ready shift; see
// src/modules/shifts/.

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

// Closing always requires cashier+, regardless of the shift kind. The service
// layer also enforces this so the role check is belt-and-suspenders.
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
