import type { Request, Response } from 'express';
import * as service from './service.js';
import type { CreatePrinterInput, UpdatePrinterInput } from './schema.js';
import { probePrinter } from '../print/printer.js';

function id(req: Request): string {
  return req.params.id as string;
}

export async function list(_req: Request, res: Response): Promise<void> {
  const printers = await service.listPrinters();
  res.json({ success: true, data: printers });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const printer = await service.getPrinter(id(req));
  res.json({ success: true, data: printer });
}

export async function create(req: Request, res: Response): Promise<void> {
  const printer = await service.createPrinter(req.body as CreatePrinterInput);
  res.status(201).json({ success: true, data: printer });
}

export async function update(req: Request, res: Response): Promise<void> {
  const printer = await service.updatePrinter(id(req), req.body as UpdatePrinterInput);
  res.json({ success: true, data: printer });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deletePrinter(id(req));
  res.status(204).send();
}

export async function getStatus(_req: Request, res: Response): Promise<void> {
  const printers = await service.listPrinters();
  const result: Record<string, boolean> = {};
  await Promise.all(
    printers.map(async (p) => {
      if (!p.address) {
        result[p.id] = false;
        return;
      }
      const [ip, portStr] = p.address.split(':');
      const port = Number(portStr) || 9100;
      const width = p.paper_width === 32 ? 58 : p.paper_width === 42 ? 76 : 80;
      result[p.id] = await probePrinter({ ip, port, width });
    }),
  );
  res.json({ success: true, data: result });
}
