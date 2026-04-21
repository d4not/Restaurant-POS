import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateProductCategoryInput,
  UpdateProductCategoryInput,
  ListProductCategoryQuery,
} from './schema.js';

async function assertParentExists(parentId: string): Promise<void> {
  const parent = await prisma.productCategory.findUnique({
    where: { id: parentId },
    select: { id: true },
  });
  if (!parent) throw new BadRequestError('parent_id references a non-existent category');
}

/**
 * Walk up the parent chain from `candidateParentId` looking for `selfId`.
 * A cycle would make the tree impossible to render and queries non-terminating.
 */
async function assertNoCycle(selfId: string, candidateParentId: string): Promise<void> {
  if (selfId === candidateParentId) {
    throw new BadRequestError('A category cannot be its own parent');
  }
  let cursor: string | null = candidateParentId;
  const visited = new Set<string>();
  while (cursor) {
    if (cursor === selfId) {
      throw new BadRequestError('parent_id would create a cycle in the category tree');
    }
    if (visited.has(cursor)) return;
    visited.add(cursor);
    const next: { parent_id: string | null } | null = await prisma.productCategory.findUnique({
      where: { id: cursor },
      select: { parent_id: true },
    });
    cursor = next?.parent_id ?? null;
  }
}

export async function createProductCategory(input: CreateProductCategoryInput) {
  if (input.parent_id) await assertParentExists(input.parent_id);
  return prisma.productCategory.create({ data: input });
}

export async function listProductCategories(query: ListProductCategoryQuery) {
  const where: Prisma.ProductCategoryWhereInput = {
    ...(query.parent_id === 'null'
      ? { parent_id: null }
      : query.parent_id
        ? { parent_id: query.parent_id }
        : {}),
    ...(query.visible_in_pos !== undefined ? { visible_in_pos: query.visible_in_pos } : {}),
    ...(query.search ? { name: { contains: query.search, mode: 'insensitive' } } : {}),
  };
  const rows = await prisma.productCategory.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: { children: { select: { id: true, name: true } } },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getProductCategory(id: string) {
  const row = await prisma.productCategory.findUnique({
    where: { id },
    include: { children: { select: { id: true, name: true } }, parent: true },
  });
  if (!row) throw new NotFoundError('ProductCategory');
  return row;
}

export async function updateProductCategory(id: string, input: UpdateProductCategoryInput) {
  await getProductCategory(id);
  if (input.parent_id !== undefined && input.parent_id !== null) {
    await assertParentExists(input.parent_id);
    await assertNoCycle(id, input.parent_id);
  }
  return prisma.productCategory.update({ where: { id }, data: input });
}

export async function deleteProductCategory(id: string) {
  await getProductCategory(id);
  const [childCount, productCount] = await Promise.all([
    prisma.productCategory.count({ where: { parent_id: id } }),
    prisma.product.count({ where: { category_id: id, deleted_at: null } }),
  ]);
  if (childCount > 0) {
    throw new ConflictError('Cannot delete category with subcategories');
  }
  if (productCount > 0) {
    throw new ConflictError('Cannot delete category with active products');
  }
  await prisma.productCategory.delete({ where: { id } });
}
