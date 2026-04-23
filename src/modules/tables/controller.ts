import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateTableInput,
  ListTableQuery,
  UpdateTableInput,
  UpdateTableStatusInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const table = await service.createTable(req.body as CreateTableInput);
  res.status(201).json({ success: true, data: table });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listTables(req.query as unknown as ListTableQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const table = await service.getTable(req.params.id as string);
  res.json({ success: true, data: table });
}

export async function update(req: Request, res: Response): Promise<void> {
  const table = await service.updateTable(
    req.params.id as string,
    req.body as UpdateTableInput,
  );
  res.json({ success: true, data: table });
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const table = await service.updateTableStatus(
    req.params.id as string,
    req.body as UpdateTableStatusInput,
  );
  res.json({ success: true, data: table });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteTable(req.params.id as string);
  res.status(204).send();
}
