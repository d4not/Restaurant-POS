import type { Request, Response } from 'express';
import type { UserRole } from '@prisma/client';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  AddOrderItemInput,
  CancelOrderInput,
  CreateOrderInput,
  CreatePaymentInput,
  ListOrderQuery,
  RemoveOrderItemInput,
  RequestAttentionInput,
  RestoreOrderItemInput,
  UpdateOrderInput,
  UpdateOrderItemInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

function currentUserRole(req: Request): UserRole {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.role;
}

export async function create(req: Request, res: Response): Promise<void> {
  const order = await service.createOrder(
    currentUserId(req),
    req.body as CreateOrderInput,
  );
  res.status(201).json({ success: true, data: order });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listOrders(req.query as unknown as ListOrderQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const order = await service.getOrder(req.params.id as string);
  res.json({ success: true, data: order });
}

export async function update(req: Request, res: Response): Promise<void> {
  const order = await service.updateOrder(
    req.params.id as string,
    req.body as UpdateOrderInput,
  );
  res.json({ success: true, data: order });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const order = await service.cancelOrder(
    req.params.id as string,
    currentUserId(req),
    req.body as CancelOrderInput,
  );
  res.json({ success: true, data: order });
}

export async function addItem(req: Request, res: Response): Promise<void> {
  const order = await service.addOrderItem(
    req.params.id as string,
    req.body as AddOrderItemInput,
    currentUserId(req),
  );
  res.status(201).json({ success: true, data: order });
}

export async function updateItem(req: Request, res: Response): Promise<void> {
  const order = await service.updateOrderItem(
    req.params.id as string,
    req.params.itemId as string,
    req.body as UpdateOrderItemInput,
  );
  res.json({ success: true, data: order });
}

export async function removeItem(req: Request, res: Response): Promise<void> {
  const order = await service.removeOrderItem(
    req.params.id as string,
    req.params.itemId as string,
    req.body as RemoveOrderItemInput,
  );
  res.json({ success: true, data: order });
}

export async function restoreItem(req: Request, res: Response): Promise<void> {
  const order = await service.restoreOrderItem(
    req.params.id as string,
    req.params.itemId as string,
    req.body as RestoreOrderItemInput,
  );
  res.json({ success: true, data: order });
}

export async function addPayment(req: Request, res: Response): Promise<void> {
  const result = await service.addPayment(
    req.params.id as string,
    req.body as CreatePaymentInput,
    currentUserId(req),
    currentUserRole(req),
  );
  res.status(201).json({ success: true, data: result });
}

export async function ingredients(req: Request, res: Response): Promise<void> {
  const result = await service.getOrderIngredients(req.params.id as string);
  res.json({ success: true, data: result });
}

export async function sendToKitchen(req: Request, res: Response): Promise<void> {
  const result = await service.sendToKitchen(req.params.id as string);
  res.json({ success: true, data: result });
}

export async function active(_req: Request, res: Response): Promise<void> {
  const orders = await service.listActiveOrders();
  res.json({ success: true, data: orders });
}

export async function flagAttention(req: Request, res: Response): Promise<void> {
  const order = await service.flagOrderForAttention(
    req.params.id as string,
    req.body as RequestAttentionInput,
  );
  res.json({ success: true, data: order });
}

export async function clearAttention(req: Request, res: Response): Promise<void> {
  const order = await service.clearOrderAttention(req.params.id as string);
  res.json({ success: true, data: order });
}
