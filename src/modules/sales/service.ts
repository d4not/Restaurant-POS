import {
  ModifierGroupType,
  Prisma,
  ProductType,
  StockMovementType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { Decimal } from '../../lib/decimal.js';
import { convertRecipeQuantityToBase } from '../recipes/cost-engine.js';
import {
  addDraw,
  walkRecipeRequirements,
  type Aggregate,
  type OverrideRow,
  type RecipeItemRow,
  type ResolvedModifier,
  type WalkError,
} from '../recipes/recipe-walker.js';
import {
  resolveRuleStorage,
  resolveStorageFromLastPurchase,
} from '../deduction-rules/service.js';

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

async function loadModifiersForLine(
  client: PrismaLike,
  modifierIds: string[],
): Promise<ResolvedModifier[]> {
  if (modifierIds.length === 0) return [];
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
      group: {
        select: { type: true },
      },
    },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  // Preserve caller order — repeat IDs repeat the modifier's effect.
  return modifierIds.map((id) => {
    const row = byId.get(id);
    if (!row) throw new BadRequestError(`Modifier ${id} not found`);
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
  });
}

async function loadOverridesForLine(
  client: PrismaLike,
  productId: string,
  modifierIds: string[],
): Promise<Map<string, OverrideRow>> {
  if (modifierIds.length === 0) return new Map();
  const rows = await client.modifierProductOverride.findMany({
    where: { product_id: productId, modifier_id: { in: modifierIds } },
  });
  const byModifierId = new Map<string, OverrideRow>();
  for (const r of rows) byModifierId.set(r.modifier_id, r);
  return byModifierId;
}

// Sales walks recipes through the same primitive used by the availability
// engine. Soft errors from the walker (missing default, unknown supply, bad
// config) are fatal at deduction time — surface the first one as a 400 so the
// caller can fix the configuration before they retry the sale.
function throwOnWalkErrors(errors: WalkError[]): void {
  if (errors.length === 0) return;
  throw new BadRequestError(errors[0].message);
}

function mergeAggregate(target: Aggregate, source: Aggregate): void {
  for (const [k, qty] of source) {
    const existing = target.get(k);
    target.set(k, existing ? existing.add(qty) : qty);
  }
}

/**
 * Deduct inventory for a completed sale.
 *
 * For each ordered line:
 *   - PRODUCT: decrement 1 × line.quantity from the product's linked supply.
 *   - DISH: walk the variant (or product) recipe; preparations recurse.
 *   - Recipe line with modifier_group_id: deduct the selected SWAP modifier's
 *     supply (or the group's is_default when the customer picked nothing) at
 *     recipe_qty × ratio × overrides.
 *   - ADD modifiers: draw the configured supply_quantity on top of the recipe.
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

    // Per-supply storage fallbacks are expensive — memoize. resolveStorageFromLastPurchase
    // throws when no purchase exists, which propagates out of the walker — sales
    // must NOT silently swallow that case.
    const fallbackCache = new Map<string, string>();
    const storageResolver = async (supplyId: string): Promise<string | null> => {
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
        if (!storageId) {
          throw new BadRequestError(
            `No storage resolved for supply ${product.supply_id}`,
          );
        }
        addDraw(agg, product.supply_id, storageId, lineQty);

        // PRODUCT lines don't honor modifiers for inventory deduction (they're
        // packaged items with no recipe). Skip modifier processing entirely.
        continue;
      }

      // DISH — variant recipe takes precedence when supplied; otherwise fall
      // back to the product-level recipe (a DISH without variants).
      const recipe = await resolveRecipeForLine(tx, line.product_id, line.variant_id);

      const modifierIds = line.modifier_ids ?? [];
      const modifiers = await loadModifiersForLine(tx, modifierIds);
      const overrides = await loadOverridesForLine(tx, line.product_id, modifierIds);

      // Index SWAP modifiers by their group so recipe slots can find them.
      // Two modifiers from the same SWAP group on one line would try to fill
      // the same slot with different supplies — a customer can only pick one
      // milk, so refuse rather than silently double-deduct.
      const selectedByGroupId = new Map<string, ResolvedModifier>();
      for (const m of modifiers) {
        if (m.group_type !== ModifierGroupType.SWAP) continue;
        if (selectedByGroupId.has(m.group_id)) {
          throw new BadRequestError(
            `Multiple SWAP modifiers from group ${m.group_id} on product ${line.product_id} — only one modifier per SWAP group is allowed per line`,
          );
        }
        selectedByGroupId.set(m.group_id, m);
      }

      const consumedGroupIds = new Set<string>();

      const { aggregate: lineAgg, errors: walkErrors } = await walkRecipeRequirements(
        recipe.items,
        lineQty,
        {
          client: tx,
          storageResolver,
          visited: new Set(),
          slotContext: {
            productId: line.product_id,
            lineQty,
            selectedByGroupId,
            overrides,
            consumedGroupIds,
          },
        },
      );
      throwOnWalkErrors(walkErrors);
      mergeAggregate(agg, lineAgg);

      // Every SWAP modifier picked by the customer must correspond to a
      // recipe slot (a RecipeItem with matching modifier_group_id). Otherwise
      // the modifier is attached to a product whose recipe has no slot for
      // it — a misconfiguration we surface loudly rather than silently no-op.
      for (const [groupId, modifier] of selectedByGroupId) {
        if (!consumedGroupIds.has(groupId)) {
          throw new BadRequestError(
            `SWAP modifier ${modifier.id} belongs to group ${groupId} but the recipe for product ${line.product_id} has no slot for that group`,
          );
        }
      }

      // ADD modifiers still stack on top of the recipe.
      for (const modifier of modifiers) {
        if (modifier.group_type !== ModifierGroupType.ADD) continue;
        if (!modifier.supply_id) continue;
        if (modifier.supply_quantity == null || modifier.supply_unit == null) {
          throw new BadRequestError(
            `Modifier ${modifier.id} is not configured for inventory deduction`,
          );
        }
        const supply = await tx.supply.findUnique({
          where: { id: modifier.supply_id },
          select: { content_per_unit: true, content_unit: true, deleted_at: true },
        });
        if (!supply || supply.deleted_at) {
          throw new BadRequestError(
            `Modifier ${modifier.id} references unknown supply ${modifier.supply_id}`,
          );
        }
        const base = convertRecipeQuantityToBase(
          new Decimal(modifier.supply_quantity).mul(lineQty),
          modifier.supply_unit,
          0,
          supply,
        );
        const storageId = await storageResolver(modifier.supply_id);
        if (!storageId) {
          throw new BadRequestError(
            `No storage resolved for supply ${modifier.supply_id}`,
          );
        }
        addDraw(agg, modifier.supply_id, storageId, base);
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
