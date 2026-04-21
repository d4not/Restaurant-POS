import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createSupplyCategorySchema,
  updateSupplyCategorySchema,
  listSupplyCategoryQuerySchema,
} from './schema.js';

export const supplyCategoryRouter = Router();

supplyCategoryRouter.use(requireAuth);

supplyCategoryRouter.post(
  '/',
  validate(createSupplyCategorySchema),
  asyncHandler(controller.create),
);

supplyCategoryRouter.get(
  '/',
  validate(listSupplyCategoryQuerySchema, 'query'),
  asyncHandler(controller.list),
);

supplyCategoryRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

supplyCategoryRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateSupplyCategorySchema),
  asyncHandler(controller.update),
);

supplyCategoryRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
