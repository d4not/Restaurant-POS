import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError, ConflictError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateEmployeeProductInput,
  CreateEmployeeSaleInput,
  ListEmployeeProductsQuery,
  ListEmployeeSalesQuery,
  UpdateEmployeeProductInput,
} from './schema.js';

// Include shape shared by the API surface so the admin form and the terminal
// panel both get the linked product/variant names without a follow-up call.
const employeeProductInclude = {
  product: { select: { id: true, name: true, type: true, image_url: true, icon_color: true } },
  variant: { select: { id: true, name: true, sell_price: true } },
} satisfies Prisma.EmployeeProductInclude;

const employeeSaleInclude = {
  employee_product: {
    select: { id: true, label: true },
  },
  product: { select: { id: true, name: true } },
  variant: { select: { id: true, name: true } },
  employee: { select: { id: true, name: true, role: true } },
  recorded_by: { select: { id: true, name: true, role: true } },
} satisfies Prisma.EmployeeSaleInclude;

/* ── EmployeeProduct CRUD ────────────────────────────────────────────────── */

export async function createEmployeeProduct(input: CreateEmployeeProductInput) {
  // Confirm the product exists and isn't soft-deleted; if a variant is given,
  // confirm it belongs to that product. We do this outside a transaction
  // because the unique constraint catches the only consistency risk.
  const product = await prisma.product.findFirst({
    where: { id: input.product_id, deleted_at: null },
    select: { id: true, type: true },
  });
  if (!product) throw new NotFoundError('Product');
  if (product.type === 'PREPARATION') {
    throw new BadRequestError('PREPARATION products cannot be sold to employees');
  }

  if (input.variant_id) {
    const variant = await prisma.productVariant.findFirst({
      where: { id: input.variant_id, product_id: input.product_id },
      select: { id: true },
    });
    if (!variant) {
      throw new BadRequestError('variant_id does not belong to the given product');
    }
  }

  try {
    const row = await prisma.employeeProduct.create({
      data: {
        product_id: input.product_id,
        variant_id: input.variant_id ?? null,
        employee_price: input.employee_price,
        label: input.label ?? null,
        active: input.active ?? true,
        display_order: input.display_order ?? 0,
      },
      include: employeeProductInclude,
    });
    return row;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new ConflictError(
        'This product/variant combination already has an employee price',
      );
    }
    throw err;
  }
}

export async function updateEmployeeProduct(
  id: string,
  input: UpdateEmployeeProductInput,
) {
  const existing = await prisma.employeeProduct.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!existing) throw new NotFoundError('EmployeeProduct');

  return prisma.employeeProduct.update({
    where: { id },
    data: {
      ...(input.employee_price !== undefined ? { employee_price: input.employee_price } : {}),
      ...(input.label !== undefined ? { label: input.label } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
      ...(input.display_order !== undefined ? { display_order: input.display_order } : {}),
    },
    include: employeeProductInclude,
  });
}

export async function deleteEmployeeProduct(id: string) {
  const existing = await prisma.employeeProduct.findUnique({
    where: { id },
    select: { id: true, _count: { select: { sales: true } } },
  });
  if (!existing) throw new NotFoundError('EmployeeProduct');
  // If any sales have been recorded, soft-delete (active=false) to preserve
  // the audit trail. Otherwise hard-delete since the row is unused.
  if (existing._count.sales > 0) {
    return prisma.employeeProduct.update({
      where: { id },
      data: { active: false },
      include: employeeProductInclude,
    });
  }
  await prisma.employeeProduct.delete({ where: { id } });
  return null;
}

export async function listEmployeeProducts(query: ListEmployeeProductsQuery) {
  const where: Prisma.EmployeeProductWhereInput = {
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.product_id ? { product_id: query.product_id } : {}),
  };
  const rows = await prisma.employeeProduct.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { id: 'asc' }],
    include: employeeProductInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getEmployeeProduct(id: string) {
  const row = await prisma.employeeProduct.findUnique({
    where: { id },
    include: employeeProductInclude,
  });
  if (!row) throw new NotFoundError('EmployeeProduct');
  return row;
}

/* ── EmployeeSale (handout audit log) ─────────────────────────────────────── */

export async function createEmployeeSale(
  recordedByUserId: string,
  input: CreateEmployeeSaleInput,
) {
  return prisma.$transaction(async (tx) => {
    const ep = await tx.employeeProduct.findFirst({
      where: { id: input.employee_product_id, active: true },
      include: {
        product: { select: { id: true, name: true } },
        variant: { select: { id: true, name: true } },
      },
    });
    if (!ep) throw new NotFoundError('EmployeeProduct');

    const employee = await tx.user.findFirst({
      where: { id: input.employee_user_id, active: true },
      select: { id: true },
    });
    if (!employee) throw new BadRequestError('employee_user_id is not an active user');

    // Attach to the currently open register, if any. This is best-effort —
    // the perk handout doesn't require an open shift, but tying it to one
    // lets the daily report aggregate them. There's at most one OPEN register
    // at any time under the singleton-shift model.
    const openRegister = await tx.cashRegister.findFirst({
      where: { status: 'OPEN' },
      select: { id: true },
      orderBy: { opened_at: 'desc' },
    });

    const productLabel = ep.variant
      ? `${ep.product.name} (${ep.variant.name})`
      : ep.product.name;

    const unitPrice = ep.employee_price;
    const total = unitPrice.mul(input.quantity);

    return tx.employeeSale.create({
      data: {
        employee_product_id: ep.id,
        product_id: ep.product_id,
        variant_id: ep.variant_id,
        employee_user_id: input.employee_user_id,
        recorded_by_user_id: recordedByUserId,
        register_id: openRegister?.id ?? null,
        product_name: ep.label ?? productLabel,
        unit_price: unitPrice,
        quantity: input.quantity,
        total,
        notes: input.notes ?? null,
      },
      include: employeeSaleInclude,
    });
  });
}

export async function listEmployeeSales(query: ListEmployeeSalesQuery) {
  const where: Prisma.EmployeeSaleWhereInput = {
    ...(query.employee_user_id ? { employee_user_id: query.employee_user_id } : {}),
    ...(query.product_id ? { product_id: query.product_id } : {}),
    ...(query.register_id ? { register_id: query.register_id } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.employeeSale.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: employeeSaleInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}
