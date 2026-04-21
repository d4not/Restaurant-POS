import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import type {
  CreateTaxInput,
  UpdateTaxInput,
  ListTaxQuery,
} from './schema.js';

export async function createTax(input: CreateTaxInput) {
  return prisma.tax.create({ data: input });
}

export async function listTaxes(query: ListTaxQuery) {
  const where: Prisma.TaxWhereInput =
    query.active !== undefined ? { active: query.active } : {};
  return prisma.tax.findMany({ where, orderBy: { name: 'asc' } });
}

export async function getTax(id: string) {
  const row = await prisma.tax.findUnique({ where: { id } });
  if (!row) throw new NotFoundError('Tax');
  return row;
}

export async function updateTax(id: string, input: UpdateTaxInput) {
  await getTax(id);
  return prisma.tax.update({ where: { id }, data: input });
}

// Hard-deleting a Tax would orphan product.tax_id references. Refuse if any
// active product still points at this tax — users should deactivate instead.
export async function deleteTax(id: string) {
  await getTax(id);
  const inUse = await prisma.product.count({
    where: { tax_id: id, deleted_at: null },
  });
  if (inUse > 0) {
    throw new ConflictError(
      `Tax is assigned to ${inUse} product(s); reassign or deactivate them first`,
    );
  }
  await prisma.tax.delete({ where: { id } });
}
