import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { createPrinterSchema, updatePrinterSchema } from './schema.js';

const MANAGER_PLUS = [UserRole.MANAGER, UserRole.ADMIN] as const;

export const printerRouter = Router();

printerRouter.use(requireAuth);

printerRouter.get('/', asyncHandler(controller.list));

printerRouter.get('/status', asyncHandler(controller.getStatus));

printerRouter.get('/:id', asyncHandler(controller.getById));

printerRouter.post(
  '/',
  requireRole(...MANAGER_PLUS),
  validate(createPrinterSchema),
  asyncHandler(controller.create),
);

printerRouter.patch(
  '/:id',
  requireRole(...MANAGER_PLUS),
  validate(updatePrinterSchema),
  asyncHandler(controller.update),
);

printerRouter.delete(
  '/:id',
  requireRole(...MANAGER_PLUS),
  asyncHandler(controller.remove),
);
