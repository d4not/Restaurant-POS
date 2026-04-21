import type { Request, Response } from 'express';
import * as service from './service.js';
import type {
  CreateRecipeInput,
  UpdateRecipeInput,
  CreateRecipeItemInput,
  UpdateRecipeItemInput,
} from './schema.js';

export async function createForProduct(req: Request, res: Response): Promise<void> {
  const recipe = await service.createProductRecipe(
    req.params.productId as string,
    req.body as CreateRecipeInput,
  );
  res.status(201).json({ success: true, data: recipe });
}

export async function createForVariant(req: Request, res: Response): Promise<void> {
  const recipe = await service.createVariantRecipe(
    req.params.variantId as string,
    req.body as CreateRecipeInput,
  );
  res.status(201).json({ success: true, data: recipe });
}

export async function getForProduct(req: Request, res: Response): Promise<void> {
  const recipe = await service.getProductRecipe(req.params.productId as string);
  res.json({ success: true, data: recipe });
}

export async function getForVariant(req: Request, res: Response): Promise<void> {
  const recipe = await service.getVariantRecipe(req.params.variantId as string);
  res.json({ success: true, data: recipe });
}

export async function getById(req: Request, res: Response): Promise<void> {
  const recipe = await service.getRecipe(req.params.id as string);
  res.json({ success: true, data: recipe });
}

export async function update(req: Request, res: Response): Promise<void> {
  const recipe = await service.updateRecipe(
    req.params.id as string,
    req.body as UpdateRecipeInput,
  );
  res.json({ success: true, data: recipe });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteRecipe(req.params.id as string);
  res.status(204).send();
}

export async function addItem(req: Request, res: Response): Promise<void> {
  const item = await service.addRecipeItem(
    req.params.id as string,
    req.body as CreateRecipeItemInput,
  );
  res.status(201).json({ success: true, data: item });
}

export async function updateItem(req: Request, res: Response): Promise<void> {
  const item = await service.updateRecipeItem(
    req.params.id as string,
    req.params.itemId as string,
    req.body as UpdateRecipeItemInput,
  );
  res.json({ success: true, data: item });
}

export async function removeItem(req: Request, res: Response): Promise<void> {
  await service.removeRecipeItem(
    req.params.id as string,
    req.params.itemId as string,
  );
  res.status(204).send();
}

export async function recalculate(req: Request, res: Response): Promise<void> {
  const result = await service.recalculateRecipe(req.params.id as string);
  res.json({ success: true, data: result });
}
