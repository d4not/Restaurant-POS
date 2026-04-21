import { ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import type {
  CreateProductModificationInput,
  UpdateProductModificationInput,
} from './schema.js';

// Modifications live under packaged PRODUCT items (Juice → Orange/Mango/...).
// Rejecting DISH / PREPARATION at write time keeps bad rows out of the DB.
async function loadPackagedProductOrThrow(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, type: true, deleted_at: true },
  });
  if (!product || product.deleted_at) throw new NotFoundError('Product');
  if (product.type !== ProductType.PRODUCT) {
    throw new BadRequestError('Modifications are only valid for type=PRODUCT');
  }
  return product;
}

async function assertSupplyExists(supplyId: string): Promise<void> {
  const supply = await prisma.supply.findFirst({
    where: { id: supplyId, deleted_at: null },
    select: { id: true },
  });
  if (!supply) throw new BadRequestError('supply_id references a non-existent supply');
}

export async function createModification(
  productId: string,
  input: CreateProductModificationInput,
) {
  await loadPackagedProductOrThrow(productId);
  if (input.supply_id) await assertSupplyExists(input.supply_id);
  return prisma.productModification.create({
    data: { ...input, product_id: productId },
    include: { supply: { select: { id: true, name: true, base_unit: true } } },
  });
}

export async function listModifications(productId: string) {
  await loadPackagedProductOrThrow(productId);
  return prisma.productModification.findMany({
    where: { product_id: productId },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: { supply: { select: { id: true, name: true, base_unit: true } } },
  });
}

async function loadModificationOrThrow(productId: string, modificationId: string) {
  const row = await prisma.productModification.findUnique({
    where: { id: modificationId },
    include: { supply: { select: { id: true, name: true, base_unit: true } } },
  });
  if (!row || row.product_id !== productId) throw new NotFoundError('ProductModification');
  return row;
}

export async function getModification(productId: string, modificationId: string) {
  return loadModificationOrThrow(productId, modificationId);
}

export async function updateModification(
  productId: string,
  modificationId: string,
  input: UpdateProductModificationInput,
) {
  const existing = await loadModificationOrThrow(productId, modificationId);
  if (input.supply_id && input.supply_id !== existing.supply_id) {
    await assertSupplyExists(input.supply_id);
  }
  return prisma.productModification.update({
    where: { id: modificationId },
    data: input,
    include: { supply: { select: { id: true, name: true, base_unit: true } } },
  });
}

export async function deleteModification(productId: string, modificationId: string) {
  await loadModificationOrThrow(productId, modificationId);
  await prisma.productModification.delete({ where: { id: modificationId } });
}
