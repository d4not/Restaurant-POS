import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createPurchaseSchema,
  updatePurchaseSchema,
  listPurchaseQuerySchema,
  addPurchaseItemSchema,
  updatePurchaseItemSchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const purchaseRouter = Router();

purchaseRouter.use(requireAuth);

purchaseRouter.post('/', validate(createPurchaseSchema), asyncHandler(controller.create));
purchaseRouter.get('/', validate(listPurchaseQuerySchema, 'query'), asyncHandler(controller.list));
purchaseRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
purchaseRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updatePurchaseSchema),
  asyncHandler(controller.update),
);
purchaseRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

purchaseRouter.post(
  '/:id/confirm',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.confirm),
);
purchaseRouter.post(
  '/:id/cancel',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.cancel),
);

purchaseRouter.post(
  '/:id/items',
  validate(uuidParamSchema, 'params'),
  validate(addPurchaseItemSchema),
  asyncHandler(controller.addItem),
);
purchaseRouter.patch(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  validate(updatePurchaseItemSchema),
  asyncHandler(controller.updateItem),
);
purchaseRouter.delete(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  asyncHandler(controller.removeItem),
);
