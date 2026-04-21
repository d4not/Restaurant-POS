import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateSupplyCategoryInput,
  UpdateSupplyCategoryInput,
  ListSupplyCategoryQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const category = await service.createSupplyCategory(req.body as CreateSupplyCategoryInput);
  res.status(201).json({ success: true, data: category });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listSupplyCategories(req.query as unknown as ListSupplyCategoryQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const category = await service.getSupplyCategory(req.params.id as string);
  res.json({ success: true, data: category });
}

export async function update(req: Request, res: Response): Promise<void> {
  const category = await service.updateSupplyCategory(
    req.params.id as string,
    req.body as UpdateSupplyCategoryInput,
  );
  res.json({ success: true, data: category });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteSupplyCategory(req.params.id as string);
  res.status(204).send();
}
