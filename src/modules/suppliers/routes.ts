import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createSupplierSchema,
  updateSupplierSchema,
  listSupplierQuerySchema,
} from './schema.js';

export const supplierRouter = Router();

supplierRouter.use(requireAuth);

supplierRouter.post('/', validate(createSupplierSchema), asyncHandler(controller.create));
supplierRouter.get('/', validate(listSupplierQuerySchema, 'query'), asyncHandler(controller.list));
supplierRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
supplierRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateSupplierSchema),
  asyncHandler(controller.update),
);
supplierRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
