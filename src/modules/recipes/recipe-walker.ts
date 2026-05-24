import {
  ModifierGroupType,
  ModifierOverrideType,
  Prisma,
  ProductType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import {
  convertRecipeQuantityToBase,
  computePreparationFactor,
} from './cost-engine.js';

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export type RecipeItemRow = {
  supply_id: string | null;
  preparation_id: string | null;
  modifier_group_id: string | null;
  quantity: Prisma.Decimal;
  unit: string;
  waste_pct: Prisma.Decimal;
};

export type ResolvedModifier = {
  id: string;
  group_id: string;
  group_type: ModifierGroupType;
  supply_id: string | null;
  supply_quantity: Prisma.Decimal | null;
  supply_unit: string | null;
  ratio: Prisma.Decimal;
  is_default: boolean;
};

export type OverrideRow = {
  product_id: string;
  modifier_id: string;
  override_type: ModifierOverrideType;
  override_ratio: Prisma.Decimal | null;
  override_quantity: Prisma.Decimal | null;
  override_unit: string | null;
};

// Mutable state passed across recursive accumulate calls.
//   selectedByGroupId — modifiers the customer picked, keyed by their SWAP group
//   overrides          — per-product overrides keyed by modifier id
//   consumedGroupIds   — slots filled by a customer selection (walker writes;
//                        callers read to detect orphan SWAP picks)
export type SlotContext = {
  productId: string;
  lineQty: Decimal;
  selectedByGroupId: Map<string, ResolvedModifier>;
  overrides: Map<string, OverrideRow>;
  consumedGroupIds: Set<string>;
};

export type WalkErrorKind =
  | 'unresolved-storage'
  | 'missing-default'
  | 'bad-config'
  | 'unknown-supply'
  | 'cycle'
  | 'invalid-recipe-item';

export type WalkError = {
  kind: WalkErrorKind;
  message: string;
  supply_id?: string | null;
  modifier_id?: string | null;
  preparation_id?: string | null;
};

export type Aggregate = Map<string, Decimal>;

export const aggregateKey = (supplyId: string, storageId: string): string =>
  `${supplyId}|${storageId}`;

export function addDraw(
  agg: Aggregate,
  supplyId: string,
  storageId: string,
  qty: Decimal,
): void {
  const k = aggregateKey(supplyId, storageId);
  agg.set(k, (agg.get(k) ?? new Decimal(0)).add(qty));
}

// Resolver may return null when no storage can be determined. Sales callers
// pass a resolver that throws internally (so they never see null); availability
// callers pass a resolver that returns null so the walker records a soft
// `unresolved-storage` error instead of blowing up the whole bulk endpoint.
export type StorageResolver = (supplyId: string) => Promise<string | null>;

export type SupplyInfo = {
  content_per_unit: Prisma.Decimal | null;
  content_unit: import('@prisma/client').ContentUnit | null;
  deleted_at: Date | null;
};

export type PreparationInfo = {
  id: string;
  type: ProductType;
  recipe: {
    yield_quantity: Prisma.Decimal | null;
    yield_unit: string | null;
    items: RecipeItemRow[];
  } | null;
};

// Hookable lookups — when provided, walker uses these instead of hitting the
// DB. The availability engine pre-fetches all referenced rows once and feeds
// them in so a bulk walk doesn't N+1 across 100+ products. Sales callers omit
// this and let the walker query via `client` as before.
export type WalkLookups = {
  getSupply?: (id: string) => Promise<SupplyInfo | null> | SupplyInfo | null;
  getPreparation?: (id: string) => Promise<PreparationInfo | null> | PreparationInfo | null;
  getDefaultModifier?: (groupId: string) => Promise<ResolvedModifier | null> | ResolvedModifier | null;
};

export type WalkOptions = {
  client: PrismaLike;
  storageResolver: StorageResolver;
  visited: Set<string>;
  slotContext: SlotContext | null;
  lookups?: WalkLookups;
};

export type WalkResult = {
  aggregate: Aggregate;
  errors: WalkError[];
};

/**
 * Walk a recipe and accumulate per-(supply, storage) base-unit requirements.
 *
 * This is the shared primitive for sale-time deduction and the availability
 * engine — keeping a single implementation guarantees that "what we deduct"
 * and "what we say is available" never drift apart.
 *
 * Soft errors (missing default, unknown supply, unresolved storage, cycles,
 * config bugs) are returned in `errors` instead of thrown. Strict callers
 * (sales) inspect `errors` after the walk and throw on any entry; permissive
 * callers (availability) surface a `unknown` status per product.
 *
 *   - PRODUCT type lines are NOT handled here — the caller short-circuits them.
 *   - SWAP slots (RecipeItem with modifier_group_id) are filled by the customer
 *     selection from `slotContext.selectedByGroupId`, falling back to the
 *     group's is_default modifier when nothing was picked.
 *   - Nested preparations recurse with a null slotContext — slots are
 *     top-level only.
 *   - Storage resolver exceptions propagate (sales relies on this).
 */
export async function walkRecipeRequirements(
  items: RecipeItemRow[],
  multiplier: Decimal,
  options: WalkOptions,
): Promise<WalkResult> {
  const aggregate: Aggregate = new Map();
  const errors: WalkError[] = [];
  await accumulate(items, multiplier, aggregate, errors, options);
  return { aggregate, errors };
}

async function fetchSupply(
  client: PrismaLike,
  lookups: WalkLookups | undefined,
  supplyId: string,
): Promise<SupplyInfo | null> {
  if (lookups?.getSupply) return lookups.getSupply(supplyId);
  return client.supply.findUnique({
    where: { id: supplyId },
    select: { content_per_unit: true, content_unit: true, deleted_at: true },
  });
}

async function fetchPreparation(
  client: PrismaLike,
  lookups: WalkLookups | undefined,
  preparationId: string,
): Promise<PreparationInfo | null> {
  if (lookups?.getPreparation) return lookups.getPreparation(preparationId);
  return client.product.findUnique({
    where: { id: preparationId },
    select: {
      id: true,
      type: true,
      recipe: {
        select: { yield_quantity: true, yield_unit: true, items: true },
      },
    },
  });
}

async function fetchDefaultModifier(
  client: PrismaLike,
  lookups: WalkLookups | undefined,
  groupId: string,
): Promise<ResolvedModifier | null> {
  if (lookups?.getDefaultModifier) return lookups.getDefaultModifier(groupId);
  return loadDefaultModifier(client, groupId);
}

async function accumulate(
  items: RecipeItemRow[],
  multiplier: Decimal,
  agg: Aggregate,
  errors: WalkError[],
  opts: WalkOptions,
): Promise<void> {
  const { client, storageResolver, visited, slotContext, lookups } = opts;

  for (const item of items) {
    if (item.modifier_group_id) {
      if (!slotContext) {
        errors.push({
          kind: 'bad-config',
          message:
            'Modifier-group recipe lines are only supported at the top level of a DISH recipe',
          modifier_id: item.modifier_group_id,
        });
        continue;
      }
      let modifier = slotContext.selectedByGroupId.get(item.modifier_group_id);
      if (!modifier) {
        const fallback = await fetchDefaultModifier(
          client,
          lookups,
          item.modifier_group_id,
        );
        if (!fallback) {
          errors.push({
            kind: 'missing-default',
            message: `Modifier group ${item.modifier_group_id} has no is_default modifier and the customer didn't pick one — cannot deduct for this recipe line`,
            modifier_id: item.modifier_group_id,
          });
          continue;
        }
        modifier = fallback;
      } else {
        slotContext.consumedGroupIds.add(item.modifier_group_id);
      }
      const override = slotContext.overrides.get(modifier.id);
      const scaledRecipeQty = new Decimal(item.quantity).mul(multiplier);
      await accumulateSwapSlot(
        client,
        lookups,
        modifier,
        override,
        scaledRecipeQty,
        item.unit,
        new Decimal(item.waste_pct),
        slotContext.lineQty,
        storageResolver,
        agg,
        errors,
        slotContext.productId,
      );
      continue;
    }

    if (item.supply_id) {
      const supply = await fetchSupply(client, lookups, item.supply_id);
      if (!supply || supply.deleted_at) {
        errors.push({
          kind: 'unknown-supply',
          message: `Recipe references unknown supply ${item.supply_id}`,
          supply_id: item.supply_id,
        });
        continue;
      }
      let base: Decimal;
      try {
        base = convertRecipeQuantityToBase(
          new Decimal(item.quantity).mul(multiplier),
          item.unit,
          item.waste_pct,
          supply,
        );
      } catch (err) {
        errors.push({
          kind: 'bad-config',
          message: err instanceof Error ? err.message : String(err),
          supply_id: item.supply_id,
        });
        continue;
      }
      const storageId = await storageResolver(item.supply_id);
      if (!storageId) {
        errors.push({
          kind: 'unresolved-storage',
          message: `No storage resolved for supply ${item.supply_id}`,
          supply_id: item.supply_id,
        });
        continue;
      }
      addDraw(agg, item.supply_id, storageId, base);
      continue;
    }

    if (item.preparation_id) {
      if (visited.has(item.preparation_id)) {
        errors.push({
          kind: 'cycle',
          message: `Preparation cycle detected via ${item.preparation_id}`,
          preparation_id: item.preparation_id,
        });
        continue;
      }
      const prep = await fetchPreparation(client, lookups, item.preparation_id);
      if (!prep || prep.type !== ProductType.PREPARATION) {
        errors.push({
          kind: 'bad-config',
          message: `preparation_id ${item.preparation_id} does not reference a PREPARATION product`,
          preparation_id: item.preparation_id,
        });
        continue;
      }
      if (!prep.recipe) {
        errors.push({
          kind: 'bad-config',
          message: `Preparation ${item.preparation_id} has no recipe`,
          preparation_id: item.preparation_id,
        });
        continue;
      }
      let factor: Decimal;
      try {
        factor = computePreparationFactor(
          new Decimal(item.quantity).mul(multiplier),
          item.unit,
          item.waste_pct,
          prep.recipe,
        );
      } catch (err) {
        errors.push({
          kind: 'bad-config',
          message: err instanceof Error ? err.message : String(err),
          preparation_id: item.preparation_id,
        });
        continue;
      }
      visited.add(item.preparation_id);
      // SWAP slots only at the top — nested preparations cannot host them.
      await accumulate(prep.recipe.items, factor, agg, errors, {
        ...opts,
        slotContext: null,
      });
      visited.delete(item.preparation_id);
      continue;
    }

    errors.push({
      kind: 'invalid-recipe-item',
      message:
        'Recipe item must reference exactly one of supply_id, preparation_id, or modifier_group_id',
    });
  }
}

async function accumulateSwapSlot(
  client: PrismaLike,
  lookups: WalkLookups | undefined,
  modifier: ResolvedModifier,
  override: OverrideRow | undefined,
  recipeQty: Decimal,
  recipeUnit: string,
  recipeWastePct: Decimal,
  lineQty: Decimal,
  storageResolver: StorageResolver,
  agg: Aggregate,
  errors: WalkError[],
  productId: string,
): Promise<void> {
  if (!modifier.supply_id) {
    // Informational SWAP ("No milk") — intentionally deducts nothing.
    return;
  }
  const supply = await fetchSupply(client, lookups, modifier.supply_id);
  if (!supply || supply.deleted_at) {
    errors.push({
      kind: 'unknown-supply',
      message: `Modifier ${modifier.id} references unknown supply ${modifier.supply_id}`,
      supply_id: modifier.supply_id,
      modifier_id: modifier.id,
    });
    return;
  }
  let base: Decimal;
  try {
    if (override && override.override_type === ModifierOverrideType.FIXED_QTY) {
      if (override.override_quantity == null || override.override_unit == null) {
        errors.push({
          kind: 'bad-config',
          message: `Override for product ${productId} + modifier ${modifier.id} is FIXED_QTY but missing quantity/unit`,
          modifier_id: modifier.id,
        });
        return;
      }
      base = convertRecipeQuantityToBase(
        new Decimal(override.override_quantity).mul(lineQty),
        override.override_unit,
        0,
        supply,
      );
    } else {
      const ratio =
        override &&
        override.override_type === ModifierOverrideType.RATIO &&
        override.override_ratio != null
          ? new Decimal(override.override_ratio)
          : new Decimal(modifier.ratio);
      base = convertRecipeQuantityToBase(
        recipeQty.mul(ratio),
        recipeUnit,
        recipeWastePct,
        supply,
      );
    }
  } catch (err) {
    errors.push({
      kind: 'bad-config',
      message: err instanceof Error ? err.message : String(err),
      supply_id: modifier.supply_id,
      modifier_id: modifier.id,
    });
    return;
  }
  const storageId = await storageResolver(modifier.supply_id);
  if (!storageId) {
    errors.push({
      kind: 'unresolved-storage',
      message: `No storage resolved for supply ${modifier.supply_id}`,
      supply_id: modifier.supply_id,
      modifier_id: modifier.id,
    });
    return;
  }
  addDraw(agg, modifier.supply_id, storageId, base);
}

export async function loadDefaultModifier(
  client: PrismaLike,
  groupId: string,
): Promise<ResolvedModifier | null> {
  const row = await client.modifier.findFirst({
    where: { group_id: groupId, is_default: true, active: true },
    select: {
      id: true,
      group_id: true,
      supply_id: true,
      supply_quantity: true,
      supply_unit: true,
      ratio: true,
      is_default: true,
      group: { select: { type: true } },
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    group_id: row.group_id,
    group_type: row.group.type,
    supply_id: row.supply_id,
    supply_quantity: row.supply_quantity,
    supply_unit: row.supply_unit,
    ratio: row.ratio,
    is_default: row.is_default,
  };
}
