import type { Request, Response } from 'express';
import * as service from './service.js';
import type { ListStockMovementQuery } from './schema.js';

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listStockMovements(
    req.query as unknown as ListStockMovementQuery,
  );
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const row = await service.getStockMovement(req.params.id as string);
  res.json({ success: true, data: row });
}
