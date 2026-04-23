import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { updateSettingsSchema } from './schema.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/', asyncHandler(controller.list));
settingsRouter.patch(
  '/',
  validate(updateSettingsSchema),
  asyncHandler(controller.update),
);
