import type { Request, Response } from 'express';
import * as service from './service.js';
import type { UpdateLanguageInput, UpdateSettingsInput } from './schema.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const settings = await service.getAllSettings();
  res.json({ success: true, data: settings });
}

export async function update(req: Request, res: Response): Promise<void> {
  const settings = await service.updateSettings(req.body as UpdateSettingsInput);
  res.json({ success: true, data: settings });
}

export async function getLanguage(_req: Request, res: Response): Promise<void> {
  const value = await service.getLanguage();
  res.json({ success: true, data: { value } });
}

export async function setLanguage(req: Request, res: Response): Promise<void> {
  const { value } = req.body as UpdateLanguageInput;
  const saved = await service.setLanguage(value);
  res.json({ success: true, data: { value: saved } });
}
