import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import { buildWhatsappLink } from './whatsapp.js';
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  AddPurchaseItemInput,
  UpdatePurchaseItemInput,
  ListPurchaseQuery,
  ReplyPurchaseInput,
  PayPurchaseInput,
  InTransitInput,
  ReceiveInput,
  VerifyInput,
  DispatchInput,
  ReturnInput,
  CancelInput,
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

// Legacy DRAFT → VERIFIED in one shot (received = ordered). Kept for the
// existing terminal AdminMode "Confirm" button and any external integrations
// while the new wizard lands. Internally identical to /verify against a
// DRAFT row with the items defaulted, so stock + WAC stay correct.
export async function confirm(req: Request, res: Response): Promise<void> {
  const purchase = await service.confirmPurchase(
    req.params.id as string,
    currentUserId(req),
  );
  res.json({ success: true, data: purchase });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const purchase = await service.cancelPurchase(
    req.params.id as string,
    currentUserId(req),
    req.body as CancelInput | undefined,
  );
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

// ─── DELIVERY transitions ───────────────────────────────────────────────────

export async function send(req: Request, res: Response): Promise<void> {
  const purchase = await service.sendPurchase(req.params.id as string);
  res.json({ success: true, data: purchase });
}

export async function reply(req: Request, res: Response): Promise<void> {
  const purchase = await service.replyPurchase(
    req.params.id as string,
    req.body as ReplyPurchaseInput,
  );
  res.json({ success: true, data: purchase });
}

export async function pay(req: Request, res: Response): Promise<void> {
  const purchase = await service.payPurchase(
    req.params.id as string,
    req.body as PayPurchaseInput,
  );
  res.json({ success: true, data: purchase });
}

export async function inTransit(req: Request, res: Response): Promise<void> {
  const purchase = await service.markInTransit(
    req.params.id as string,
    req.body as InTransitInput,
  );
  res.json({ success: true, data: purchase });
}

export async function receive(req: Request, res: Response): Promise<void> {
  const purchase = await service.receivePurchase(
    req.params.id as string,
    req.body as ReceiveInput,
  );
  res.json({ success: true, data: purchase });
}

// ─── ERRAND transitions ─────────────────────────────────────────────────────

export async function dispatch(req: Request, res: Response): Promise<void> {
  const purchase = await service.dispatchPurchase(
    req.params.id as string,
    currentUserId(req),
    req.body as DispatchInput,
  );
  res.json({ success: true, data: purchase });
}

export async function ret(req: Request, res: Response): Promise<void> {
  const purchase = await service.returnPurchase(
    req.params.id as string,
    currentUserId(req),
    req.body as ReturnInput,
  );
  res.json({ success: true, data: purchase });
}

// ─── Manager-only ───────────────────────────────────────────────────────────

export async function verify(req: Request, res: Response): Promise<void> {
  const purchase = await service.verifyPurchase(
    req.params.id as string,
    currentUserId(req),
    req.body as VerifyInput,
  );
  res.json({ success: true, data: purchase });
}

export async function reject(req: Request, res: Response): Promise<void> {
  const purchase = await service.rejectPurchase(
    req.params.id as string,
    currentUserId(req),
    req.body as CancelInput,
  );
  res.json({ success: true, data: purchase });
}

// ─── WhatsApp link builder ──────────────────────────────────────────────────

export async function whatsapp(req: Request, res: Response): Promise<void> {
  const purchase = await service.getPurchase(req.params.id as string);
  res.json({ success: true, data: buildWhatsappLink(purchase) });
}
