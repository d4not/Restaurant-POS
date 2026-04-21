import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createPackagingSchema,
  updatePackagingSchema,
  listPackagingQuerySchema,
} from './schema.js';

export const purchasePackagingRouter = Router();

purchasePackagingRouter.use(requireAuth);

purchasePackagingRouter.post(
  '/',
  validate(createPackagingSchema),
  asyncHandler(controller.create),
);
purchasePackagingRouter.get(
  '/',
  validate(listPackagingQuerySchema, 'query'),
  asyncHandler(controller.list),
);
purchasePackagingRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
purchasePackagingRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updatePackagingSchema),
  asyncHandler(controller.update),
);
purchasePackagingRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
