import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateModifierGroupInput,
  UpdateModifierGroupInput,
  ListModifierGroupQuery,
  CreateModifierInput,
  UpdateModifierInput,
  ListModifierQuery,
} from './schema.js';

// ----------------------------------------------------------------------------
// Modifier groups
// ----------------------------------------------------------------------------

export async function createModifierGroup(input: CreateModifierGroupInput) {
  return prisma.modifierGroup.create({ data: input });
}

export async function listModifierGroups(query: ListModifierGroupQuery) {
  const where: Prisma.ModifierGroupWhereInput = query.search
    ? { name: { contains: query.search, mode: 'insensitive' } }
    : {};
  const rows = await prisma.modifierGroup.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: { modifiers: { where: { active: true }, orderBy: { display_order: 'asc' } } },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getModifierGroup(id: string) {
  const row = await prisma.modifierGroup.findUnique({
    where: { id },
    include: { modifiers: { orderBy: { display_order: 'asc' } } },
  });
  if (!row) throw new NotFoundError('ModifierGroup');
  return row;
}

export async function updateModifierGroup(id: string, input: UpdateModifierGroupInput) {
  const existing = await getModifierGroup(id);
  const nextMin = input.min_selection ?? existing.min_selection;
  const nextMax = input.max_selection ?? existing.max_selection;
  if (nextMin > nextMax) {
    throw new BadRequestError('min_selection cannot exceed max_selection');
  }
  return prisma.modifierGroup.update({ where: { id }, data: input });
}

export async function deleteModifierGroup(id: string) {
  await getModifierGroup(id);
  // Cascade handles Modifiers and ProductModifierGroup links.
  await prisma.modifierGroup.delete({ where: { id } });
}

// ----------------------------------------------------------------------------
// Modifiers (nested under a group)
// ----------------------------------------------------------------------------

async function assertGroupExists(groupId: string): Promise<void> {
  const exists = await prisma.modifierGroup.findUnique({
    where: { id: groupId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('ModifierGroup');
}

async function assertSupplyExists(supplyId: string): Promise<void> {
  const exists = await prisma.supply.findFirst({
    where: { id: supplyId, deleted_at: null },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('supply_id references a non-existent supply');
}

export async function createModifier(groupId: string, input: CreateModifierInput) {
  await assertGroupExists(groupId);
  if (input.supply_id) await assertSupplyExists(input.supply_id);
  return prisma.modifier.create({
    data: { ...input, group_id: groupId },
  });
}

export async function listModifiers(groupId: string, query: ListModifierQuery) {
  await assertGroupExists(groupId);
  const where: Prisma.ModifierWhereInput = {
    group_id: groupId,
    ...(query.active !== undefined ? { active: query.active } : {}),
  };
  const rows = await prisma.modifier.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: { supply: { select: { id: true, name: true, content_unit: true } } },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getModifier(groupId: string, modifierId: string) {
  const row = await prisma.modifier.findUnique({
    where: { id: modifierId },
    include: { supply: { select: { id: true, name: true, content_unit: true } } },
  });
  if (!row || row.group_id !== groupId) throw new NotFoundError('Modifier');
  return row;
}

export async function updateModifier(
  groupId: string,
  modifierId: string,
  input: UpdateModifierInput,
) {
  const existing = await getModifier(groupId, modifierId);
  if (input.supply_id !== undefined && input.supply_id !== null) {
    await assertSupplyExists(input.supply_id);
  }
  // Re-check the supply triplet across merged fields — partial updates could
  // leave the row in a half-deducting state otherwise.
  const merged = {
    supply_id: input.supply_id !== undefined ? input.supply_id : existing.supply_id,
    supply_quantity:
      input.supply_quantity !== undefined ? input.supply_quantity : existing.supply_quantity,
    supply_unit: input.supply_unit !== undefined ? input.supply_unit : existing.supply_unit,
  };
  const has = (v: unknown) => v != null;
  const tripletOk =
    (!has(merged.supply_id) && !has(merged.supply_quantity) && !has(merged.supply_unit)) ||
    (has(merged.supply_id) && has(merged.supply_quantity) && has(merged.supply_unit));
  if (!tripletOk) {
    throw new BadRequestError(
      'supply_id, supply_quantity, and supply_unit must all be provided together',
    );
  }
  return prisma.modifier.update({ where: { id: modifierId }, data: input });
}

export async function deleteModifier(groupId: string, modifierId: string) {
  await getModifier(groupId, modifierId);
  await prisma.modifier.delete({ where: { id: modifierId } });
}
