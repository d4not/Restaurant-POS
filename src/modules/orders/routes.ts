import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  addOrderItemSchema,
  cancelOrderSchema,
  createOrderSchema,
  createPaymentSchema,
  listOrderQuerySchema,
  removeOrderItemSchema,
  requestAttentionSchema,
  restoreOrderItemSchema,
  updateOrderItemSchema,
  updateOrderSchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

// Roles that CAN build / modify a ticket (but not necessarily cash it out).
// BARISTA shares the WAITER permission set — both can build tickets, send to
// kitchen, and cancel/edit unsent lines, but neither can take payment.
const ORDER_WRITERS = requireRole('WAITER', 'BARISTA', 'CASHIER', 'MANAGER', 'ADMIN');

// Cashier-grade actions: delete items, cancel, payment, clear-attention,
// discount. Manager + Admin share this ring.
const CASHIER_ACTIONS = requireRole('CASHIER', 'MANAGER', 'ADMIN');

export const orderRouter = Router();

orderRouter.use(requireAuth);

// Static paths must precede the `/:id` parameterized route so Express doesn't
// try to parse "active" as a UUID.
orderRouter.get('/active', asyncHandler(controller.active));

orderRouter.post(
  '/',
  ORDER_WRITERS,
  validate(createOrderSchema),
  asyncHandler(controller.create),
);
orderRouter.get('/', validate(listOrderQuerySchema, 'query'), asyncHandler(controller.list));
orderRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
orderRouter.patch(
  '/:id',
  ORDER_WRITERS,
  validate(uuidParamSchema, 'params'),
  validate(updateOrderSchema),
  asyncHandler(controller.update),
);
// Cancel is open to anyone who can write to a ticket — the service layer
// imposes cashier-PIN + reason ONLY when at least one line has been sent to
// the kitchen. That keeps the cheap "waiter cancels an empty mistake order"
// path frictionless without weakening the gate on real voids.
orderRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  ORDER_WRITERS,
  validate(cancelOrderSchema),
  asyncHandler(controller.cancel),
);

orderRouter.post(
  '/:id/items',
  ORDER_WRITERS,
  validate(uuidParamSchema, 'params'),
  validate(addOrderItemSchema),
  asyncHandler(controller.addItem),
);
orderRouter.patch(
  '/:id/items/:itemId',
  ORDER_WRITERS,
  validate(itemParamSchema, 'params'),
  validate(updateOrderItemSchema),
  asyncHandler(controller.updateItem),
);
// Remove-item is also delegated to the service: waiter can wipe an unsent
// line, but the service re-checks sent_to_kitchen and demands cashier PIN
// when needed, so the route stays open to ORDER_WRITERS. Sent items are
// soft-deleted (voided); unsent items are hard-deleted.
orderRouter.delete(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  ORDER_WRITERS,
  validate(removeOrderItemSchema),
  asyncHandler(controller.removeItem),
);

// Restore = un-void a previously soft-deleted line. Always cashier+ since
// the original void was a privileged action.
orderRouter.post(
  '/:id/items/:itemId/restore',
  validate(itemParamSchema, 'params'),
  ORDER_WRITERS,
  validate(restoreOrderItemSchema),
  asyncHandler(controller.restoreItem),
);

orderRouter.post(
  '/:id/payments',
  validate(uuidParamSchema, 'params'),
  validate(createPaymentSchema),
  CASHIER_ACTIONS,
  asyncHandler(controller.addPayment),
);

orderRouter.post(
  '/:id/send-to-kitchen',
  ORDER_WRITERS,
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.sendToKitchen),
);

// Waiter → Cashier signalling. Anyone who can touch an order can raise a flag;
// only cashier+ can clear it.
orderRouter.post(
  '/:id/request-attention',
  ORDER_WRITERS,
  validate(uuidParamSchema, 'params'),
  validate(requestAttentionSchema),
  asyncHandler(controller.flagAttention),
);
orderRouter.delete(
  '/:id/request-attention',
  CASHIER_ACTIONS,
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.clearAttention),
);

orderRouter.get(
  '/:id/ingredients',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.ingredients),
);
