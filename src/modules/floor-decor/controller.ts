import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateFloorDecorInput,
  ListFloorDecorQuery,
  UpdateFloorDecorInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const decor = await service.createFloorDecor(req.body as CreateFloorDecorInput);
  res.status(201).json({ success: true, data: decor });
}

export async function list(req: Request, res: Response): Promise<void> {
  const rows = await service.listFloorDecor(req.query as unknown as ListFloorDecorQuery);
  res.json({ success: true, data: rows });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const decor = await service.getFloorDecor(req.params.id as string);
  res.json({ success: true, data: decor });
}

export async function update(req: Request, res: Response): Promise<void> {
  const decor = await service.updateFloorDecor(
    req.params.id as string,
    req.body as UpdateFloorDecorInput,
  );
  res.json({ success: true, data: decor });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteFloorDecor(req.params.id as string);
  res.status(204).send();
}
