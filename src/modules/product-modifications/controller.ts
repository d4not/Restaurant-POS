import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateProductModificationInput,
  UpdateProductModificationInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const mod = await service.createModification(
    req.params.id as string,
    req.body as CreateProductModificationInput,
  );
  res.status(201).json({ success: true, data: mod });
}

export async function list(req: Request, res: Response): Promise<void> {
  const mods = await service.listModifications(req.params.id as string);
  res.json({ success: true, data: mods });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const mod = await service.getModification(
    req.params.id as string,
    req.params.modificationId as string,
  );
  res.json({ success: true, data: mod });
}

export async function update(req: Request, res: Response): Promise<void> {
  const mod = await service.updateModification(
    req.params.id as string,
    req.params.modificationId as string,
    req.body as UpdateProductModificationInput,
  );
  res.json({ success: true, data: mod });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteModification(
    req.params.id as string,
    req.params.modificationId as string,
  );
  res.status(204).send();
}
