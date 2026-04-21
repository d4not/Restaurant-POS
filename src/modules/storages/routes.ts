import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createStorageSchema,
  updateStorageSchema,
  listStorageQuerySchema,
  storageStockQuerySchema,
  updateStorageStockSchema,
} from './schema.js';

const storageStockParams = z.object({
  id: z.string().uuid(),
  supplyId: z.string().uuid(),
});

export const storageRouter = Router();

storageRouter.use(requireAuth);

storageRouter.post('/', validate(createStorageSchema), asyncHandler(controller.create));
storageRouter.get('/', validate(listStorageQuerySchema, 'query'), asyncHandler(controller.list));
storageRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
storageRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateStorageSchema),
  asyncHandler(controller.update),
);
storageRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

storageRouter.get(
  '/:id/stocks',
  validate(uuidParamSchema, 'params'),
  validate(storageStockQuerySchema, 'query'),
  asyncHandler(controller.listStocks),
);
storageRouter.patch(
  '/:id/stocks/:supplyId',
  validate(storageStockParams, 'params'),
  validate(updateStorageStockSchema),
  asyncHandler(controller.updateStock),
);
