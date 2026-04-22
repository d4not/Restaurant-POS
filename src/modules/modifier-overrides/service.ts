import { ModifierOverrideType, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { normalizeUnit } from '../recipes/cost-engine.js';
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

// Volume and weight canonical families for cross-family rejection.
const VOLUME_UNITS = new Set(['ML', 'L', 'FL_OZ']);
const WEIGHT_UNITS = new Set(['G', 'KG', 'OZ']);

function familyOfNormalized(normalized: 'PIECE' | string): 'volume' | 'weight' | 'piece' {
  if (normalized === 'PIECE') return 'piece';
  if (VOLUME_UNITS.has(normalized)) return 'volume';
  if (WEIGHT_UNITS.has(normalized)) return 'weight';
  throw new BadRequestError(`Unknown unit family: ${normalized}`);
}

// FIXED_QTY overrides must use a unit compatible with the modifier's supply.
// The engine ultimately routes this through convertRecipeQuantityToBase, which
// rejects cross-family conversions — but that happens at sale time, long after
// the misconfiguration was saved. Catching it at override-create time turns a
// silent-until-sale bug into a visible-at-save error.
async function assertOverrideUnitCompatible(
  modifierId: string,
  overrideUnit: string | null | undefined,
  overrideType: ModifierOverrideType,
): Promise<void> {
  if (overrideType !== ModifierOverrideType.FIXED_QTY) return;
  if (!overrideUnit) return;
  const modifier = await prisma.modifier.findUnique({
    where: { id: modifierId },
    select: {
      supply: {
        select: { id: true, name: true, content_unit: true },
      },
    },
  });
  if (!modifier?.supply) return;
  if (!modifier.supply.content_unit) {
    // Piece-type supply: override_unit must also be a piece alias.
    const normalized = normalizeUnit(overrideUnit);
    if (normalized !== 'PIECE') {
      throw new BadRequestError(
        `Modifier supply "${modifier.supply.name}" is piece-type; override_unit must be a piece unit, got "${overrideUnit}"`,
      );
    }
    return;
  }
  const normalized = normalizeUnit(overrideUnit);
  const overrideFamily = familyOfNormalized(normalized);
  const supplyFamily = familyOfNormalized(modifier.supply.content_unit);
  if (overrideFamily !== supplyFamily) {
    throw new BadRequestError(
      `override_unit "${overrideUnit}" is ${overrideFamily}; modifier supply "${modifier.supply.name}" is measured in ${supplyFamily} — units must share a family`,
    );
  }
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
  await assertOverrideUnitCompatible(
    input.modifier_id,
    input.override_unit,
    input.override_type,
  );
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
    // Re-validate unit compatibility on update — a user might be switching
    // from RATIO to FIXED_QTY or swapping the unit string directly.
    await assertOverrideUnitCompatible(modifierId, nextUnit, nextType);
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
