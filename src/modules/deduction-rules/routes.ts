import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createDeductionRuleSchema,
  listDeductionRuleQuerySchema,
  updateDeductionRuleSchema,
} from './schema.js';

export const deductionRuleRouter = Router();

deductionRuleRouter.use(requireAuth);

deductionRuleRouter.post(
  '/',
  validate(createDeductionRuleSchema),
  asyncHandler(controller.create),
);
deductionRuleRouter.get(
  '/',
  validate(listDeductionRuleQuerySchema, 'query'),
  asyncHandler(controller.list),
);
deductionRuleRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
deductionRuleRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateDeductionRuleSchema),
  asyncHandler(controller.update),
);
deductionRuleRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
