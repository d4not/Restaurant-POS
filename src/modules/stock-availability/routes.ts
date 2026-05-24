import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import * as controller from './controller.js';
import { availabilityQuerySchema } from './schema.js';

export const stockAvailabilityRouter = Router();

stockAvailabilityRouter.use(requireAuth);

// Bulk availability — drives the terminal product grid + modifier picker. Open
// to any signed-in user since the floor staff need it on every order. Cashier+
// can read it via the admin bell too.
stockAvailabilityRouter.get(
  '/availability',
  validate(availabilityQuerySchema, 'query'),
  asyncHandler(controller.getAvailability),
);
