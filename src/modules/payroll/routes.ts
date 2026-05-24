import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  adjustmentParamSchema,
  createAdjustmentSchema,
  generatePayrollSchema,
  listPayrollQuerySchema,
  updatePayrollSchema,
} from './schema.js';

// Reads stay open to all authenticated users — the terminal admin tile shows
// the week summary, and the cashier UI may surface a "your last payroll"
// glance. Writes (generate, status transitions, adjustments) are manager+.
const PAYROLL_WRITERS = requireRole('MANAGER', 'ADMIN');

export const payrollRouter = Router();

payrollRouter.use(requireAuth);

payrollRouter.post(
  '/generate',
  validate(generatePayrollSchema),
  PAYROLL_WRITERS,
  asyncHandler(controller.generate),
);

payrollRouter.get('/', validate(listPayrollQuerySchema, 'query'), asyncHandler(controller.list));

payrollRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));

payrollRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updatePayrollSchema),
  PAYROLL_WRITERS,
  asyncHandler(controller.update),
);

payrollRouter.post(
  '/:id/adjustments',
  validate(uuidParamSchema, 'params'),
  validate(createAdjustmentSchema),
  PAYROLL_WRITERS,
  asyncHandler(controller.addAdjustment),
);

payrollRouter.delete(
  '/:id/adjustments/:adjustmentId',
  validate(adjustmentParamSchema, 'params'),
  PAYROLL_WRITERS,
  asyncHandler(controller.removeAdjustment),
);
