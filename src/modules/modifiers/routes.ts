import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  createModifierGroupSchema,
  updateModifierGroupSchema,
  listModifierGroupQuerySchema,
  createModifierSchema,
  updateModifierSchema,
  listModifierQuerySchema,
} from './schema.js';

const modifierParamSchema = z.object({
  id: z.string().uuid(),
  modifierId: z.string().uuid(),
});

export const modifierGroupRouter = Router();

modifierGroupRouter.use(requireAuth);

modifierGroupRouter.post(
  '/',
  validate(createModifierGroupSchema),
  asyncHandler(controller.createGroup),
);
modifierGroupRouter.get(
  '/',
  validate(listModifierGroupQuerySchema, 'query'),
  asyncHandler(controller.listGroups),
);
modifierGroupRouter.get(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getGroup),
);
modifierGroupRouter.patch(
  '/:id',
  validate(uuidParamSchema, 'params'),
  validate(updateModifierGroupSchema),
  asyncHandler(controller.updateGroup),
);
modifierGroupRouter.delete(
  '/:id',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.removeGroup),
);

modifierGroupRouter.get(
  '/:id/products',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listLinkedProducts),
);
modifierGroupRouter.get(
  '/:id/overrides',
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.listOverrides),
);

modifierGroupRouter.post(
  '/:id/modifiers',
  validate(uuidParamSchema, 'params'),
  validate(createModifierSchema),
  asyncHandler(controller.createModifier),
);
modifierGroupRouter.get(
  '/:id/modifiers',
  validate(uuidParamSchema, 'params'),
  validate(listModifierQuerySchema, 'query'),
  asyncHandler(controller.listModifiers),
);
modifierGroupRouter.get(
  '/:id/modifiers/:modifierId',
  validate(modifierParamSchema, 'params'),
  asyncHandler(controller.getModifier),
);
modifierGroupRouter.patch(
  '/:id/modifiers/:modifierId',
  validate(modifierParamSchema, 'params'),
  validate(updateModifierSchema),
  asyncHandler(controller.updateModifier),
);
modifierGroupRouter.delete(
  '/:id/modifiers/:modifierId',
  validate(modifierParamSchema, 'params'),
  asyncHandler(controller.removeModifier),
);
