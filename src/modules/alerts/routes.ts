import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { lowStockQuerySchema } from './schema.js';

export const alertRouter = Router();

alertRouter.use(requireAuth);

alertRouter.get(
  '/low-stock',
  validate(lowStockQuerySchema, 'query'),
  asyncHandler(controller.lowStock),
);
