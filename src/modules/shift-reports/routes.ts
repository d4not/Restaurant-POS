import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { listShiftReportQuerySchema } from './schema.js';

export const shiftReportRouter = Router();

shiftReportRouter.use(requireAuth);

// List is restricted to MANAGER/ADMIN per spec. Cashiers never browse the
// whole list — they read their own reports via the detail endpoint by id
// (the terminal links them from the closed-shift summary).
shiftReportRouter.get(
  '/',
  requireRole('MANAGER', 'ADMIN'),
  validate(listShiftReportQuerySchema, 'query'),
  asyncHandler(controller.list),
);

// Detail allows MANAGER/ADMIN unconditionally; the controller layers in the
// "or owner" rule so a CASHIER can still pull their own. The route gate keeps
// WAITER/BARISTA from poking around at all.
shiftReportRouter.get(
  '/:id',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

// Self-contained printable HTML for the mid-shift handoff (REPORTS-SPEC §5.5).
// Same role gate as the detail endpoint — the controller adds the "or owner"
// check so a cashier can print their own shift but not someone else's.
shiftReportRouter.get(
  '/:id/print',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.printReport),
);
