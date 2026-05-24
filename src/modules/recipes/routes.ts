import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createRecipeSchema,
  updateRecipeSchema,
  createRecipeItemSchema,
  updateRecipeItemSchema,
} from './schema.js';

const itemParamSchema = z.object({
  id: z.string().uuid(),
  itemId: z.string().uuid(),
});

const productIdParamSchema = z.object({ productId: z.string().uuid() });
const variantIdParamSchema = z.object({ variantId: z.string().uuid() });

const ingredientsQuerySchema = z.object({
  product_id: z.string().uuid(),
  variant_id: z.string().uuid().optional(),
});

export const recipeRouter = Router();

recipeRouter.use(requireAuth);

// Returns the resolved raw-supply ingredient list for a product/variant. Used
// by the Log Waste flow to pre-fill a waste ticket. Must be declared before
// the `/:id` routes so Express doesn't treat "ingredients" as a UUID.
recipeRouter.get(
  '/ingredients',
  validate(ingredientsQuerySchema, 'query'),
  asyncHandler(controller.ingredients),
);

// Create/read by owner (product or variant). The scoped endpoints encode the
// "recipe belongs to exactly one owner" invariant in the URL.
recipeRouter.post(
  '/products/:productId',
  validate(productIdParamSchema, 'params'),
  validate(createRecipeSchema),
  asyncHandler(controller.createForProduct),
);
recipeRouter.get(
  '/products/:productId',
  validate(productIdParamSchema, 'params'),
  asyncHandler(controller.getForProduct),
);
recipeRouter.post(
  '/variants/:variantId',
  validate(variantIdParamSchema, 'params'),
  validate(createRecipeSchema),
  asyncHandler(controller.createForVariant),
);
recipeRouter.get(
  '/variants/:variantId',
  validate(variantIdParamSchema, 'params'),
  asyncHandler(controller.getForVariant),
);

// Recipe by id — for updates, deletion, and item management.
recipeRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);
recipeRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateRecipeSchema),
  asyncHandler(controller.update),
);
recipeRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);
recipeRouter.post(
  '/:id/recalculate',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.recalculate),
);

// Recipe items
recipeRouter.post(
  '/:id/items',
  validate(uuidParamSchema, 'params'),
  validate(createRecipeItemSchema),
  asyncHandler(controller.addItem),
);
recipeRouter.patch(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  validate(updateRecipeItemSchema),
  asyncHandler(controller.updateItem),
);
recipeRouter.delete(
  '/:id/items/:itemId',
  validate(itemParamSchema, 'params'),
  asyncHandler(controller.removeItem),
);
