import type { Request, Response } from 'express';
import * as service from './service.js';
import type { PrintOrderInput, ScanPrintersInput, TestPrintInput } from './schema.js';

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

export async function diagnose(_req: Request, res: Response): Promise<void> {
  const result = await service.getPrinterDiagnostics();
  res.json({ success: true, data: result });
}

export async function scan(req: Request, res: Response): Promise<void> {
  const body = req.body as ScanPrintersInput;
  const result = await service.discoverPrinters({
    subnet: body.subnet,
    port: body.port,
    timeoutMs: body.timeout_ms,
  });
  res.json({ success: true, data: result });
}

export async function test(req: Request, res: Response): Promise<void> {
  const { role } = req.body as TestPrintInput;
  const result = await service.testPrint(role);
  res.json({ success: true, data: result });
}
