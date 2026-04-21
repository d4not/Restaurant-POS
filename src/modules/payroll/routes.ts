import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  generatePayrollSchema,
  listPayrollQuerySchema,
  updatePayrollSchema,
} from './schema.js';

export const payrollRouter = Router();

payrollRouter.use(requireAuth);

payrollRouter.post('/generate', validate(generatePayrollSchema), asyncHandler(controller.generate));
payrollRouter.get('/', validate(listPayrollQuerySchema, 'query'), asyncHandler(controller.list));
payrollRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
payrollRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updatePayrollSchema),
  asyncHandler(controller.update),
);
