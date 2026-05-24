import type { Request, Response } from 'express';
import * as service from './service.js';
import type { ReplaceWeekInput, UpsertDayInput } from './schema.js';

export async function listRoster(_req: Request, res: Response): Promise<void> {
  const roster = await service.listRoster();
  res.json({ success: true, data: roster });
}

export async function getForUser(req: Request, res: Response): Promise<void> {
  const userId = (req.params as { userId: string }).userId;
  const week = await service.getWeeklySchedule(userId);
  res.json({ success: true, data: week });
}

export async function replaceForUser(req: Request, res: Response): Promise<void> {
  const userId = (req.params as { userId: string }).userId;
  const week = await service.replaceWeeklySchedule(userId, req.body as ReplaceWeekInput);
  res.json({ success: true, data: week });
}

export async function upsertDay(req: Request, res: Response): Promise<void> {
  const { userId, dayOfWeek } = req.params as unknown as {
    userId: string;
    dayOfWeek: number;
  };
  const slot = await service.upsertDay(userId, dayOfWeek, req.body as UpsertDayInput);
  res.json({ success: true, data: slot });
}

export async function clearDay(req: Request, res: Response): Promise<void> {
  const { userId, dayOfWeek } = req.params as unknown as {
    userId: string;
    dayOfWeek: number;
  };
  await service.clearDay(userId, dayOfWeek);
  res.status(204).send();
}
