import { Router } from 'express';
import { z } from 'zod';
import { UserRole } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  addPurchaseItemSchema,
  cancelSchema,
  createPurchaseSchema,
  dispatchSchema,
  inTransitSchema,
  listPurchaseQuerySchema,
  payPurchaseSchema,
  receiveSchema,
  replyPurchaseSchema,
  returnSchema,
  updatePurchaseItemSchema,
  updatePurchaseSchema,
  verifySchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

// Floor staff can read but never write purchases — money + supplier
// relationships are cashier+ territory.
const CASHIER_PLUS = [UserRole.CASHIER, UserRole.MANAGER, UserRole.ADMIN] as const;
const MANAGER_PLUS = [UserRole.MANAGER, UserRole.ADMIN] as const;

export const purchaseRouter = Router();

purchaseRouter.use(requireAuth);

// ─── CRUD on the draft ──────────────────────────────────────────────────────

purchaseRouter.post(
  '/',
  requireRole(...CASHIER_PLUS),
  validate(createPurchaseSchema),
  asyncHandler(controller.create),
);
purchaseRouter.get(
  '/',
  validate(listPurchaseQuerySchema, 'query'),
  asyncHandler(controller.list),
);
purchaseRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
purchaseRouter.patch(
  '/:id',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(updatePurchaseSchema),
  asyncHandler(controller.update),
);
purchaseRouter.delete(
  '/:id',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

// ─── DELIVERY lifecycle ─────────────────────────────────────────────────────

purchaseRouter.post(
  '/:id/send',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.send),
);
purchaseRouter.post(
  '/:id/reply',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(replyPurchaseSchema),
  asyncHandler(controller.reply),
);
purchaseRouter.post(
  '/:id/pay',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(payPurchaseSchema),
  asyncHandler(controller.pay),
);
purchaseRouter.post(
  '/:id/in-transit',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(inTransitSchema),
  asyncHandler(controller.inTransit),
);
purchaseRouter.post(
  '/:id/receive',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(receiveSchema),
  asyncHandler(controller.receive),
);

// ─── ERRAND lifecycle ───────────────────────────────────────────────────────

purchaseRouter.post(
  '/:id/dispatch',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(dispatchSchema),
  asyncHandler(controller.dispatch),
);
purchaseRouter.post(
  '/:id/return',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(returnSchema),
  asyncHandler(controller.ret),
);

// ─── Terminal states ────────────────────────────────────────────────────────

purchaseRouter.post(
  '/:id/verify',
  requireRole(...MANAGER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(verifySchema),
  asyncHandler(controller.verify),
);
purchaseRouter.post(
  '/:id/reject',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(cancelSchema),
  asyncHandler(controller.reject),
);
purchaseRouter.post(
  '/:id/cancel',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  // cancelSchema requires a reason — but the legacy admin "cancel" button
  // already shipped without one. Accept either a body with `cancel_reason`
  // or an empty body; the service will store null in the empty case.
  asyncHandler(controller.cancel),
);

// ─── Legacy alias — DRAFT → VERIFIED (received = ordered) ───────────────────

purchaseRouter.post(
  '/:id/confirm',
  requireRole(...MANAGER_PLUS),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.confirm),
);

// ─── Items CRUD (DRAFT only) ────────────────────────────────────────────────

purchaseRouter.post(
  '/:id/items',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  validate(addPurchaseItemSchema),
  asyncHandler(controller.addItem),
);
purchaseRouter.patch(
  '/:id/items/:itemId',
  requireRole(...CASHIER_PLUS),
  validate(itemParamSchema, 'params'),
  validate(updatePurchaseItemSchema),
  asyncHandler(controller.updateItem),
);
purchaseRouter.delete(
  '/:id/items/:itemId',
  requireRole(...CASHIER_PLUS),
  validate(itemParamSchema, 'params'),
  asyncHandler(controller.removeItem),
);

// ─── WhatsApp deep link builder ─────────────────────────────────────────────

purchaseRouter.get(
  '/:id/whatsapp',
  requireRole(...CASHIER_PLUS),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.whatsapp),
);
