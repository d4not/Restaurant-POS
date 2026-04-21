import type { Request, Response } from 'express';
import * as service from './service.js';
import type { UpsertTareWeightInput } from './schema.js';

export async function get(req: Request, res: Response): Promise<void> {
  const tw = await service.getTareWeight(req.params.id as string);
  res.json({ success: true, data: tw });
}

export async function upsert(req: Request, res: Response): Promise<void> {
  const tw = await service.upsertTareWeight(
    req.params.id as string,
    req.body as UpsertTareWeightInput,
  );
  res.status(200).json({ success: true, data: tw });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteTareWeight(req.params.id as string);
  res.status(204).send();
}
