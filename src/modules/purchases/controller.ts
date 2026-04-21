import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  AddPurchaseItemInput,
  UpdatePurchaseItemInput,
  ListPurchaseQuery,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

export async function create(req: Request, res: Response): Promise<void> {
  const purchase = await service.createPurchase(
    currentUserId(req),
    req.body as CreatePurchaseInput,
  );
  res.status(201).json({ success: true, data: purchase });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listPurchases(req.query as unknown as ListPurchaseQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const purchase = await service.getPurchase(req.params.id as string);
  res.json({ success: true, data: purchase });
}

export async function update(req: Request, res: Response): Promise<void> {
  const purchase = await service.updatePurchase(
    req.params.id as string,
    req.body as UpdatePurchaseInput,
  );
  res.json({ success: true, data: purchase });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deletePurchase(req.params.id as string);
  res.status(204).send();
}

export async function confirm(req: Request, res: Response): Promise<void> {
  const purchase = await service.confirmPurchase(req.params.id as string);
  res.json({ success: true, data: purchase });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const purchase = await service.cancelPurchase(req.params.id as string);
  res.json({ success: true, data: purchase });
}

export async function addItem(req: Request, res: Response): Promise<void> {
  const item = await service.addPurchaseItem(
    req.params.id as string,
    req.body as AddPurchaseItemInput,
  );
  res.status(201).json({ success: true, data: item });
}

export async function updateItem(req: Request, res: Response): Promise<void> {
  const item = await service.updatePurchaseItem(
    req.params.id as string,
    req.params.itemId as string,
    req.body as UpdatePurchaseItemInput,
  );
  res.json({ success: true, data: item });
}

export async function removeItem(req: Request, res: Response): Promise<void> {
  await service.removePurchaseItem(
    req.params.id as string,
    req.params.itemId as string,
  );
  res.status(204).send();
}
