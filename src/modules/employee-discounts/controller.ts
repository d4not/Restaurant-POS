import type { Request, Response } from 'express';
import { UnauthorizedError } from '../../lib/errors.js';
import * as service from './service.js';
import type {
  CreateEmployeeProductInput,
  CreateEmployeeSaleInput,
  ListEmployeeProductsQuery,
  ListEmployeeSalesQuery,
  UpdateEmployeeProductInput,
} from './schema.js';

function currentUserId(req: Request): string {
  if (!req.auth) throw new UnauthorizedError('Missing auth context');
  return req.auth.userId;
}

/* ── EmployeeProduct ───────────────────────────────────────────────── */

export async function createProduct(req: Request, res: Response): Promise<void> {
  const row = await service.createEmployeeProduct(
    req.body as CreateEmployeeProductInput,
  );
  res.status(201).json({ success: true, data: row });
}

export async function listProducts(req: Request, res: Response): Promise<void> {
  const page = await service.listEmployeeProducts(
    req.query as unknown as ListEmployeeProductsQuery,
  );
  res.json({ success: true, data: page });
}

export async function getProduct(req: Request, res: Response): Promise<void> {
  const row = await service.getEmployeeProduct(req.params.id as string);
  res.json({ success: true, data: row });
}

export async function updateProduct(req: Request, res: Response): Promise<void> {
  const row = await service.updateEmployeeProduct(
    req.params.id as string,
    req.body as UpdateEmployeeProductInput,
  );
  res.json({ success: true, data: row });
}

export async function deleteProduct(req: Request, res: Response): Promise<void> {
  const row = await service.deleteEmployeeProduct(req.params.id as string);
  // null = hard-deleted (no sales). Anything else = soft-disabled.
  res.json({ success: true, data: row });
}

/* ── EmployeeSale ─────────────────────────────────────────────────── */

export async function createSale(req: Request, res: Response): Promise<void> {
  const row = await service.createEmployeeSale(
    currentUserId(req),
    req.body as CreateEmployeeSaleInput,
  );
  res.status(201).json({ success: true, data: row });
}

export async function listSales(req: Request, res: Response): Promise<void> {
  const page = await service.listEmployeeSales(
    req.query as unknown as ListEmployeeSalesQuery,
  );
  res.json({ success: true, data: page });
}
