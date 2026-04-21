import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createProductCategorySchema,
  updateProductCategorySchema,
  listProductCategoryQuerySchema,
} from './schema.js';

export const productCategoryRouter = Router();

productCategoryRouter.use(requireAuth);

productCategoryRouter.post(
  '/',
  validate(createProductCategorySchema),
  asyncHandler(controller.create),
);

productCategoryRouter.get(
  '/',
  validate(listProductCategoryQuerySchema, 'query'),
  asyncHandler(controller.list),
);

productCategoryRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

productCategoryRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateProductCategorySchema),
  asyncHandler(controller.update),
);

productCategoryRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
