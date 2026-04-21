import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createTaxSchema,
  updateTaxSchema,
  listTaxQuerySchema,
} from './schema.js';

export const taxRouter = Router();

taxRouter.use(requireAuth);

taxRouter.post('/', validate(createTaxSchema), asyncHandler(controller.create));
taxRouter.get('/', validate(listTaxQuerySchema, 'query'), asyncHandler(controller.list));
taxRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
taxRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateTaxSchema),
  asyncHandler(controller.update),
);
taxRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
