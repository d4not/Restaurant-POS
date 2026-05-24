import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import {
  currentPoolQuerySchema,
  listPoolsQuerySchema,
  poolAndUserParamSchema,
  poolIdParamSchema,
  updateAllocationSchema,
} from './schema.js';

// Whole module is manager+ — tip allocations are a payroll decision and we
// don't want individual employees inspecting (or worse, editing) the pool.
const POOL_READERS = requireRole('MANAGER', 'ADMIN');
const POOL_WRITERS = requireRole('MANAGER', 'ADMIN');

export const tipsRouter = Router();

tipsRouter.use(requireAuth);

tipsRouter.get(
  '/pools',
  POOL_READERS,
  validate(listPoolsQuerySchema, 'query'),
  asyncHandler(controller.list),
);

tipsRouter.get(
  '/pools/current',
  POOL_READERS,
  validate(currentPoolQuerySchema, 'query'),
  asyncHandler(controller.current),
);

tipsRouter.get(
  '/pools/:id',
  POOL_READERS,
  validate(poolIdParamSchema, 'params'),
  asyncHandler(controller.getById),
);

tipsRouter.post(
  '/pools/:id/refresh',
  POOL_WRITERS,
  validate(poolIdParamSchema, 'params'),
  asyncHandler(controller.refresh),
);

tipsRouter.patch(
  '/pools/:id/allocations/:userId',
  POOL_WRITERS,
  validate(poolAndUserParamSchema, 'params'),
  validate(updateAllocationSchema),
  asyncHandler(controller.updateAllocation),
);

tipsRouter.post(
  '/pools/:id/close',
  POOL_WRITERS,
  validate(poolIdParamSchema, 'params'),
  asyncHandler(controller.close),
);

tipsRouter.post(
  '/pools/:id/reopen',
  POOL_WRITERS,
  validate(poolIdParamSchema, 'params'),
  asyncHandler(controller.reopen),
);
