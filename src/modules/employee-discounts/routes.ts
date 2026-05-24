import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createEmployeeProductSchema,
  createEmployeeSaleSchema,
  listEmployeeProductsQuerySchema,
  listEmployeeSalesQuerySchema,
  updateEmployeeProductSchema,
} from './schema.js';

export const employeeProductRouter = Router();
employeeProductRouter.use(requireAuth);

// Listing the catalogue is open to everyone authenticated so the terminal
// panel can render the cards under any role. Mutations are admin-only since
// the employee_price is a business decision, not a shift decision.
employeeProductRouter.get(
  '/',
  validate(listEmployeeProductsQuerySchema, 'query'),
  asyncHandler(controller.listProducts),
);
employeeProductRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getProduct),
);
employeeProductRouter.post(
  '/',
  requireRole('ADMIN'),
  validate(createEmployeeProductSchema),
  asyncHandler(controller.createProduct),
);
employeeProductRouter.patch(
  '/:id',
  requireRole('ADMIN'),
  validate(uuidParamSchema, 'params'),
  validate(updateEmployeeProductSchema),
  asyncHandler(controller.updateProduct),
);
employeeProductRouter.delete(
  '/:id',
  requireRole('ADMIN'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.deleteProduct),
);

export const employeeSaleRouter = Router();
employeeSaleRouter.use(requireAuth);

// Recording a perk handout is allowed for any role with money rights — the
// terminal panel surfaces the modal for cashier+ only, but a barista could
// receive a handout (different field) which the cashier records.
employeeSaleRouter.post(
  '/',
  requireRole('CASHIER', 'MANAGER', 'ADMIN'),
  validate(createEmployeeSaleSchema),
  asyncHandler(controller.createSale),
);
employeeSaleRouter.get(
  '/',
  validate(listEmployeeSalesQuerySchema, 'query'),
  asyncHandler(controller.listSales),
);
