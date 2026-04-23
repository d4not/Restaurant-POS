import type { Request, Response } from 'express';
import * as service from './service.js';

export async function list(_req: Request, res: Response): Promise<void> {
  const floors = await service.getFloors();
  res.json({ success: true, data: floors });
}
