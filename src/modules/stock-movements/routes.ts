import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { listStockMovementQuerySchema } from './schema.js';

export const stockMovementRouter = Router();

stockMovementRouter.use(requireAuth);

stockMovementRouter.get(
  '/',
  validate(listStockMovementQuerySchema, 'query'),
  asyncHandler(controller.list),
);
stockMovementRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
