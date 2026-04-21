import { Prisma, ProductType, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { Decimal } from '../../lib/decimal.js';
import {
  convertRecipeQuantityToBase,
  computePreparationFactor,
} from '../recipes/cost-engine.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

export interface OrderedItemInput {
  product_id: string;
  variant_id?: string | null;
  quantity?: number;
  modifier_ids?: string[];
}

export interface DeductedSupply {
  supply_id: string;
  storage_id: string;
  quantity: string;
  unit_cost: string;
  remaining: string;
  went_negative: boolean;
}

export interface DeductSaleResult {
  order_id: string;
  deductions: DeductedSupply[];
  warnings: string[];
}

export interface DeductSaleOptions {
  pos_register_id?: string | null;
  // When provided, the deduction runs inside the caller's transaction instead
  // of opening a new one. The payment flow needs this so the order status
  // flip, payment insert, register update, and inventory deduction all live
  // or die together.
  client?: Tx;
}

type RecipeItemRow = {
  supply_id: string | null;
  preparation_id: string | null;
  quantity: Prisma.Decimal;
  unit: string;
  waste_pct: Prisma.Decimal;
};

// Aggregate supply draws keyed by "supplyId|storageId" so a single SALE
// movement covers every recipe line / modifier / line-repeat that hits the
// same supply at the same storage.
type Aggregate = Map<string, Decimal>;
const key = (supplyId: string, storageId: string): string => `${supplyId}|${storageId}`;

function addDraw(agg: Aggregate, supplyId: string, storageId: string, qty: Decimal): void {
  const k = key(supplyId, storageId);
  agg.set(k, (agg.get(k) ?? new Decimal(0)).add(qty));
}

// Pick the most specific DeductionRule. Order: (station + register) → station
// → register → default (both null). Returns null if no rule exists — callers
// then fall back to per-supply last-received storage.
async function resolveRuleStorage(
  client: PrismaLike,
  stationId: string | null | undefined,
  posRegisterId: string | null | undefined,
): Promise<string | null> {
  if (stationId && posRegisterId) {
    const both = await client.deductionRule.findFirst({
      where: { station_id: stationId, pos_register_id: posRegisterId },
      select: { storage_id: true },
    });
    if (both) return both.storage_id;
  }
  if (stationId) {
    const byStation = await client.deductionRule.findFirst({
      where: { station_id: stationId, pos_register_id: null },
      select: { storage_id: true },
    });
    if (byStation) return byStation.storage_id;
  }
  if (posRegisterId) {
    const byRegister = await client.deductionRule.findFirst({
      where: { station_id: null, pos_register_id: posRegisterId },
      select: { storage_id: true },
    });
    if (byRegister) return byRegister.storage_id;
  }
  const fallback = await client.deductionRule.findFirst({
    where: { station_id: null, pos_register_id: null },
    select: { storage_id: true },
  });
  return fallback?.storage_id ?? null;
}

// Per-supply fallback: where did this supply last arrive?
async function resolveStorageFromLastPurchase(
  client: PrismaLike,
  supplyId: string,
): Promise<string> {
  const last = await client.stockMovement.findFirst({
    where: { supply_id: supplyId, type: StockMovementType.PURCHASE },
    orderBy: { created_at: 'desc' },
    select: { storage_id: true },
  });
  if (!last) {
    throw new BadRequestError(
      `No deduction rule matched and supply ${supplyId} has no purchase history — cannot determine storage to deduct from`,
    );
  }
  return last.storage_id;
}

async function resolveRecipeForLine(
  client: PrismaLike,
  productId: string,
  variantId: string | null | undefined,
): Promise<{ items: RecipeItemRow[] }> {
  const recipe = variantId
    ? await client.recipe.findUnique({ where: { variant_id: variantId }, include: { items: true } })
    : await client.recipe.findUnique({ where: { product_id: productId }, include: { items: true } });
  if (!recipe) {
    throw new BadRequestError(
      variantId
        ? `Variant ${variantId} has no recipe`
        : `Product ${productId} has no recipe`,
    );
  }
  return { items: recipe.items };
}

// Walk a recipe and add each supply draw (scaled by `multiplier`) to `agg`.
// Preparations recurse with their own factor (requested qty / yield qty).
async function accumulateRecipe(
  client: PrismaLike,
  items: RecipeItemRow[],
  multiplier: Decimal,
  storageResolver: (supplyId: string) => Promise<string>,
  agg: Aggregate,
  visited: Set<string>,
): Promise<void> {
  for (const item of items) {
    if (item.supply_id) {
      const supply = await client.supply.findUnique({
        where: { id: item.supply_id },
        select: { content_per_unit: true, content_unit: true, deleted_at: true },
      });
      if (!supply || supply.deleted_at) {
        throw new BadRequestError(`Recipe references unknown supply ${item.supply_id}`);
      }
      const base = convertRecipeQuantityToBase(
        new Decimal(item.quantity).mul(multiplier),
        item.unit,
        item.waste_pct,
        supply,
      );
      const storageId = await storageResolver(item.supply_id);
      addDraw(agg, item.supply_id, storageId, base);
      continue;
    }
    if (item.preparation_id) {
      if (visited.has(item.preparation_id)) {
        throw new BadRequestError(
          `Preparation cycle detected via ${item.preparation_id}`,
        );
      }
      const prep = await client.product.findUnique({
        where: { id: item.preparation_id },
        select: {
          id: true,
          type: true,
          recipe: {
            select: {
              yield_quantity: true,
              yield_unit: true,
              items: true,
            },
          },
        },
      });
      if (!prep || prep.type !== ProductType.PREPARATION) {
        throw new BadRequestError(
          `preparation_id ${item.preparation_id} does not reference a PREPARATION product`,
        );
      }
      if (!prep.recipe) {
        throw new BadRequestError(
          `Preparation ${item.preparation_id} has no recipe`,
        );
      }
      const factor = computePreparationFactor(
        new Decimal(item.quantity).mul(multiplier),
        item.unit,
        item.waste_pct,
        prep.recipe,
      );
      visited.add(item.preparation_id);
      await accumulateRecipe(client, prep.recipe.items, factor, storageResolver, agg, visited);
      visited.delete(item.preparation_id);
      continue;
    }
    throw new BadRequestError('Recipe item has neither supply_id nor preparation_id');
  }
}

/**
 * Deduct inventory for a completed sale.
 *
 * For each ordered line:
 *   - PRODUCT: decrement 1 × line.quantity from the product's linked supply.
 *   - DISH: walk the variant (or product) recipe; preparations recurse.
 *   - modifiers: if configured with a supply triplet, draw that quantity too.
 *
 * All draws are aggregated per (supply, storage) and persisted as a single
 * StockMovement row of type SALE. Stock is allowed to go negative — the café
 * must keep operating — but the caller gets a warning so the variance can be
 * surfaced in a report later.
 *
 * Everything runs inside a single Prisma transaction.
 */
export async function deductSaleFromInventory(
  orderedItems: OrderedItemInput[],
  stationId: string | null | undefined,
  orderId: string,
  options: DeductSaleOptions = {},
): Promise<DeductSaleResult> {
  if (orderedItems.length === 0) {
    throw new BadRequestError('No ordered items provided');
  }

  const run = async (tx: Tx): Promise<DeductSaleResult> => {
    const ruleStorageId = await resolveRuleStorage(
      tx,
      stationId,
      options.pos_register_id,
    );

    // Per-supply storage fallbacks are expensive — memoize.
    const fallbackCache = new Map<string, string>();
    const storageResolver = async (supplyId: string): Promise<string> => {
      if (ruleStorageId) return ruleStorageId;
      const cached = fallbackCache.get(supplyId);
      if (cached) return cached;
      const storage = await resolveStorageFromLastPurchase(tx, supplyId);
      fallbackCache.set(supplyId, storage);
      return storage;
    };

    const agg: Aggregate = new Map();

    for (const line of orderedItems) {
      const lineQty = new Decimal(line.quantity ?? 1);
      if (lineQty.lte(0)) {
        throw new BadRequestError('Line quantity must be positive');
      }

      const product = await tx.product.findUnique({
        where: { id: line.product_id },
        select: { id: true, type: true, supply_id: true, deleted_at: true },
      });
      if (!product || product.deleted_at) {
        throw new NotFoundError(`Product ${line.product_id}`);
      }
      if (product.type === ProductType.PREPARATION) {
        throw new BadRequestError(
          `Product ${line.product_id} is a PREPARATION and cannot be sold`,
        );
      }

      if (product.type === ProductType.PRODUCT) {
        if (line.variant_id) {
          throw new BadRequestError('PRODUCT items do not have variants');
        }
        if (!product.supply_id) {
          throw new BadRequestError(
            `Product ${line.product_id} has no linked supply — cannot deduct inventory`,
          );
        }
        const storageId = await storageResolver(product.supply_id);
        addDraw(agg, product.supply_id, storageId, lineQty);
      } else {
        // DISH — variant recipe takes precedence when supplied; otherwise fall
        // back to the product-level recipe (a DISH without variants).
        const recipe = await resolveRecipeForLine(tx, line.product_id, line.variant_id);
        await accumulateRecipe(tx, recipe.items, lineQty, storageResolver, agg, new Set());
      }

      if (line.modifier_ids?.length) {
        for (const modifierId of line.modifier_ids) {
          const modifier = await tx.modifier.findUnique({
            where: { id: modifierId },
            select: {
              id: true,
              supply_id: true,
              supply_quantity: true,
              supply_unit: true,
            },
          });
          if (!modifier) {
            throw new BadRequestError(`Modifier ${modifierId} not found`);
          }
          if (!modifier.supply_id) continue; // informational modifier ("extra hot")
          if (modifier.supply_quantity == null || modifier.supply_unit == null) {
            throw new BadRequestError(
              `Modifier ${modifierId} is not configured for inventory deduction`,
            );
          }
          const supply = await tx.supply.findUnique({
            where: { id: modifier.supply_id },
            select: { content_per_unit: true, content_unit: true, deleted_at: true },
          });
          if (!supply || supply.deleted_at) {
            throw new BadRequestError(
              `Modifier ${modifierId} references unknown supply ${modifier.supply_id}`,
            );
          }
          const base = convertRecipeQuantityToBase(
            new Decimal(modifier.supply_quantity).mul(lineQty),
            modifier.supply_unit,
            0,
            supply,
          );
          const storageId = await storageResolver(modifier.supply_id);
          addDraw(agg, modifier.supply_id, storageId, base);
        }
      }
    }

    const deductions: DeductedSupply[] = [];
    const warnings: string[] = [];

    for (const [aggKey, quantity] of agg) {
      const [supplyId, storageId] = aggKey.split('|');
      if (!supplyId || !storageId) continue;

      const supply = await tx.supply.findUniqueOrThrow({
        where: { id: supplyId },
        select: { average_cost: true },
      });

      const existing = await tx.storageStock.findUnique({
        where: {
          supply_id_storage_id: { supply_id: supplyId, storage_id: storageId },
        },
        select: { quantity: true },
      });
      const before = new Decimal(existing?.quantity ?? 0);
      const remaining = before.sub(quantity);
      const wentNegative = remaining.isNegative();

      await tx.storageStock.upsert({
        where: {
          supply_id_storage_id: { supply_id: supplyId, storage_id: storageId },
        },
        create: {
          supply_id: supplyId,
          storage_id: storageId,
          quantity: quantity.neg(),
        },
        update: { quantity: { decrement: quantity } },
      });

      await tx.stockMovement.create({
        data: {
          supply_id: supplyId,
          storage_id: storageId,
          type: StockMovementType.SALE,
          quantity: quantity.neg(),
          reference_type: 'Order',
          reference_id: orderId,
          unit_cost: supply.average_cost,
        },
      });

      deductions.push({
        supply_id: supplyId,
        storage_id: storageId,
        quantity: quantity.toString(),
        unit_cost: new Decimal(supply.average_cost).toString(),
        remaining: remaining.toString(),
        went_negative: wentNegative,
      });
      if (wentNegative) {
        warnings.push(
          `Stock for supply ${supplyId} at storage ${storageId} went negative (${remaining.toString()})`,
        );
      }
    }

    return { order_id: orderId, deductions, warnings };
  };

  if (options.client) return run(options.client);
  return prisma.$transaction(run);
}
