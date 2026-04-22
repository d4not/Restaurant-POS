import type { Request, Response } from 'express';
import * as service from './service.js';
import type { CreateOverrideInput, UpdateOverrideInput } from './schema.js';

export async function list(req: Request, res: Response): Promise<void> {
  const rows = await service.listOverrides(req.params.id as string);
  res.json({ success: true, data: rows });
}

export async function create(req: Request, res: Response): Promise<void> {
  const row = await service.createOverride(
    req.params.id as string,
    req.body as CreateOverrideInput,
  );
  res.status(201).json({ success: true, data: row });
}

export async function update(req: Request, res: Response): Promise<void> {
  const row = await service.updateOverride(
    req.params.id as string,
    req.params.modifierId as string,
    req.body as UpdateOverrideInput,
  );
  res.json({ success: true, data: row });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteOverride(
    req.params.id as string,
    req.params.modifierId as string,
  );
  res.status(204).send();
}
