import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateEmployeeInput,
  ListEmployeeQuery,
  UpdateEmployeeInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const employee = await service.createEmployee(req.body as CreateEmployeeInput);
  res.status(201).json({ success: true, data: employee });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listEmployees(req.query as unknown as ListEmployeeQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const employee = await service.getEmployee(req.params.id as string);
  res.json({ success: true, data: employee });
}

export async function update(req: Request, res: Response): Promise<void> {
  const employee = await service.updateEmployee(
    req.params.id as string,
    req.body as UpdateEmployeeInput,
  );
  res.json({ success: true, data: employee });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deactivateEmployee(req.params.id as string);
  res.status(204).send();
}
