import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateStorageInput,
  UpdateStorageInput,
  ListStorageQuery,
  StorageStockQuery,
  UpdateStorageStockInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const storage = await service.createStorage(req.body as CreateStorageInput);
  res.status(201).json({ success: true, data: storage });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listStorages(req.query as unknown as ListStorageQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const storage = await service.getStorage(req.params.id as string);
  res.json({ success: true, data: storage });
}

export async function update(req: Request, res: Response): Promise<void> {
  const storage = await service.updateStorage(
    req.params.id as string,
    req.body as UpdateStorageInput,
  );
  res.json({ success: true, data: storage });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteStorage(req.params.id as string);
  res.status(204).send();
}

export async function listStocks(req: Request, res: Response): Promise<void> {
  const page = await service.listStorageStocks(
    req.params.id as string,
    req.query as unknown as StorageStockQuery,
  );
  res.json({ success: true, data: page });
}

export async function updateStock(req: Request, res: Response): Promise<void> {
  const stock = await service.updateStorageStock(
    req.params.id as string,
    req.params.supplyId as string,
    req.body as UpdateStorageStockInput,
  );
  res.json({ success: true, data: stock });
}
