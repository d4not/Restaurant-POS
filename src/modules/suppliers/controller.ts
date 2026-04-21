import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  ListSupplierQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const supplier = await service.createSupplier(req.body as CreateSupplierInput);
  res.status(201).json({ success: true, data: supplier });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listSuppliers(req.query as unknown as ListSupplierQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const supplier = await service.getSupplier(req.params.id as string);
  res.json({ success: true, data: supplier });
}

export async function update(req: Request, res: Response): Promise<void> {
  const supplier = await service.updateSupplier(
    req.params.id as string,
    req.body as UpdateSupplierInput,
  );
  res.json({ success: true, data: supplier });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteSupplier(req.params.id as string);
  res.status(204).send();
}
