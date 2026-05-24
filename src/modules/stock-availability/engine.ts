import { ModifierGroupType, Prisma, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { convertRecipeQuantityToBase } from '../recipes/cost-engine.js';
import {
  walkRecipeRequirements,
  type Aggregate,
  type PreparationInfo,
  type RecipeItemRow,
  type ResolvedModifier,
  type StorageResolver,
  type SupplyInfo,
  type WalkLookups,
} from '../recipes/recipe-walker.js';
import { resolveRuleStorage } from '../deduction-rules/service.js';
import type {
  AvailabilityStatus,
  BulkAvailabilityResult,
  LimitingSupply,
  LineAvailabilityInput,
  LineAvailabilityResult,
  ModifierAvailability,
  ProductAvailability,
} from './types.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

export interface AvailabilityOpts {
  registerId?: string | null;
  stationId?: string | null;
}

type StockEntry = { qty: Decimal; min_stock: Decimal | null };

interface SupplyMeta extends SupplyInfo {
  id: string;
  name: string;
}

interface BulkCaches {
  supplyById: Map<string, SupplyMeta>;
  storageById: Map<string, { id: string; name: string }>;
  stockBySupplyStorage: Map<string, StockEntry>;
  stockBySupply: Map<string, Array<{ storage_id: string } & StockEntry>>;
  prepById: Map<string, PreparationInfo>;
  defaultModByGroup: Map<string, ResolvedModifier>;
}

/**
 * Compute availability for the entire active menu.
 *
 * Strategy:
 *   1. Six findMany calls up front — supplies, storages, stocks, preparations,
 *      default modifiers, products+variants+recipes. After this, the walker
 *      runs entirely in-memory (no per-recipe-item I/O).
 *   2. For each product:
 *        - PRODUCT type: read its linked supply's stock at the resolved
 *          storage (or per-supply best storage when no register rule).
 *        - DISH type: one walker invocation per (variant or product-without-
 *          variants), with default modifiers filling SWAP slots.
 *   3. For each active modifier with supply_id + supply_quantity: independent
 *      max-additions — the modifier picker disables OUT modifiers but does NOT
 *      take the parent product down with them (per product rule).
 *
 * Errors from the walker are NOT thrown — they become `unknown` status on the
 * product so the admin sees a fixable config bug instead of a 500.
 */
export async function computeAvailabilityBulk(
  client: PrismaLike,
  opts: AvailabilityOpts = {},
): Promise<BulkAvailabilityResult> {
  const registerStorageId = await resolveRuleStorage(
    client,
    opts.stationId ?? null,
    opts.registerId ?? null,
  );

  const caches = await loadCaches(client);
  const storageResolver = buildBulkStorageResolver(registerStorageId, caches);
  const lookups = buildWalkLookups(caches);

  const products = await client.product.findMany({
    where: {
      active: true,
      deleted_at: null,
      type: { in: [ProductType.PRODUCT, ProductType.DISH] },
    },
    include: {
      recipe: { include: { items: true } },
      variants: {
        where: { active: true },
        orderBy: { display_order: 'asc' },
        include: { recipe: { include: { items: true } } },
      },
    },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
  });

  const productResults: ProductAvailability[] = [];

  for (const product of products) {
    if (product.type === ProductType.PRODUCT) {
      productResults.push(
        computeProductTypeAvailability(product, registerStorageId, caches),
      );
      continue;
    }

    // DISH
    if (product.variants.length === 0) {
      const recipeItems = product.recipe?.items ?? [];
      productResults.push(
        await computeDishAvailability(
          client,
          product,
          null,
          recipeItems,
          lookups,
          storageResolver,
          caches,
        ),
      );
      continue;
    }
    for (const variant of product.variants) {
      const recipeItems = variant.recipe?.items ?? product.recipe?.items ?? [];
      productResults.push(
        await computeDishAvailability(
          client,
          product,
          variant,
          recipeItems,
          lookups,
          storageResolver,
          caches,
        ),
      );
    }
  }

  const modifierResults = await computeAllModifierAvailability(
    client,
    storageResolver,
    caches,
  );

  return {
    generated_at: new Date().toISOString(),
    resolved_storage_id: registerStorageId,
    products: productResults,
    modifiers: modifierResults,
  };
}

/**
 * Single-line check for `POST /orders/:id/items`. Walks just the requested
 * recipe (with the customer's modifier selection so SWAP slots resolve
 * correctly) and returns the line's availability. Used as backend authority
 * against stale cache exploits — the terminal grid hides OUT cards already,
 * but the server still rejects if a race lets a stale tap through.
 */
export async function computeAvailabilityForLine(
  client: PrismaLike,
  input: LineAvailabilityInput,
  opts: AvailabilityOpts = {},
): Promise<LineAvailabilityResult> {
  const registerStorageId = await resolveRuleStorage(
    client,
    opts.stationId ?? null,
    opts.registerId ?? null,
  );

  const product = await client.product.findUnique({
    where: { id: input.product_id },
    select: {
      id: true,
      name: true,
      type: true,
      supply_id: true,
      deleted_at: true,
    },
  });
  if (!product || product.deleted_at) {
    return errorResult(`Product ${input.product_id} not found`);
  }
  if (product.type === ProductType.PREPARATION) {
    return errorResult(
      `Product ${input.product_id} is a PREPARATION and cannot be sold`,
    );
  }

  const quantity = input.quantity ?? 1;

  if (product.type === ProductType.PRODUCT) {
    if (!product.supply_id) {
      return errorResult('PRODUCT has no linked supply');
    }
    return computeLinePRODUCT(
      client,
      product.supply_id,
      quantity,
      registerStorageId,
    );
  }

  // DISH
  const recipe = input.variant_id
    ? await client.recipe.findUnique({
        where: { variant_id: input.variant_id },
        include: { items: true },
      })
    : await client.recipe.findUnique({
        where: { product_id: product.id },
        include: { items: true },
      });
  if (!recipe) {
    return errorResult(
      input.variant_id
        ? `Variant ${input.variant_id} has no recipe`
        : `Product ${product.id} has no recipe`,
    );
  }

  const modifierIds = input.modifier_ids ?? [];
  const modifiers = modifierIds.length
    ? await loadModifiers(client, modifierIds)
    : [];

  // Build SWAP selection map. Reject double-picks from the same group so the
  // check matches the sale-time invariant.
  const selectedByGroupId = new Map<string, ResolvedModifier>();
  for (const m of modifiers) {
    if (m.group_type !== ModifierGroupType.SWAP) continue;
    if (selectedByGroupId.has(m.group_id)) {
      return errorResult(
        `Multiple SWAP modifiers from group ${m.group_id} on this line`,
      );
    }
    selectedByGroupId.set(m.group_id, m);
  }

  const overrides = modifierIds.length
    ? await loadOverrides(client, product.id, modifierIds)
    : new Map();
  const consumedGroupIds = new Set<string>();

  const fallbackCache = new Map<string, string | null>();
  const storageResolver = buildLineStorageResolver(
    client,
    registerStorageId,
    fallbackCache,
  );

  const { aggregate, errors } = await walkRecipeRequirements(
    recipe.items,
    new Decimal(quantity),
    {
      client,
      storageResolver,
      visited: new Set(),
      slotContext: {
        productId: product.id,
        lineQty: new Decimal(quantity),
        selectedByGroupId,
        overrides,
        consumedGroupIds,
      },
    },
  );

  if (errors.length > 0) {
    return errorResult(errors[0].message);
  }

  // Add ADD-modifier requirements
  for (const m of modifiers) {
    if (m.group_type !== ModifierGroupType.ADD) continue;
    if (!m.supply_id) continue;
    if (m.supply_quantity == null || m.supply_unit == null) {
      return errorResult(
        `Modifier ${m.id} is not configured for inventory deduction`,
      );
    }
    const supply = await client.supply.findUnique({
      where: { id: m.supply_id },
      select: { content_per_unit: true, content_unit: true, deleted_at: true },
    });
    if (!supply || supply.deleted_at) {
      return errorResult(`Modifier ${m.id} references unknown supply`);
    }
    let base: Decimal;
    try {
      base = convertRecipeQuantityToBase(
        new Decimal(m.supply_quantity).mul(quantity),
        m.supply_unit,
        0,
        supply,
      );
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
    const storageId = await storageResolver(m.supply_id);
    if (!storageId) {
      return errorResult(`No storage resolved for supply ${m.supply_id}`);
    }
    const k = `${m.supply_id}|${storageId}`;
    aggregate.set(k, (aggregate.get(k) ?? new Decimal(0)).add(base));
  }

  // Evaluate aggregate against current stock. `aggregate` is per-LINE (the
  // walker was called with multiplier=quantity); divide back to per-unit so
  // max_servable can be reported as "max product units we could serve right
  // now", independent of the requested quantity.
  const supplyNames = await loadSupplyNames(client, aggregate);
  const storageNames = await loadStorageNames(client, aggregate);
  let lowFlagged = false;
  let limiting: LimitingSupply | null = null;
  let maxServable = Number.POSITIVE_INFINITY;

  for (const [k, neededForLine] of aggregate) {
    const [supplyId, storageId] = k.split('|');
    if (!supplyId || !storageId) continue;
    const stock = await client.storageStock.findUnique({
      where: { supply_id_storage_id: { supply_id: supplyId, storage_id: storageId } },
      select: { quantity: true, min_stock: true },
    });
    const qty = new Decimal(stock?.quantity ?? 0);
    const minStock = stock?.min_stock != null ? new Decimal(stock.min_stock) : null;
    if (minStock != null && qty.lte(minStock)) lowFlagged = true;
    if (neededForLine.lte(0)) continue;
    const neededPerUnit = neededForLine.div(quantity);
    const unitsServable = qty.div(neededPerUnit).floor().toNumber();
    if (unitsServable < maxServable) {
      maxServable = unitsServable;
      limiting = {
        supply_id: supplyId,
        supply_name: supplyNames.get(supplyId) ?? supplyId,
        current_qty: qty.toString(),
        needed_per_unit: neededPerUnit.toString(),
        storage_id: storageId,
        storage_name: storageNames.get(storageId) ?? null,
      };
    }
  }

  const finalServable = Number.isFinite(maxServable) ? maxServable : 0;
  const isOut = finalServable < quantity;
  const isLow = !isOut && lowFlagged;
  const status: AvailabilityStatus = isOut ? 'out' : isLow ? 'low' : 'available';
  return {
    status,
    max_servable: finalServable,
    limiting: status === 'available' ? null : limiting,
    config_errors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Caches and lookups

async function loadCaches(client: PrismaLike): Promise<BulkCaches> {
  const [supplies, storages, storageStocks, preparations, defaultModifiers] =
    await Promise.all([
      client.supply.findMany({
        where: { deleted_at: null },
        select: {
          id: true,
          name: true,
          content_per_unit: true,
          content_unit: true,
          deleted_at: true,
        },
      }),
      client.storage.findMany({
        where: { active: true },
        select: { id: true, name: true },
      }),
      client.storageStock.findMany({
        select: {
          supply_id: true,
          storage_id: true,
          quantity: true,
          min_stock: true,
        },
      }),
      client.product.findMany({
        where: { type: ProductType.PREPARATION, deleted_at: null },
        select: {
          id: true,
          type: true,
          recipe: {
            select: { yield_quantity: true, yield_unit: true, items: true },
          },
        },
      }),
      client.modifier.findMany({
        where: { is_default: true, active: true },
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
      }),
    ]);

  const supplyById = new Map(supplies.map((s) => [s.id, s as SupplyMeta]));
  const storageById = new Map(storages.map((s) => [s.id, s]));
  const stockBySupplyStorage = new Map<string, StockEntry>();
  const stockBySupply = new Map<string, Array<{ storage_id: string } & StockEntry>>();
  for (const s of storageStocks) {
    const qty = new Decimal(s.quantity);
    const min = s.min_stock != null ? new Decimal(s.min_stock) : null;
    const entry: StockEntry = { qty, min_stock: min };
    stockBySupplyStorage.set(`${s.supply_id}|${s.storage_id}`, entry);
    if (!stockBySupply.has(s.supply_id)) stockBySupply.set(s.supply_id, []);
    stockBySupply.get(s.supply_id)!.push({ storage_id: s.storage_id, ...entry });
  }
  const prepById = new Map<string, PreparationInfo>(
    preparations.map((p) => [p.id, p as PreparationInfo]),
  );
  const defaultModByGroup = new Map<string, ResolvedModifier>();
  for (const m of defaultModifiers) {
    defaultModByGroup.set(m.group_id, {
      id: m.id,
      group_id: m.group_id,
      group_type: m.group.type,
      supply_id: m.supply_id,
      supply_quantity: m.supply_quantity,
      supply_unit: m.supply_unit,
      ratio: m.ratio,
      is_default: m.is_default,
    });
  }

  return {
    supplyById,
    storageById,
    stockBySupplyStorage,
    stockBySupply,
    prepById,
    defaultModByGroup,
  };
}

function buildBulkStorageResolver(
  registerStorageId: string | null,
  caches: BulkCaches,
): StorageResolver {
  return async (supplyId) => {
    if (registerStorageId) return registerStorageId;
    const stocks = caches.stockBySupply.get(supplyId);
    if (!stocks || stocks.length === 0) return null;
    // "Best storage" = storage with the most stock. Matches the intent of
    // sales' last-purchase fallback for the availability case where we don't
    // know the deduction target ahead of time.
    return stocks.reduce((best, s) => (s.qty.gt(best.qty) ? s : best), stocks[0])
      .storage_id;
  };
}

function buildLineStorageResolver(
  client: PrismaLike,
  registerStorageId: string | null,
  fallbackCache: Map<string, string | null>,
): StorageResolver {
  return async (supplyId) => {
    if (registerStorageId) return registerStorageId;
    if (fallbackCache.has(supplyId)) return fallbackCache.get(supplyId) ?? null;
    // Prefer the last-purchased storage (matches sale-time fallback semantics
    // so an addOrderItem check picks the same target as the eventual deduct).
    const last = await client.stockMovement.findFirst({
      where: { supply_id: supplyId, type: 'PURCHASE' },
      orderBy: { created_at: 'desc' },
      select: { storage_id: true },
    });
    if (last) {
      fallbackCache.set(supplyId, last.storage_id);
      return last.storage_id;
    }
    // No purchase movement yet (early-life supply, fresh seed, or manual
    // stock adjust) — fall back to the storage that currently holds the most
    // of this supply so availability still has something to evaluate.
    const stocks = await client.storageStock.findMany({
      where: { supply_id: supplyId },
      orderBy: { quantity: 'desc' },
      select: { storage_id: true },
      take: 1,
    });
    const result = stocks[0]?.storage_id ?? null;
    fallbackCache.set(supplyId, result);
    return result;
  };
}

function buildWalkLookups(caches: BulkCaches): WalkLookups {
  return {
    getSupply: (id) => caches.supplyById.get(id) ?? null,
    getPreparation: (id) => caches.prepById.get(id) ?? null,
    getDefaultModifier: (id) => caches.defaultModByGroup.get(id) ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Product-type computations

function computeProductTypeAvailability(
  product: {
    id: string;
    name: string;
    type: ProductType;
    supply_id: string | null;
  },
  registerStorageId: string | null,
  caches: BulkCaches,
): ProductAvailability {
  if (!product.supply_id) {
    return {
      product_id: product.id,
      variant_id: null,
      product_name: product.name,
      variant_name: null,
      product_type: 'PRODUCT',
      status: 'unknown',
      max_servable: 0,
      limiting: null,
      config_errors: ['PRODUCT has no linked supply_id'],
    };
  }

  let storageId: string | null = registerStorageId;
  let stock: StockEntry | undefined;
  if (storageId) {
    stock = caches.stockBySupplyStorage.get(`${product.supply_id}|${storageId}`);
  } else {
    const stocks = caches.stockBySupply.get(product.supply_id);
    if (stocks && stocks.length > 0) {
      const best = stocks.reduce((b, s) => (s.qty.gt(b.qty) ? s : b), stocks[0]);
      storageId = best.storage_id;
      stock = { qty: best.qty, min_stock: best.min_stock };
    }
  }

  if (!storageId) {
    return {
      product_id: product.id,
      variant_id: null,
      product_name: product.name,
      variant_name: null,
      product_type: 'PRODUCT',
      status: 'out',
      max_servable: 0,
      limiting: null,
      config_errors: [],
    };
  }

  const qty = stock?.qty ?? new Decimal(0);
  const minStock = stock?.min_stock ?? null;
  const maxServable = qty.floor().toNumber();
  const isOut = maxServable < 1;
  const isLow = !isOut && minStock != null && qty.lte(minStock);
  const status: AvailabilityStatus = isOut ? 'out' : isLow ? 'low' : 'available';
  return {
    product_id: product.id,
    variant_id: null,
    product_name: product.name,
    variant_name: null,
    product_type: 'PRODUCT',
    status,
    max_servable: maxServable,
    limiting:
      status === 'available'
        ? null
        : buildLimitingFromCaches(caches, product.supply_id, storageId, qty, new Decimal(1)),
    config_errors: [],
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DISH computations

async function computeDishAvailability(
  client: PrismaLike,
  product: { id: string; name: string },
  variant: { id: string; name: string } | null,
  recipeItems: RecipeItemRow[],
  lookups: WalkLookups,
  storageResolver: StorageResolver,
  caches: BulkCaches,
): Promise<ProductAvailability> {
  const base: ProductAvailability = {
    product_id: product.id,
    variant_id: variant?.id ?? null,
    product_name: product.name,
    variant_name: variant?.name ?? null,
    product_type: 'DISH',
    status: 'available',
    max_servable: 0,
    limiting: null,
    config_errors: [],
  };

  if (recipeItems.length === 0) {
    return { ...base, status: 'unknown', config_errors: ['DISH has no recipe'] };
  }

  const selectedByGroupId = new Map<string, ResolvedModifier>();
  const consumedGroupIds = new Set<string>();
  const { aggregate, errors } = await walkRecipeRequirements(
    recipeItems,
    new Decimal(1),
    {
      client,
      storageResolver,
      visited: new Set(),
      lookups,
      slotContext: {
        productId: product.id,
        lineQty: new Decimal(1),
        selectedByGroupId,
        overrides: new Map(),
        consumedGroupIds,
      },
    },
  );

  if (errors.length > 0) {
    return {
      ...base,
      status: 'unknown',
      config_errors: errors.map((e) => e.message),
    };
  }

  return finishFromAggregate(base, aggregate, caches);
}

function finishFromAggregate(
  base: ProductAvailability,
  aggregate: Aggregate,
  caches: BulkCaches,
): ProductAvailability {
  let maxServable = Infinity;
  let limiting: LimitingSupply | null = null;
  let lowFlagged = false;

  for (const [k, needed] of aggregate) {
    const [supplyId, storageId] = k.split('|');
    if (!supplyId || !storageId) continue;
    const stock = caches.stockBySupplyStorage.get(k);
    const qty = stock?.qty ?? new Decimal(0);
    const minStock = stock?.min_stock ?? null;
    if (needed.lte(0)) continue;
    const ratioServings = qty.div(needed).floor().toNumber();
    if (ratioServings < maxServable) {
      maxServable = ratioServings;
      limiting = buildLimitingFromCaches(caches, supplyId, storageId, qty, needed);
    }
    if (minStock != null && qty.lte(minStock)) lowFlagged = true;
  }

  const isOut = !Number.isFinite(maxServable) ? false : maxServable < 1;
  const finalServable = Number.isFinite(maxServable) ? maxServable : 0;
  const isLow = !isOut && lowFlagged;
  const status: AvailabilityStatus = isOut ? 'out' : isLow ? 'low' : 'available';
  return {
    ...base,
    status,
    max_servable: isOut ? 0 : finalServable,
    limiting: status === 'available' ? null : limiting,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Modifier-independent availability

async function computeAllModifierAvailability(
  client: PrismaLike,
  storageResolver: StorageResolver,
  caches: BulkCaches,
): Promise<ModifierAvailability[]> {
  const modifiers = await client.modifier.findMany({
    where: { active: true, supply_id: { not: null } },
    select: {
      id: true,
      name: true,
      group_id: true,
      supply_id: true,
      supply_quantity: true,
      supply_unit: true,
      ratio: true,
      is_default: true,
      group: { select: { id: true, name: true, type: true } },
    },
  });

  const results: ModifierAvailability[] = [];
  for (const m of modifiers) {
    if (!m.supply_id) continue;
    if (m.supply_quantity == null || m.supply_unit == null) {
      // ADD modifier without supply_quantity = informational; SWAP modifier
      // without it = ratio-driven and only matters against the parent recipe's
      // qty. Either way, we can't compute a "max additions on its own" number.
      results.push({
        modifier_id: m.id,
        modifier_name: m.name,
        group_id: m.group.id,
        group_name: m.group.name,
        group_type: m.group.type,
        status: 'available',
        max_additions: Number.POSITIVE_INFINITY,
        limiting: null,
      });
      continue;
    }
    const supply = caches.supplyById.get(m.supply_id);
    if (!supply) {
      results.push({
        modifier_id: m.id,
        modifier_name: m.name,
        group_id: m.group.id,
        group_name: m.group.name,
        group_type: m.group.type,
        status: 'unknown',
        max_additions: 0,
        limiting: null,
      });
      continue;
    }
    let neededPer: Decimal;
    try {
      neededPer = convertRecipeQuantityToBase(
        new Decimal(m.supply_quantity),
        m.supply_unit,
        0,
        supply,
      );
    } catch {
      results.push({
        modifier_id: m.id,
        modifier_name: m.name,
        group_id: m.group.id,
        group_name: m.group.name,
        group_type: m.group.type,
        status: 'unknown',
        max_additions: 0,
        limiting: null,
      });
      continue;
    }
    const storageId = await storageResolver(m.supply_id);
    if (!storageId) {
      results.push({
        modifier_id: m.id,
        modifier_name: m.name,
        group_id: m.group.id,
        group_name: m.group.name,
        group_type: m.group.type,
        status: 'out',
        max_additions: 0,
        limiting: null,
      });
      continue;
    }
    const stock = caches.stockBySupplyStorage.get(`${m.supply_id}|${storageId}`);
    const qty = stock?.qty ?? new Decimal(0);
    const minStock = stock?.min_stock ?? null;
    const maxAdds = neededPer.lte(0)
      ? Number.POSITIVE_INFINITY
      : qty.div(neededPer).floor().toNumber();
    const isOut = maxAdds < 1;
    const isLow = !isOut && minStock != null && qty.lte(minStock);
    const status: AvailabilityStatus = isOut ? 'out' : isLow ? 'low' : 'available';
    results.push({
      modifier_id: m.id,
      modifier_name: m.name,
      group_id: m.group.id,
      group_name: m.group.name,
      group_type: m.group.type,
      status,
      max_additions: Number.isFinite(maxAdds) ? maxAdds : 0,
      limiting:
        status === 'available'
          ? null
          : buildLimitingFromCaches(caches, m.supply_id, storageId, qty, neededPer),
    });
  }
  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// Line-check helpers (used by addOrderItem authority check)

async function computeLinePRODUCT(
  client: PrismaLike,
  supplyId: string,
  quantity: number,
  registerStorageId: string | null,
): Promise<LineAvailabilityResult> {
  let storageId: string | null = registerStorageId;
  if (!storageId) {
    const last = await client.stockMovement.findFirst({
      where: { supply_id: supplyId, type: 'PURCHASE' },
      orderBy: { created_at: 'desc' },
      select: { storage_id: true },
    });
    storageId = last?.storage_id ?? null;
  }
  if (!storageId) {
    return {
      status: 'out',
      max_servable: 0,
      limiting: null,
      config_errors: [],
    };
  }
  const [stock, supply, storage] = await Promise.all([
    client.storageStock.findUnique({
      where: { supply_id_storage_id: { supply_id: supplyId, storage_id: storageId } },
      select: { quantity: true, min_stock: true },
    }),
    client.supply.findUnique({
      where: { id: supplyId },
      select: { name: true },
    }),
    client.storage.findUnique({
      where: { id: storageId },
      select: { name: true },
    }),
  ]);
  const qty = new Decimal(stock?.quantity ?? 0);
  const minStock = stock?.min_stock != null ? new Decimal(stock.min_stock) : null;
  const maxServable = qty.floor().toNumber();
  const isOut = maxServable < quantity;
  const isLow = !isOut && minStock != null && qty.lte(minStock);
  const status: AvailabilityStatus = isOut ? 'out' : isLow ? 'low' : 'available';
  return {
    status,
    max_servable: maxServable,
    limiting:
      status === 'available'
        ? null
        : {
            supply_id: supplyId,
            supply_name: supply?.name ?? supplyId,
            current_qty: qty.toString(),
            needed_per_unit: '1',
            storage_id: storageId,
            storage_name: storage?.name ?? null,
          },
    config_errors: [],
  };
}

async function loadModifiers(
  client: PrismaLike,
  modifierIds: string[],
): Promise<ResolvedModifier[]> {
  const rows = await client.modifier.findMany({
    where: { id: { in: modifierIds } },
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
  const byId = new Map(rows.map((r) => [r.id, r]));
  return modifierIds
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => r != null)
    .map((row) => ({
      id: row.id,
      group_id: row.group_id,
      group_type: row.group.type,
      supply_id: row.supply_id,
      supply_quantity: row.supply_quantity,
      supply_unit: row.supply_unit,
      ratio: row.ratio,
      is_default: row.is_default,
    }));
}

async function loadOverrides(
  client: PrismaLike,
  productId: string,
  modifierIds: string[],
): Promise<Map<string, import('../recipes/recipe-walker.js').OverrideRow>> {
  const rows = await client.modifierProductOverride.findMany({
    where: { product_id: productId, modifier_id: { in: modifierIds } },
  });
  const map = new Map<string, import('../recipes/recipe-walker.js').OverrideRow>();
  for (const r of rows) map.set(r.modifier_id, r);
  return map;
}

async function loadSupplyNames(
  client: PrismaLike,
  aggregate: Aggregate,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const k of aggregate.keys()) {
    const [supplyId] = k.split('|');
    if (supplyId) ids.add(supplyId);
  }
  if (ids.size === 0) return new Map();
  const rows = await client.supply.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

async function loadStorageNames(
  client: PrismaLike,
  aggregate: Aggregate,
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const k of aggregate.keys()) {
    const [, storageId] = k.split('|');
    if (storageId) ids.add(storageId);
  }
  if (ids.size === 0) return new Map();
  const rows = await client.storage.findMany({
    where: { id: { in: [...ids] } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((r) => [r.id, r.name]));
}

function buildLimitingFromCaches(
  caches: BulkCaches,
  supplyId: string,
  storageId: string,
  currentQty: Decimal,
  neededPerUnit: Decimal,
): LimitingSupply {
  return {
    supply_id: supplyId,
    supply_name: caches.supplyById.get(supplyId)?.name ?? supplyId,
    current_qty: currentQty.toString(),
    needed_per_unit: neededPerUnit.toString(),
    storage_id: storageId,
    storage_name: caches.storageById.get(storageId)?.name ?? null,
  };
}

function errorResult(message: string): LineAvailabilityResult {
  return {
    status: 'unknown',
    max_servable: 0,
    limiting: null,
    config_errors: [message],
  };
}
