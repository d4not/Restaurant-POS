import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createWriteOffBatchSchema,
  createWriteOffSchema,
  listWriteOffQuerySchema,
} from './schema.js';

export const writeOffRouter = Router();

writeOffRouter.use(requireAuth);

writeOffRouter.post('/', validate(createWriteOffSchema), asyncHandler(controller.create));
writeOffRouter.post(
  '/batch',
  validate(createWriteOffBatchSchema),
  asyncHandler(controller.createBatch),
);
writeOffRouter.get('/', validate(listWriteOffQuerySchema, 'query'), asyncHandler(controller.list));
writeOffRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
