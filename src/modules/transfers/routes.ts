import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import { createTransferSchema, listTransferQuerySchema } from './schema.js';

export const transferRouter = Router();

transferRouter.use(requireAuth);

// Transferring supplies between storages is operational rather than
// financial — anyone on shift (waiter/barista/cashier+) can move stock. The
// service layer still records who performed the move (StockMovement audit).
transferRouter.post(
  '/',
  validate(createTransferSchema),
  asyncHandler(controller.create),
);
transferRouter.get('/', validate(listTransferQuerySchema, 'query'), asyncHandler(controller.list));
transferRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
