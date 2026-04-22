import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateModifierGroupInput,
  UpdateModifierGroupInput,
  ListModifierGroupQuery,
  CreateModifierInput,
  UpdateModifierInput,
  ListModifierQuery,
} from './schema.js';

export async function createGroup(req: Request, res: Response): Promise<void> {
  const group = await service.createModifierGroup(req.body as CreateModifierGroupInput);
  res.status(201).json({ success: true, data: group });
}

export async function listGroups(req: Request, res: Response): Promise<void> {
  const page = await service.listModifierGroups(req.query as unknown as ListModifierGroupQuery);
  res.json({ success: true, data: page });
}

export async function getGroup(req: Request, res: Response): Promise<void> {
  const group = await service.getModifierGroup(req.params.id as string);
  res.json({ success: true, data: group });
}

export async function updateGroup(req: Request, res: Response): Promise<void> {
  const group = await service.updateModifierGroup(
    req.params.id as string,
    req.body as UpdateModifierGroupInput,
  );
  res.json({ success: true, data: group });
}

export async function removeGroup(req: Request, res: Response): Promise<void> {
  await service.deleteModifierGroup(req.params.id as string);
  res.status(204).send();
}

export async function listLinkedProducts(req: Request, res: Response): Promise<void> {
  const products = await service.listGroupLinkedProducts(req.params.id as string);
  res.json({ success: true, data: products });
}

export async function listOverrides(req: Request, res: Response): Promise<void> {
  const overrides = await service.listGroupOverrides(req.params.id as string);
  res.json({ success: true, data: overrides });
}

export async function createModifier(req: Request, res: Response): Promise<void> {
  const modifier = await service.createModifier(
    req.params.id as string,
    req.body as CreateModifierInput,
  );
  res.status(201).json({ success: true, data: modifier });
}

export async function listModifiers(req: Request, res: Response): Promise<void> {
  const page = await service.listModifiers(
    req.params.id as string,
    req.query as unknown as ListModifierQuery,
  );
  res.json({ success: true, data: page });
}

export async function getModifier(req: Request, res: Response): Promise<void> {
  const modifier = await service.getModifier(
    req.params.id as string,
    req.params.modifierId as string,
  );
  res.json({ success: true, data: modifier });
}

export async function updateModifier(req: Request, res: Response): Promise<void> {
  const modifier = await service.updateModifier(
    req.params.id as string,
    req.params.modifierId as string,
    req.body as UpdateModifierInput,
  );
  res.json({ success: true, data: modifier });
}

export async function removeModifier(req: Request, res: Response): Promise<void> {
  await service.deleteModifier(
    req.params.id as string,
    req.params.modifierId as string,
  );
  res.status(204).send();
}
