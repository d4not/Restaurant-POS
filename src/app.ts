import express, { type Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { pinoHttp } from 'pino-http';
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

export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(helmet());
  app.use(cors());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(pinoHttp({ logger }));

  app.use(
    '/api/',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
    }),
  );

  app.get('/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', uptime: process.uptime() } });
  });

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

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
