import type { Request, Response } from 'express';
import * as service from './service.js';
import type { CreateZoneInput, ListZoneQuery, UpdateZoneInput } from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const zone = await service.createZone(req.body as CreateZoneInput);
  res.status(201).json({ success: true, data: zone });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listZones(req.query as unknown as ListZoneQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const zone = await service.getZone(req.params.id as string);
  res.json({ success: true, data: zone });
}

export async function update(req: Request, res: Response): Promise<void> {
  const zone = await service.updateZone(
    req.params.id as string,
    req.body as UpdateZoneInput,
  );
  res.json({ success: true, data: zone });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteZone(req.params.id as string);
  res.status(204).send();
}
