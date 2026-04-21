import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import {
  productAnalysisQuerySchema,
  productCostsQuerySchema,
  supplyMovementsQuerySchema,
  varianceQuerySchema,
} from './schema.js';

export const reportRouter = Router();

reportRouter.use(requireAuth);

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
