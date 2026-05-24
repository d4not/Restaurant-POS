import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { asyncHandler } from '../../lib/async-handler.js';
import { uuidParamSchema } from '../../lib/schemas.js';
import * as controller from './controller.js';
import {
  closeDailyReportSchema,
  listDailyReportQuerySchema,
} from './schema.js';

export const dailyReportRouter = Router();

dailyReportRouter.use(requireAuth);

// Close today's day. Static path comes before the /:id detail so Express
// resolves "close" as the literal action rather than treating it as a uuid.
dailyReportRouter.post(
  '/close',
  requireRole('ADMIN', 'MANAGER'),
  validate(closeDailyReportSchema),
  asyncHandler(controller.close),
);

dailyReportRouter.get(
  '/',
  requireRole('ADMIN', 'MANAGER'),
  validate(listDailyReportQuerySchema, 'query'),
  asyncHandler(controller.list),
);

dailyReportRouter.get(
  '/:id',
  requireRole('ADMIN', 'MANAGER'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.getById),
);

// Self-contained printable HTML for the report. Returns text/html so the
// browser renders it directly when opened in a new tab; the embedded CSS
// drives @media print so a Print Report button can call window.print().
dailyReportRouter.get(
  '/:id/print',
  requireRole('ADMIN', 'MANAGER'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.printReport),
);

// Reopen a closed DailyReport. Unlinks shifts and deletes the row so the
// day can be edited and re-closed (which will produce a fresh folio).
dailyReportRouter.post(
  '/:id/reopen',
  requireRole('ADMIN', 'MANAGER'),
  validate(uuidParamSchema, 'params'),
  asyncHandler(controller.reopen),
);
