import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createZoneLabelSchema,
  listZoneLabelQuerySchema,
  updateZoneLabelSchema,
} from './schema.js';

export const zoneLabelRouter = Router();

zoneLabelRouter.use(requireAuth);

zoneLabelRouter.post('/', validate(createZoneLabelSchema), asyncHandler(controller.create));
zoneLabelRouter.get(
  '/',
  validate(listZoneLabelQuerySchema, 'query'),
  asyncHandler(controller.list),
);
zoneLabelRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
zoneLabelRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateZoneLabelSchema),
  asyncHandler(controller.update),
);
zoneLabelRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
