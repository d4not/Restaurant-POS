import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { printOrderSchema } from './schema.js';

export const printRouter = Router();

printRouter.use(requireAuth);

// Kitchen comanda — anyone who can write to a ticket can also fire it. Same
// permission ring as orders.send-to-kitchen since that's what we call under
// the hood (printKitchen → sendToKitchen → format → TCP send).
const ORDER_WRITERS = requireRole('WAITER', 'BARISTA', 'CASHIER', 'MANAGER', 'ADMIN');

// Receipts go to the customer at payment time — gated to cashier+ to mirror
// "process payment" permissions in PERMISSIONS.md.
const CASHIER_ACTIONS = requireRole('CASHIER', 'MANAGER', 'ADMIN');

printRouter.post(
  '/kitchen',
  ORDER_WRITERS,
  validate(printOrderSchema),
  asyncHandler(controller.kitchen),
);

printRouter.post(
  '/receipt',
  CASHIER_ACTIONS,
  validate(printOrderSchema),
  asyncHandler(controller.receipt),
);

// Status check is open to any authenticated user — the admin Settings page
// shows green/red dots in the Printers section, and anyone with terminal
// access benefits from knowing whether a print will succeed before tapping.
printRouter.get('/status', asyncHandler(controller.status));
