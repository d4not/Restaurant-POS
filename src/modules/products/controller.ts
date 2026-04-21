import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductQuery,
  CreateVariantInput,
  UpdateVariantInput,
  AttachModifierGroupInput,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const product = await service.createProduct(req.body as CreateProductInput);
  res.status(201).json({ success: true, data: product });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listProducts(req.query as unknown as ListProductQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const product = await service.getProduct(req.params.id as string);
  res.json({ success: true, data: product });
}

export async function update(req: Request, res: Response): Promise<void> {
  const product = await service.updateProduct(
    req.params.id as string,
    req.body as UpdateProductInput,
  );
  res.json({ success: true, data: product });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.softDeleteProduct(req.params.id as string);
  res.status(204).send();
}

export async function createVariant(req: Request, res: Response): Promise<void> {
  const variant = await service.createVariant(
    req.params.id as string,
    req.body as CreateVariantInput,
  );
  res.status(201).json({ success: true, data: variant });
}

export async function listVariants(req: Request, res: Response): Promise<void> {
  const variants = await service.listVariants(req.params.id as string);
  res.json({ success: true, data: variants });
}

export async function getVariant(req: Request, res: Response): Promise<void> {
  const variant = await service.getVariant(
    req.params.id as string,
    req.params.variantId as string,
  );
  res.json({ success: true, data: variant });
}

export async function updateVariant(req: Request, res: Response): Promise<void> {
  const variant = await service.updateVariant(
    req.params.id as string,
    req.params.variantId as string,
    req.body as UpdateVariantInput,
  );
  res.json({ success: true, data: variant });
}

export async function removeVariant(req: Request, res: Response): Promise<void> {
  await service.deleteVariant(
    req.params.id as string,
    req.params.variantId as string,
  );
  res.status(204).send();
}

export async function attachModifierGroup(req: Request, res: Response): Promise<void> {
  const body = req.body as AttachModifierGroupInput;
  const link = await service.attachModifierGroup(req.params.id as string, body.modifier_group_id);
  res.status(201).json({ success: true, data: link });
}

export async function detachModifierGroup(req: Request, res: Response): Promise<void> {
  await service.detachModifierGroup(
    req.params.id as string,
    req.params.groupId as string,
  );
  res.status(204).send();
}

export async function listModifierGroups(req: Request, res: Response): Promise<void> {
  const links = await service.listProductModifierGroups(req.params.id as string);
  res.json({ success: true, data: links });
}
