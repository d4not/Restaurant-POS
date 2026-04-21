import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateSupplierInput,
  UpdateSupplierInput,
  ListSupplierQuery,
} from './schema.js';

export async function createSupplier(input: CreateSupplierInput) {
  return prisma.supplier.create({ data: input });
}

export async function listSuppliers(query: ListSupplierQuery) {
  const where: Prisma.SupplierWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { contact_name: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.supplier.findMany({
    where,
    orderBy: { name: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getSupplier(id: string) {
  const row = await prisma.supplier.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('Supplier');
  return row;
}

export async function updateSupplier(id: string, input: UpdateSupplierInput) {
  await getSupplier(id);
  return prisma.supplier.update({ where: { id }, data: input });
}

export async function deleteSupplier(id: string) {
  // Soft-delete by flipping active; suppliers are referenced by purchases and
  // packagings which must remain intact for historical reporting.
  await getSupplier(id);
  return prisma.supplier.update({ where: { id }, data: { active: false } });
}
