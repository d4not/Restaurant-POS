import type { Request, Response } from 'express';
import * as service from './service.js';
import { lookupBarcode, searchByName } from './barcode-lookup.js';
import type {
  CreateSupplyInput,
  UpdateSupplyInput,
  ListSupplyQuery,
  SupplyStockQuery,
  ExternalSearchQuery,
  SupplyMovementsQuery,
  SupplyPurchaseHistoryQuery,
  SupplyCountVarianceQuery,
  ResolveDependenciesInput,
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

export async function getDependencies(req: Request, res: Response): Promise<void> {
  const result = await service.getSupplyDependencies(req.params.id as string);
  res.json({ success: true, data: result });
}

export async function barcodeLookup(req: Request, res: Response): Promise<void> {
  const result = await lookupBarcode(req.params.barcode as string);
  res.json({ success: true, data: result });
}

export async function externalSearch(req: Request, res: Response): Promise<void> {
  const { q, limit } = req.query as unknown as ExternalSearchQuery;
  const result = await searchByName(q, limit);
  res.json({ success: true, data: result });
}

export async function listMovements(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplyMovements(
    req.params.id as string,
    req.query as unknown as SupplyMovementsQuery,
  );
  res.json({ success: true, data: page });
}

export async function listSuppliers(req: Request, res: Response): Promise<void> {
  const result = await service.listSupplySuppliers(req.params.id as string);
  res.json({ success: true, data: result });
}

export async function listPurchaseHistory(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplyPurchaseHistory(
    req.params.id as string,
    req.query as unknown as SupplyPurchaseHistoryQuery,
  );
  res.json({ success: true, data: page });
}

export async function listConsumingProducts(req: Request, res: Response): Promise<void> {
  const result = await service.listSupplyConsumingProducts(req.params.id as string);
  res.json({ success: true, data: result });
}

export async function listCountVariance(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplyCountVariance(
    req.params.id as string,
    req.query as unknown as SupplyCountVarianceQuery,
  );
  res.json({ success: true, data: page });
}

export async function resolveDependencies(req: Request, res: Response): Promise<void> {
  const result = await service.resolveSupplyDependencies(
    req.params.id as string,
    req.body as ResolveDependenciesInput,
  );
  res.json({ success: true, data: result });
}
