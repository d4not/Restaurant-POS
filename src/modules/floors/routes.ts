import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';

export const floorRouter = Router();

floorRouter.use(requireAuth);

floorRouter.get('/', asyncHandler(controller.list));
