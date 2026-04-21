import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  ProductCostsQuery,
  SupplyMovementsQuery,
  VarianceQuery,
} from './schema.js';

export async function variance(req: Request, res: Response): Promise<void> {
  const report = await service.getVarianceReport(req.query as unknown as VarianceQuery);
  res.json({ success: true, data: report });
}

export async function supplyMovements(req: Request, res: Response): Promise<void> {
  const report = await service.getSupplyMovementReport(
    req.query as unknown as SupplyMovementsQuery,
  );
  res.json({ success: true, data: report });
}

export async function productCosts(req: Request, res: Response): Promise<void> {
  const report = await service.getProductCostReport(req.query as unknown as ProductCostsQuery);
  res.json({ success: true, data: report });
}
