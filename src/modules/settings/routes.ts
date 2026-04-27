import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { updateLanguageSchema, updateSettingsSchema } from './schema.js';

export const settingsRouter = Router();

settingsRouter.use(requireAuth);

settingsRouter.get('/language', asyncHandler(controller.getLanguage));
settingsRouter.patch(
  '/language',
  validate(updateLanguageSchema),
  asyncHandler(controller.setLanguage),
);

settingsRouter.get('/', asyncHandler(controller.list));
settingsRouter.patch(
  '/',
  validate(updateSettingsSchema),
  asyncHandler(controller.update),
);
