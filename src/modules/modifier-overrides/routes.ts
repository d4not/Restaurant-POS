import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createOverrideSchema,
  updateOverrideSchema,
} from './schema.js';

const overrideParamSchema = z.object({
  id: z.string().uuid(),
  modifierId: z.string().uuid(),
});

// mergeParams = true so `:id` (the product id) from the parent route is visible.
export const modifierOverrideRouter = Router({ mergeParams: true });

modifierOverrideRouter.get(
  '/',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.list),
);

modifierOverrideRouter.post(
  '/',
  validate(uuidParamSchema, 'params'),
  validate(createOverrideSchema),
  asyncHandler(controller.create),
);

modifierOverrideRouter.patch(
  '/:modifierId',
  validate(overrideParamSchema, 'params'),
  validate(updateOverrideSchema),
  asyncHandler(controller.update),
);

modifierOverrideRouter.delete(
  '/:modifierId',
  validate(overrideParamSchema, 'params'),
  asyncHandler(controller.remove),
);
