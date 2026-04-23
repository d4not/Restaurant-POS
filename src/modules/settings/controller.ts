import type { Request, Response } from 'express';
import * as service from './service.js';
import type { UpdateSettingsInput } from './schema.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const settings = await service.getAllSettings();
  res.json({ success: true, data: settings });
}

export async function update(req: Request, res: Response): Promise<void> {
  const settings = await service.updateSettings(req.body as UpdateSettingsInput);
  res.json({ success: true, data: settings });
}
