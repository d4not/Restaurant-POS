import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreatePackagingInput,
  UpdatePackagingInput,
  ListPackagingQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const row = await service.createPackaging(req.body as CreatePackagingInput);
  res.status(201).json({ success: true, data: row });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listPackagings(req.query as unknown as ListPackagingQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const row = await service.getPackaging(req.params.id as string);
  res.json({ success: true, data: row });
}

export async function update(req: Request, res: Response): Promise<void> {
  const row = await service.updatePackaging(
    req.params.id as string,
    req.body as UpdatePackagingInput,
  );
  res.json({ success: true, data: row });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deletePackaging(req.params.id as string);
  res.status(204).send();
}
