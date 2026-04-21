import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createProductSchema,
  updateProductSchema,
  listProductQuerySchema,
  createVariantSchema,
  updateVariantSchema,
  attachModifierGroupSchema,
} from './schema.js';
import { productModificationRouter } from '../product-modifications/routes.js';

const variantParamSchema = z.object({
  id: z.string().uuid(),
  variantId: z.string().uuid(),
});

const modifierGroupParamSchema = z.object({
  id: z.string().uuid(),
  groupId: z.string().uuid(),
});

export const productRouter = Router();

productRouter.use(requireAuth);

productRouter.post('/', validate(createProductSchema), asyncHandler(controller.create));
productRouter.get('/', validate(listProductQuerySchema, 'query'), asyncHandler(controller.list));
productRouter.get('/:id', validate(uuidParamSchema, 'params'), asyncHandler(controller.getById));
productRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateProductSchema),
  asyncHandler(controller.update),
);
productRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.remove),
);

// Variants
productRouter.post(
  '/:id/variants',
  validate(uuidParamSchema, 'params'),
  validate(createVariantSchema),
  asyncHandler(controller.createVariant),
);
productRouter.get(
  '/:id/variants',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listVariants),
);
productRouter.get(
  '/:id/variants/:variantId',
  validate(variantParamSchema, 'params'),
  asyncHandler(controller.getVariant),
);
productRouter.patch(
  '/:id/variants/:variantId',
  validate(variantParamSchema, 'params'),
  validate(updateVariantSchema),
  asyncHandler(controller.updateVariant),
);
productRouter.delete(
  '/:id/variants/:variantId',
  validate(variantParamSchema, 'params'),
  asyncHandler(controller.removeVariant),
);

// Modifier group attachment
productRouter.post(
  '/:id/modifier-groups',
  validate(uuidParamSchema, 'params'),
  validate(attachModifierGroupSchema),
  asyncHandler(controller.attachModifierGroup),
);
productRouter.get(
  '/:id/modifier-groups',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listModifierGroups),
);
productRouter.delete(
  '/:id/modifier-groups/:groupId',
  validate(modifierGroupParamSchema, 'params'),
  asyncHandler(controller.detachModifierGroup),
);

// Nested: /api/v1/products/:id/modifications
productRouter.use('/:id/modifications', productModificationRouter);
