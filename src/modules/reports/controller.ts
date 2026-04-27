import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  DailySummaryQuery,
  ProductAnalysisQuery,
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

export async function productAnalysis(req: Request, res: Response): Promise<void> {
  const report = await service.getProductAnalysisReport(
    req.query as unknown as ProductAnalysisQuery,
  );
  res.json({ success: true, data: report });
}

export async function dailySummary(req: Request, res: Response): Promise<void> {
  const report = await service.getDailySummary(req.query as unknown as DailySummaryQuery);
  res.json({ success: true, data: report });
}
