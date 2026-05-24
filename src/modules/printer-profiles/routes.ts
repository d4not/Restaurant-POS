import { Router } from 'express';
import { UserRole } from '@prisma/client';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { createProfileSchema, updateProfileSchema, assignCategoriesSchema } from './schema.js';

const MANAGER_PLUS = [UserRole.MANAGER, UserRole.ADMIN] as const;
const CASHIER_PLUS = [UserRole.CASHIER, UserRole.MANAGER, UserRole.ADMIN] as const;

export const printerProfileRouter = Router();

printerProfileRouter.use(requireAuth);

printerProfileRouter.get('/', asyncHandler(controller.list));

printerProfileRouter.get('/routing-map', asyncHandler(controller.routingMap));

printerProfileRouter.get('/:id', asyncHandler(controller.getById));

printerProfileRouter.post(
  '/',
  requireRole(...MANAGER_PLUS),
  validate(createProfileSchema),
  asyncHandler(controller.create),
);

printerProfileRouter.patch(
  '/:id',
  requireRole(...MANAGER_PLUS),
  validate(updateProfileSchema),
  asyncHandler(controller.update),
);

printerProfileRouter.delete(
  '/:id',
  requireRole(...MANAGER_PLUS),
  asyncHandler(controller.remove),
);

printerProfileRouter.put(
  '/:id/categories',
  requireRole(...MANAGER_PLUS),
  validate(assignCategoriesSchema),
  asyncHandler(controller.assignCategories),
);

printerProfileRouter.post(
  '/:id/test',
  requireRole(...CASHIER_PLUS),
  asyncHandler(controller.testPrint),
);
