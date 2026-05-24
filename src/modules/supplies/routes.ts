import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createSupplySchema,
  updateSupplySchema,
  listSupplyQuerySchema,
  supplyStockQuerySchema,
  barcodeParamSchema,
  externalSearchQuerySchema,
  supplyMovementsQuerySchema,
  supplyPurchaseHistoryQuerySchema,
  supplyCountVarianceQuerySchema,
  resolveDependenciesSchema,
} from './schema.js';
import { tareWeightRouter } from '../tare-weights/routes.js';

export const supplyRouter = Router();

supplyRouter.use(requireAuth);

supplyRouter.post('/', validate(createSupplySchema), asyncHandler(controller.create));
supplyRouter.get('/', validate(listSupplyQuerySchema, 'query'), asyncHandler(controller.list));
// Must come before `/:id` so the literal "barcode-lookup" segment isn't
// interpreted as a UUID id and rejected by uuidParamSchema.
supplyRouter.get(
  '/barcode-lookup/:barcode',
  validate(barcodeParamSchema, 'params'),
  asyncHandler(controller.barcodeLookup),
);
// Free-text product search via Open Food Facts. Same hoist-before-/:id rule.
supplyRouter.get(
  '/external-search',
  validate(externalSearchQuerySchema, 'query'),
  asyncHandler(controller.externalSearch),
);
supplyRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
supplyRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateSupplySchema),
  asyncHandler(controller.update),
);
supplyRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

supplyRouter.get(
  '/:id/stocks',
  validate(uuidParamSchema, 'params'),
  validate(supplyStockQuerySchema, 'query'),
  asyncHandler(controller.listStocks),
);

// Counts every downstream reference (recipes, products via recipes, modifiers,
// storages-with-stock, last movement) so the delete UI can warn the operator
// before they soft-delete a supply that other parts of the system rely on.
supplyRouter.get(
  '/:id/dependencies',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getDependencies),
);

// ─── Phase 2: per-supply analytics for the SupplyInfoView tabs ────────────
// Each route corresponds to one section on the supply detail page.

supplyRouter.get(
  '/:id/movements',
  validate(uuidParamSchema, 'params'),
  validate(supplyMovementsQuerySchema, 'query'),
  asyncHandler(controller.listMovements),
);

supplyRouter.get(
  '/:id/suppliers',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listSuppliers),
);

supplyRouter.get(
  '/:id/purchase-history',
  validate(uuidParamSchema, 'params'),
  validate(supplyPurchaseHistoryQuerySchema, 'query'),
  asyncHandler(controller.listPurchaseHistory),
);

supplyRouter.get(
  '/:id/consuming-products',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listConsumingProducts),
);

supplyRouter.get(
  '/:id/count-variance',
  validate(uuidParamSchema, 'params'),
  validate(supplyCountVarianceQuerySchema, 'query'),
  asyncHandler(controller.listCountVariance),
);

// Phase 4: cascade resolver. Applies per-RecipeItem actions (replace /
// remove_line / remove_owner), nulls out Modifier/Product/ProductModification
// references, and optionally soft-deletes the supply — all in one tx.
supplyRouter.post(
  '/:id/resolve-dependencies',
  validate(uuidParamSchema, 'params'),
  validate(resolveDependenciesSchema),
  asyncHandler(controller.resolveDependencies),
);

// Nested: /api/v1/supplies/:id/tare-weight
supplyRouter.use('/:id/tare-weight', tareWeightRouter);
