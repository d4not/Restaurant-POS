import { Router } from 'express';
import { z } from 'zod';
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
  updateCashMovementSchema,
  verifyProvisionalSchema,
} from './schema.js';

const cashMovementParamSchema = z.object({
  id: z.string().uuid(),
  movementId: z.string().uuid(),
});

export const cashRegisterRouter = Router();

cashRegisterRouter.use(requireAuth);

// Singleton lookup — returns the (single) currently-open shift or null. Open
// to all roles because the terminal gates the UI on this for every user.
cashRegisterRouter.get('/current', asyncHandler(controller.current));

// Opening a shift is open to ANY active user. When the opener is not a
// cashier+, the service flips is_provisional=true so cash movements are
// blocked until a cashier verifies. The role check used to live here;
// keeping the door open is what makes the provisional flow possible.
cashRegisterRouter.post(
  '/',
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

// Closing requires cashier+. The service layer also enforces this so the
// role check is belt-and-suspenders.
cashRegisterRouter.post(
  '/:id/close',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  validate(closeRegisterSchema),
  asyncHandler(controller.close),
);

// Cashier+ verifies a provisional shift opened by floor staff. Counts the
// drawer, the diff lands on the register, is_provisional flips to false,
// and the SAME register continues for the rest of the shift.
cashRegisterRouter.post(
  '/:id/verify-provisional',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  validate(verifyProvisionalSchema),
  asyncHandler(controller.verifyProvisional),
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

// Admin-grade edits — cashier+ can adjust or remove a movement on either an
// OPEN or CLOSED shift. The service refuses if the day's DailyReport is
// CLOSED. Recomputes expected_amount, difference, and the ShiftReport
// snapshot's cash totals on every write.
cashRegisterRouter.patch(
  '/:id/cash-movements/:movementId',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(cashMovementParamSchema, 'params'),
  validate(updateCashMovementSchema),
  asyncHandler(controller.updateCashMovement),
);
cashRegisterRouter.delete(
  '/:id/cash-movements/:movementId',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(cashMovementParamSchema, 'params'),
  asyncHandler(controller.deleteCashMovement),
);
