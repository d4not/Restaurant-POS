import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import * as suggestionController from '../order-suggestions/controller.js';
import { createOrderSuggestionValidator } from '../order-suggestions/routes.js';
import {
  addOrderItemSchema,
  cancelOrderSchema,
  createOrderSchema,
  createPaymentSchema,
  listOrderQuerySchema,
  removeOrderItemSchema,
  reopenOrderSchema,
  requestAttentionSchema,
  restoreOrderItemSchema,
  softDeleteOrderSchema,
  updateOrderItemSchema,
  updateOrderSchema,
  updatePaymentMethodSchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

const paymentParamSchema = z.object({
  id: z.string().uuid(),
  paymentId: z.string().uuid(),
});

// Roles that CAN build / modify a ticket (but not necessarily cash it out).
// BARISTA shares the WAITER permission set — both can build tickets, send to
// kitchen, and cancel/edit unsent lines, but neither can take payment.
const ORDER_WRITERS = requireRole('WAITER', 'BARISTA', 'CASHIER', 'MANAGER', 'ADMIN');

// Cashier-grade actions: delete items, cancel, payment, clear-attention,
// discount. Manager + Admin share this ring.
const CASHIER_ACTIONS = requireRole('CASHIER', 'MANAGER', 'ADMIN');

// Post-close history actions: reopen a paid ticket, soft-delete from history,
// change a recorded payment method. Cashiers cannot do these — only Managers
// and Admins. The service layer ALSO demands a manager PIN so the route gate
// is paired with a re-auth.
const MANAGER_ACTIONS = requireRole('MANAGER', 'ADMIN');

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

// Payments are open to ORDER_WRITERS at the route level so a waiter/barista can
// reach the controller during emergency-shift flows. The service layer then
// enforces: cashier+ → no PIN needed; waiter/barista → must include a valid
// cashier+ PIN, which is recorded on Payment.approved_by_user_id.
orderRouter.post(
  '/:id/payments',
  validate(uuidParamSchema, 'params'),
  validate(createPaymentSchema),
  ORDER_WRITERS,
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

// Manager-only history edits. Each carries a MANAGER PIN that the service
// layer validates via authorizeManagerPin — the route gate keeps cashiers off
// the endpoint entirely so curl probing also returns 403.
orderRouter.post(
  '/:id/reopen',
  MANAGER_ACTIONS,
  validate(uuidParamSchema, 'params'),
  validate(reopenOrderSchema),
  asyncHandler(controller.reopen),
);
orderRouter.post(
  '/:id/soft-delete',
  MANAGER_ACTIONS,
  validate(uuidParamSchema, 'params'),
  validate(softDeleteOrderSchema),
  asyncHandler(controller.softDelete),
);
orderRouter.patch(
  '/:id/payments/:paymentId/method',
  MANAGER_ACTIONS,
  validate(paymentParamSchema, 'params'),
  validate(updatePaymentMethodSchema),
  asyncHandler(controller.updatePaymentMethod),
);

// Cashier-side suggestion creation. Sits on /orders/:id/suggestions so the
// cashier can propose a reopen / delete / change-method without ever touching
// the manager-gated endpoints above. The matching approve/reject pair lives
// on /api/v1/order-suggestions/:id/* and is mounted in app.ts. Cashier+ only
// — waiters/baristas don't see Order History, so they can't reach this.
orderRouter.post(
  '/:id/suggestions',
  CASHIER_ACTIONS,
  validate(uuidParamSchema, 'params'),
  createOrderSuggestionValidator,
  asyncHandler(suggestionController.create),
);
