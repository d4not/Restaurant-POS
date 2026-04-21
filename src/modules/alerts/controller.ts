import type { Request, Response } from 'express';
import * as service from './service.js';
import type { LowStockQuery } from './schema.js';

export async function lowStock(req: Request, res: Response): Promise<void> {
  const items = await service.listLowStock(req.query as unknown as LowStockQuery);
  res.json({ success: true, data: { items } });
}
