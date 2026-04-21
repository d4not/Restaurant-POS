import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { upsertTareWeightSchema } from './schema.js';

// mergeParams = true so we can read `:id` (the supply id) from the parent route.
export const tareWeightRouter = Router({ mergeParams: true });

tareWeightRouter.get(
  '/',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.get),
);

tareWeightRouter.put(
  '/',
  validate(uuidParamSchema, 'params'),
  validate(upsertTareWeightSchema),
  asyncHandler(controller.upsert),
);

tareWeightRouter.delete(
  '/',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
