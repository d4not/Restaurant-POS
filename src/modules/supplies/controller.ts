import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateSupplyInput,
  UpdateSupplyInput,
  ListSupplyQuery,
  SupplyStockQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const supply = await service.createSupply(req.body as CreateSupplyInput);
  res.status(201).json({ success: true, data: supply });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplies(req.query as unknown as ListSupplyQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const supply = await service.getSupply(req.params.id as string);
  res.json({ success: true, data: supply });
}

export async function update(req: Request, res: Response): Promise<void> {
  const supply = await service.updateSupply(
    req.params.id as string,
    req.body as UpdateSupplyInput,
  );
  res.json({ success: true, data: supply });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.softDeleteSupply(req.params.id as string);
  res.status(204).send();
}

export async function listStocks(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplyStocks(
    req.params.id as string,
    req.query as unknown as SupplyStockQuery,
  );
  res.json({ success: true, data: page });
}
