import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createInventoryCheckSchema,
  listInventoryCheckQuerySchema,
  setCheckItemsSchema,
} from './schema.js';

export const inventoryCheckRouter = Router();

inventoryCheckRouter.use(requireAuth);

inventoryCheckRouter.post(
  '/',
  validate(createInventoryCheckSchema),
  asyncHandler(controller.create),
);
inventoryCheckRouter.get(
  '/',
  validate(listInventoryCheckQuerySchema, 'query'),
  asyncHandler(controller.list),
);
inventoryCheckRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
inventoryCheckRouter.patch(
  '/:id/items',
  validate(uuidParamSchema, 'params'),
  validate(setCheckItemsSchema),
  asyncHandler(controller.setItems),
);
inventoryCheckRouter.post(
  '/:id/complete',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.complete),
);
inventoryCheckRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
