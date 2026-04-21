import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { loginSchema } from './schema.js';

export const authRouter = Router();

authRouter.post(
  '/login',
  validate(loginSchema),
  asyncHandler(controller.login),
);

authRouter.get('/me', requireAuth, asyncHandler(controller.me));
