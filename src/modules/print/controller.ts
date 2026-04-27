import type { Request, Response } from 'express';
import * as service from './service.js';
import type { PrintOrderInput } from './schema.js';

export async function kitchen(req: Request, res: Response): Promise<void> {
  const { order_id } = req.body as PrintOrderInput;
  const result = await service.printKitchen(order_id);
  res.json({ success: true, data: result });
}

export async function receipt(req: Request, res: Response): Promise<void> {
  const { order_id } = req.body as PrintOrderInput;
  const result = await service.printReceipt(order_id);
  res.json({ success: true, data: result });
}

export async function status(_req: Request, res: Response): Promise<void> {
  const result = await service.getPrinterStatus();
  res.json({ success: true, data: result });
}
