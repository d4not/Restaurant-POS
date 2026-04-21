import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  addOrderItemSchema,
  createOrderSchema,
  createPaymentSchema,
  listOrderQuerySchema,
  updateOrderItemSchema,
  updateOrderSchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

export const orderRouter = Router();

orderRouter.use(requireAuth);

orderRouter.post('/', validate(createOrderSchema), asyncHandler(controller.create));
orderRouter.get('/', validate(listOrderQuerySchema, 'query'), asyncHandler(controller.list));
orderRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
orderRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateOrderSchema),
  asyncHandler(controller.update),
);
orderRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.cancel),
);

orderRouter.post(
  '/:id/items',
  validate(uuidParamSchema, 'params'),
  validate(addOrderItemSchema),
  asyncHandler(controller.addItem),
);
orderRouter.patch(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  validate(updateOrderItemSchema),
  asyncHandler(controller.updateItem),
);
orderRouter.delete(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  asyncHandler(controller.removeItem),
);

orderRouter.post(
  '/:id/payments',
  validate(uuidParamSchema, 'params'),
  validate(createPaymentSchema),
  asyncHandler(controller.addPayment),
);

orderRouter.get(
  '/:id/ingredients',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.ingredients),
);
