import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { createZoneSchema, listZoneQuerySchema, updateZoneSchema } from './schema.js';

export const zoneRouter = Router();

zoneRouter.use(requireAuth);

zoneRouter.post('/', validate(createZoneSchema), asyncHandler(controller.create));
zoneRouter.get('/', validate(listZoneQuerySchema, 'query'), asyncHandler(controller.list));
zoneRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
zoneRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateZoneSchema),
  asyncHandler(controller.update),
);
zoneRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
