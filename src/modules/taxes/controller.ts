import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateTaxInput,
  UpdateTaxInput,
  ListTaxQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const tax = await service.createTax(req.body as CreateTaxInput);
  res.status(201).json({ success: true, data: tax });
}

export async function list(req: Request, res: Response): Promise<void> {
  const taxes = await service.listTaxes(req.query as unknown as ListTaxQuery);
  res.json({ success: true, data: taxes });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const tax = await service.getTax(req.params.id as string);
  res.json({ success: true, data: tax });
}

export async function update(req: Request, res: Response): Promise<void> {
  const tax = await service.updateTax(
    req.params.id as string,
    req.body as UpdateTaxInput,
  );
  res.json({ success: true, data: tax });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteTax(req.params.id as string);
  res.status(204).send();
}
