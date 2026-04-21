import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createProductModificationSchema,
  updateProductModificationSchema,
} from './schema.js';

const modificationParamSchema = z.object({
  id: z.string().uuid(),
  modificationId: z.string().uuid(),
});

// mergeParams = true so `:id` (the product id) from the parent route is visible.
export const productModificationRouter = Router({ mergeParams: true });

productModificationRouter.post(
  '/',
  validate(uuidParamSchema, 'params'),
  validate(createProductModificationSchema),
  asyncHandler(controller.create),
);

productModificationRouter.get(
  '/',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.list),
);

productModificationRouter.get(
  '/:modificationId',
  validate(modificationParamSchema, 'params'),
  asyncHandler(controller.getById),
);

productModificationRouter.patch(
  '/:modificationId',
  validate(modificationParamSchema, 'params'),
  validate(updateProductModificationSchema),
  asyncHandler(controller.update),
);

productModificationRouter.delete(
  '/:modificationId',
  validate(modificationParamSchema, 'params'),
  asyncHandler(controller.remove),
);
