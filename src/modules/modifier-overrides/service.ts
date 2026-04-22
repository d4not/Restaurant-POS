import { ModifierOverrideType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import type { CreateOverrideInput, UpdateOverrideInput } from './schema.js';

const overrideInclude = {
  modifier: {
    select: {
      id: true,
      name: true,
      group_id: true,
      group: { select: { id: true, name: true, type: true } },
    },
  },
} satisfies Prisma.ModifierProductOverrideInclude;

async function assertProductExists(productId: string): Promise<void> {
  const exists = await prisma.product.findFirst({
    where: { id: productId, deleted_at: null },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Product');
}

async function assertModifierExists(modifierId: string): Promise<void> {
  const exists = await prisma.modifier.findUnique({
    where: { id: modifierId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('modifier_id references a non-existent modifier');
}

export async function listOverrides(productId: string) {
  await assertProductExists(productId);
  return prisma.modifierProductOverride.findMany({
    where: { product_id: productId },
    include: overrideInclude,
  });
}

export async function createOverride(productId: string, input: CreateOverrideInput) {
  await assertProductExists(productId);
  await assertModifierExists(input.modifier_id);
  try {
    return await prisma.modifierProductOverride.create({
      data: {
        product_id: productId,
        modifier_id: input.modifier_id,
        override_type: input.override_type,
        override_ratio: input.override_ratio ?? null,
        override_quantity: input.override_quantity ?? null,
        override_unit: input.override_unit ?? null,
      },
      include: overrideInclude,
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002'
    ) {
      throw new ConflictError('An override for this product + modifier already exists');
    }
    throw err;
  }
}

async function loadOverrideOrThrow(productId: string, modifierId: string) {
  const row = await prisma.modifierProductOverride.findUnique({
    where: { product_id_modifier_id: { product_id: productId, modifier_id: modifierId } },
    include: overrideInclude,
  });
  if (!row) throw new NotFoundError('ModifierProductOverride');
  return row;
}

export async function getOverride(productId: string, modifierId: string) {
  return loadOverrideOrThrow(productId, modifierId);
}

export async function updateOverride(
  productId: string,
  modifierId: string,
  input: UpdateOverrideInput,
) {
  const existing = await loadOverrideOrThrow(productId, modifierId);
  const nextType = input.override_type ?? existing.override_type;
  const nextRatio =
    input.override_ratio !== undefined ? input.override_ratio : existing.override_ratio;
  const nextQty =
    input.override_quantity !== undefined ? input.override_quantity : existing.override_quantity;
  const nextUnit =
    input.override_unit !== undefined ? input.override_unit : existing.override_unit;

  if (nextType === ModifierOverrideType.RATIO) {
    if (nextRatio == null) {
      throw new BadRequestError('RATIO overrides require override_ratio');
    }
    if (nextQty != null || nextUnit != null) {
      throw new BadRequestError('RATIO overrides must not have override_quantity or override_unit');
    }
  } else {
    if (nextQty == null || nextUnit == null) {
      throw new BadRequestError(
        'FIXED_QTY overrides require override_quantity and override_unit',
      );
    }
    if (nextRatio != null) {
      throw new BadRequestError('FIXED_QTY overrides must not have override_ratio');
    }
  }

  return prisma.modifierProductOverride.update({
    where: { id: existing.id },
    data: {
      override_type: input.override_type,
      override_ratio:
        input.override_ratio === undefined
          ? undefined
          : input.override_ratio === null
            ? null
            : input.override_ratio,
      override_quantity:
        input.override_quantity === undefined
          ? undefined
          : input.override_quantity === null
            ? null
            : input.override_quantity,
      override_unit:
        input.override_unit === undefined ? undefined : input.override_unit,
    },
    include: overrideInclude,
  });
}

export async function deleteOverride(productId: string, modifierId: string) {
  const existing = await loadOverrideOrThrow(productId, modifierId);
  await prisma.modifierProductOverride.delete({ where: { id: existing.id } });
}
