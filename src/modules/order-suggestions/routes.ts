import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { reviewOrderSuggestionSchema, createOrderSuggestionSchema } from './schema.js';

// Approve/reject is manager-or-admin only — the whole point is privileged
// sign-off. Backend ALSO re-validates the manager PIN inside the service.
const SUGGEST_REVIEWERS = requireRole('MANAGER', 'ADMIN');

// Manager+ list endpoint — backs the Suggested Changes admin view.
const SUGGEST_LIST_READERS = requireRole('MANAGER', 'ADMIN');

// POST /api/v1/order-suggestions/:id/approve | /reject — works on a
// suggestion id, not an order id, so the manager can act on any pending
// suggestion they find in Order History or the admin Suggested Changes view.
export const orderSuggestionReviewRouter = Router();
orderSuggestionReviewRouter.use(requireAuth);
orderSuggestionReviewRouter.get(
  '/',
  SUGGEST_LIST_READERS,
  asyncHandler(controller.list),
);
orderSuggestionReviewRouter.post(
  '/:id/approve',
  SUGGEST_REVIEWERS,
  validate(uuidParamSchema, 'params'),
  validate(reviewOrderSuggestionSchema),
  asyncHandler(controller.approve),
);
orderSuggestionReviewRouter.post(
  '/:id/reject',
  SUGGEST_REVIEWERS,
  validate(uuidParamSchema, 'params'),
  validate(reviewOrderSuggestionSchema),
  asyncHandler(controller.reject),
);

// Re-exported so orders/routes.ts can attach `POST /orders/:id/suggestions`
// inline — keeps the path next to the other order-id-scoped routes.
export const createOrderSuggestionValidator = validate(createOrderSuggestionSchema);
