import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  ListProductCategoryQuery,
} from './schema.js';

export async function create(req: Request, res: Response): Promise<void> {
  const category = await service.createProductCategory(req.body as CreateProductCategoryInput);
  res.status(201).json({ success: true, data: category });
}

export async function list(req: Request, res: Response): Promise<void> {
  const page = await service.listProductCategories(req.query as unknown as ListProductCategoryQuery);
  res.json({ success: true, data: page });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const category = await service.getProductCategory(req.params.id as string);
  res.json({ success: true, data: category });
}

export async function update(req: Request, res: Response): Promise<void> {
  const category = await service.updateProductCategory(
    req.params.id as string,
    req.body as UpdateProductCategoryInput,
  );
  res.json({ success: true, data: category });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteProductCategory(req.params.id as string);
  res.status(204).send();
}
