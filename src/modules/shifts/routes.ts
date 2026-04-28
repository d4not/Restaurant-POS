import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  listUnverifiedQuerySchema,
  openProvisionalShiftSchema,
  verifyShiftSchema,
} from './schema.js';

// Mounted at /api/v1/registers in app.ts BEFORE the cash-registers router so
// the provisional-shift endpoints win the path lookup. The cash-registers
// router still owns /current, /, /:id, /:id/close, and /:id/cash-movements.
export const shiftsRouter = Router();

shiftsRouter.use(requireAuth);

// POST /api/v1/registers/provisional — any authenticated user can fire this.
// The gate is on the parent shift state (validated in the service), not the
// JWT user's role.
shiftsRouter.post(
  '/provisional',
  validate(openProvisionalShiftSchema),
  asyncHandler(controller.openProvisional),
);

// GET /api/v1/registers/provisional/unverified — manager queue surface.
// Static path declared before /:id/verify so Express can disambiguate.
shiftsRouter.get(
  '/provisional/unverified',
  requireRole('MANAGER', 'ADMIN'),
  validate(listUnverifiedQuerySchema, 'query'),
  asyncHandler(controller.listUnverified),
);

// POST /api/v1/registers/:id/verify — PIN step-up. Open to any authenticated
// JWT because the PIN itself is matched against any active MANAGER/ADMIN
// inside the service (a manager walks over and types their PIN).
shiftsRouter.post(
  '/:id/verify',
  validate(uuidParamSchema, 'params'),
  validate(verifyShiftSchema),
  asyncHandler(controller.verify),
);
