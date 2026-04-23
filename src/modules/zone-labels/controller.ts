import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateZoneLabelInput,
  ListZoneLabelQuery,
  UpdateZoneLabelInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const label = await service.createZoneLabel(req.body as CreateZoneLabelInput);
  res.status(201).json({ success: true, data: label });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listZoneLabels(req.query as unknown as ListZoneLabelQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const label = await service.getZoneLabel(req.params.id as string);
  res.json({ success: true, data: label });
}

export async function update(req: Request, res: Response): Promise<void> {
  const label = await service.updateZoneLabel(
    req.params.id as string,
    req.body as UpdateZoneLabelInput,
  );
  res.json({ success: true, data: label });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteZoneLabel(req.params.id as string);
  res.status(204).send();
}
