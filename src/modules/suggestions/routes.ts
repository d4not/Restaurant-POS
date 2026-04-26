import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createSuggestionSchema,
  listSuggestionQuerySchema,
  reviewSuggestionSchema,
} from './schema.js';

// Suggestions are written by anyone in the cashier ring (we want cashiers
// proposing layout tweaks; managers/admins typically just edit directly but
// can submit suggestions for the audit trail too). Approve/reject is admin-
// only — the whole point is one-person sign-off.
const SUGGEST_WRITERS = requireRole('CASHIER', 'MANAGER', 'ADMIN');
const SUGGEST_REVIEWERS = requireRole('ADMIN');

export const suggestionRouter = Router();

suggestionRouter.use(requireAuth);

suggestionRouter.post(
  '/',
  SUGGEST_WRITERS,
  validate(createSuggestionSchema),
  asyncHandler(controller.create),
);
suggestionRouter.get(
  '/',
  SUGGEST_REVIEWERS,
  validate(listSuggestionQuerySchema, 'query'),
  asyncHandler(controller.list),
);
suggestionRouter.get(
  '/:id',
  SUGGEST_REVIEWERS,
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
suggestionRouter.post(
  '/:id/approve',
  SUGGEST_REVIEWERS,
  validate(uuidParamSchema, 'params'),
  validate(reviewSuggestionSchema),
  asyncHandler(controller.approve),
);
suggestionRouter.post(
  '/:id/reject',
  SUGGEST_REVIEWERS,
  validate(uuidParamSchema, 'params'),
  validate(reviewSuggestionSchema),
  asyncHandler(controller.reject),
);
