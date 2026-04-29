import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { printOrderSchema, scanPrintersSchema, testPrintSchema } from './schema.js';

export const printRouter = Router();

printRouter.use(requireAuth);

// Kitchen comanda — anyone who can write to a ticket can also fire it. Same
// permission ring as orders.send-to-kitchen since that's what we call under
// the hood (printKitchen → sendToKitchen → format → TCP send).
const ORDER_WRITERS = requireRole('WAITER', 'BARISTA', 'CASHIER', 'MANAGER', 'ADMIN');

// Receipts go to the customer at payment time — gated to cashier+ to mirror
// "process payment" permissions in PERMISSIONS.md.
const CASHIER_ACTIONS = requireRole('CASHIER', 'MANAGER', 'ADMIN');

// Network scans + test prints surface diagnostic info that's useful for
// anyone running the terminal, but only the cashier+ ring should be
// reconfiguring printers, so the test/scan endpoints are gated. Diagnose is
// a read-only enrichment of /status — open to all auth like /status itself.
const PRINTER_ADMINS = requireRole('CASHIER', 'MANAGER', 'ADMIN');

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

// Diagnose: status + remedies for each role. Used by the "Printer check"
// hub card to render actionable troubleshooting hints.
printRouter.get('/diagnose', asyncHandler(controller.diagnose));

// Scan the local subnet for ESC/POS printers. Bounded by PARALLELISM in
// discovery.ts — a /24 takes ~5s on a typical café LAN.
printRouter.post(
  '/scan',
  PRINTER_ADMINS,
  validate(scanPrintersSchema),
  asyncHandler(controller.scan),
);

// Diagnostic test print on the kitchen or receipt printer. Lets the operator
// verify physical output (paper, cut, character set) without depending on a
// real order.
printRouter.post(
  '/test',
  PRINTER_ADMINS,
  validate(testPrintSchema),
  asyncHandler(controller.test),
);

// Bundled default stylesheet for the corte-Z print template. The admin's
// Report-template editor calls this to pre-fill the CSS textarea so an
// operator can start from the default and tweak rather than editing blind.
printRouter.get(
  '/report-template/default',
  requireRole('ADMIN'),
  asyncHandler(controller.defaultTemplate),
);
