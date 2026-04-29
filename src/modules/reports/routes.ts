import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import {
  dailySummaryQuerySchema,
  productAnalysisQuerySchema,
  productCostsQuerySchema,
  productsSoldQuerySchema,
  supplyMovementsQuerySchema,
  varianceQuerySchema,
} from './schema.js';

export const reportRouter = Router();

reportRouter.use(requireAuth);

// Reports expose revenue and cash totals — gated to cashier+ in line with
// PERMISSIONS.md. Floor staff don't see register money figures.
const CASHIER_ROLES = requireRole('CASHIER', 'MANAGER', 'ADMIN');

reportRouter.get(
  '/variance',
  validate(varianceQuerySchema, 'query'),
  asyncHandler(controller.variance),
);

reportRouter.get(
  '/supply-movements',
  validate(supplyMovementsQuerySchema, 'query'),
  asyncHandler(controller.supplyMovements),
);

reportRouter.get(
  '/product-costs',
  validate(productCostsQuerySchema, 'query'),
  asyncHandler(controller.productCosts),
);

reportRouter.get(
  '/product-analysis',
  validate(productAnalysisQuerySchema, 'query'),
  asyncHandler(controller.productAnalysis),
);

reportRouter.get(
  '/products-sold',
  validate(productsSoldQuerySchema, 'query'),
  asyncHandler(controller.productsSold),
);

reportRouter.get(
  '/daily-summary',
  CASHIER_ROLES,
  validate(dailySummaryQuerySchema, 'query'),
  asyncHandler(controller.dailySummary),
);
