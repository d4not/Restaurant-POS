import express, { type Express } from 'express';
import cors, { type CorsOptions } from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { errorHandler, notFoundHandler } from './middleware/error-handler.js';
import { supplyCategoryRouter } from './modules/supply-categories/routes.js';
import { supplierRouter } from './modules/suppliers/routes.js';
import { storageRouter } from './modules/storages/routes.js';
import { supplyRouter } from './modules/supplies/routes.js';
import { purchasePackagingRouter } from './modules/purchase-packagings/routes.js';
import { purchaseRouter } from './modules/purchases/routes.js';
import { transferRouter } from './modules/transfers/routes.js';
import { inventoryCheckRouter } from './modules/inventory-checks/routes.js';
import { writeOffRouter } from './modules/write-offs/routes.js';
import { stockMovementRouter } from './modules/stock-movements/routes.js';
import { deductionRuleRouter } from './modules/deduction-rules/routes.js';
import { productCategoryRouter } from './modules/product-categories/routes.js';
import { productRouter } from './modules/products/routes.js';
import { modifierGroupRouter } from './modules/modifiers/routes.js';
import { recipeRouter } from './modules/recipes/routes.js';
import { alertRouter } from './modules/alerts/routes.js';
import { reportRouter } from './modules/reports/routes.js';
import { cashRegisterRouter } from './modules/cash-registers/routes.js';
import { orderRouter } from './modules/orders/routes.js';
import { authRouter } from './modules/auth/routes.js';
import { employeeRouter } from './modules/employees/routes.js';
import { attendanceRouter } from './modules/attendance/routes.js';
import { payrollRouter } from './modules/payroll/routes.js';
import { taxRouter } from './modules/taxes/routes.js';
import { settingsRouter } from './modules/settings/routes.js';
import { zoneRouter } from './modules/zones/routes.js';
import { zoneLabelRouter } from './modules/zone-labels/routes.js';
import { tableRouter } from './modules/tables/routes.js';
import { floorRouter } from './modules/floors/routes.js';
import { floorDecorRouter } from './modules/floor-decor/routes.js';
import { suggestionRouter } from './modules/suggestions/routes.js';
import { printRouter } from './modules/print/routes.js';

// Build CORS options from CORS_ORIGINS (comma-separated). Empty → reflect
// every origin, which is fine for the local-first default and for setups where
// a same-origin reverse proxy handles CORS. When set, only the listed origins
// are allowed and credentials are permitted for cookie-authenticated flows.
function buildCorsOptions(): CorsOptions {
  const raw = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
  if (raw.length === 0) return {};
  return {
    origin: raw,
    credentials: true,
  };
}

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors(buildCorsOptions()));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  // Rate limiter is skipped under NODE_ENV=test — Vitest fans out hundreds of
  // requests per suite (each test seeds purchases, opens registers, etc.) and
  // tripping 429s would just be noise. Production keeps the 300/min cap.
  if (env.NODE_ENV !== 'test') {
    app.use(
      '/api/',
      rateLimit({
        windowMs: 60_000,
        limit: 300,
        standardHeaders: 'draft-7',
        legacyHeaders: false,
      }),
    );
  }

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
  });

  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/supply-categories', supplyCategoryRouter);
  app.use('/api/v1/suppliers', supplierRouter);
  app.use('/api/v1/storages', storageRouter);
  app.use('/api/v1/supplies', supplyRouter);
  app.use('/api/v1/packagings', purchasePackagingRouter);
  app.use('/api/v1/purchases', purchaseRouter);
  app.use('/api/v1/transfers', transferRouter);
  app.use('/api/v1/inventory-checks', inventoryCheckRouter);
  app.use('/api/v1/write-offs', writeOffRouter);
  app.use('/api/v1/stock-movements', stockMovementRouter);
  app.use('/api/v1/deduction-rules', deductionRuleRouter);
  app.use('/api/v1/product-categories', productCategoryRouter);
  app.use('/api/v1/products', productRouter);
  app.use('/api/v1/modifier-groups', modifierGroupRouter);
  app.use('/api/v1/recipes', recipeRouter);
  app.use('/api/v1/alerts', alertRouter);
  app.use('/api/v1/reports', reportRouter);
  app.use('/api/v1/registers', cashRegisterRouter);
  app.use('/api/v1/orders', orderRouter);
  app.use('/api/v1/employees', employeeRouter);
  app.use('/api/v1/attendance', attendanceRouter);
  app.use('/api/v1/payroll', payrollRouter);
  app.use('/api/v1/taxes', taxRouter);
  app.use('/api/v1/settings', settingsRouter);
  app.use('/api/v1/zones', zoneRouter);
  app.use('/api/v1/zone-labels', zoneLabelRouter);
  app.use('/api/v1/tables', tableRouter);
  app.use('/api/v1/floors', floorRouter);
  app.use('/api/v1/floor-decor', floorDecorRouter);
  app.use('/api/v1/suggestions', suggestionRouter);
  app.use('/api/v1/print', printRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
