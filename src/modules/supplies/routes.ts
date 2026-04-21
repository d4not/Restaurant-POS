import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createSupplySchema,
  updateSupplySchema,
  listSupplyQuerySchema,
  supplyStockQuerySchema,
} from './schema.js';
import { tareWeightRouter } from '../tare-weights/routes.js';

export const supplyRouter = Router();

supplyRouter.use(requireAuth);

supplyRouter.post('/', validate(createSupplySchema), asyncHandler(controller.create));
supplyRouter.get('/', validate(listSupplyQuerySchema, 'query'), asyncHandler(controller.list));
supplyRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
supplyRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateSupplySchema),
  asyncHandler(controller.update),
);
supplyRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

supplyRouter.get(
  '/:id/stocks',
  validate(uuidParamSchema, 'params'),
  validate(supplyStockQuerySchema, 'query'),
  asyncHandler(controller.listStocks),
);

// Nested: /api/v1/supplies/:id/tare-weight
supplyRouter.use('/:id/tare-weight', tareWeightRouter);
