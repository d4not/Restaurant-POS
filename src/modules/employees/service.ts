import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { hashPassword } from '../auth/service.js';
import { Decimal } from '../../lib/decimal.js';
import type {
  CreateEmployeeInput,
  ListEmployeeQuery,
  UpdateEmployeeInput,
} from './schema.js';

// Payroll fields live on User, but we always expose them through the employees
// API so Phase 8 consumers don't need to touch the raw user model.
const employeeSelect = {
  id: true,
  name: true,
  email: true,
  role: true,
  active: true,
  weekly_salary: true,
  hire_date: true,
  position: true,
  phone: true,
  emergency_contact: true,
  notes: true,
  created_at: true,
  updated_at: true,
} satisfies Prisma.UserSelect;

export async function createEmployee(input: CreateEmployeeInput) {
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  if (existing) throw new ConflictError('email already in use');

  return prisma.user.create({
    data: {
      name: input.name,
      email: input.email,
      pin: input.pin,
      password_hash: await hashPassword(input.password),
      role: input.role,
      weekly_salary: new Decimal(input.weekly_salary),
      hire_date: input.hire_date,
      position: input.position,
      phone: input.phone,
      emergency_contact: input.emergency_contact,
      notes: input.notes,
    },
    select: employeeSelect,
  });
}

export async function listEmployees(query: ListEmployeeQuery) {
  // An "employee" is a user with a weekly_salary set — users without payroll
  // (service accounts, owner without payroll, etc.) are excluded by default.
  const where: Prisma.UserWhereInput = {
    weekly_salary: { not: null },
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.role ? { role: query.role } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { email: { contains: query.search, mode: 'insensitive' } },
            { position: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.user.findMany({
    where,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
    select: employeeSelect,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getEmployee(id: string) {
  const row = await prisma.user.findUnique({ where: { id }, select: employeeSelect });
  if (!row) throw new NotFoundError('Employee');
  return row;
}

export async function updateEmployee(id: string, input: UpdateEmployeeInput) {
  await getEmployee(id);

  if (input.email) {
    const clash = await prisma.user.findFirst({
      where: { email: input.email, NOT: { id } },
      select: { id: true },
    });
    if (clash) throw new ConflictError('email already in use');
  }

  const data: Prisma.UserUpdateInput = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.email !== undefined) data.email = input.email;
  if (input.pin !== undefined) data.pin = input.pin;
  if (input.password !== undefined) data.password_hash = await hashPassword(input.password);
  if (input.role !== undefined) data.role = input.role;
  if (input.active !== undefined) data.active = input.active;
  if (input.weekly_salary !== undefined) {
    data.weekly_salary = input.weekly_salary === null ? null : new Decimal(input.weekly_salary);
  }
  if (input.hire_date !== undefined) data.hire_date = input.hire_date;
  if (input.position !== undefined) data.position = input.position;
  if (input.phone !== undefined) data.phone = input.phone;
  if (input.emergency_contact !== undefined) data.emergency_contact = input.emergency_contact;
  if (input.notes !== undefined) data.notes = input.notes;

  return prisma.user.update({ where: { id }, data, select: employeeSelect });
}

export async function deactivateEmployee(id: string) {
  // Soft delete — users are referenced everywhere (orders, purchases, attendance)
  // and deleting would break history.
  await getEmployee(id);
  return prisma.user.update({
    where: { id },
    data: { active: false },
    select: employeeSelect,
  });
}
