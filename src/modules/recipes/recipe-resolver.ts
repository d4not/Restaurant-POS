import { BaseUnit, ContentUnit, Prisma, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { BadRequestError } from '../../lib/errors.js';
import { computePreparationFactor, convertRecipeQuantityToBase } from './cost-engine.js';

type PrismaLike = Prisma.TransactionClient | typeof prisma;

export interface ResolvedIngredient {
  supply_id: string;
  supply_name: string;
  base_unit: BaseUnit;
  content_per_unit: string | null; // serialized Decimal for transport
  content_unit: ContentUnit | null;
  base_qty: string; // Decimal in the supply's base unit, ready to write to WriteOff
  content_qty: string | null; // friendly default for the UI (in content_unit)
}

interface SupplyRow {
  id: string;
  name: string;
  base_unit: BaseUnit;
  content_per_unit: Prisma.Decimal | null;
  content_unit: ContentUnit | null;
}

/**
 * Resolve a Product (and optional ProductVariant) to its raw-supply ingredient
 * list, expanding preparations recursively. The recipe quantities are scaled
 * to "1 serving" and inflated by per-line waste_pct so the returned base_qty
 * is what the sales engine would actually deduct on one sale.
 *
 * Used by the Log Waste flow to surface "what's in this drink?" so a barista
 * can record a partial waste (e.g., wasted the espresso shot + syrup but not
 * the milk) without doing unit math.
 *
 * Lines that reference `modifier_group_id` are intentionally skipped: the
 * customer-side modifier choice doesn't have a deterministic default at waste
 * time, and the barista will add modifier supplies manually if they were
 * actually used. Cycles via preparation references are detected and rejected.
 */
export async function resolveRecipeIngredients(
  productId: string,
  variantId?: string | null,
): Promise<ResolvedIngredient[]> {
  const agg = new Map<string, { supply: SupplyRow; base_qty: Decimal }>();
  await accumulate(prisma, productId, variantId ?? null, new Decimal(1), new Set<string>(), agg);

  const out: ResolvedIngredient[] = [];
  for (const { supply, base_qty } of agg.values()) {
    const contentQty =
      supply.content_per_unit && supply.content_unit
        ? base_qty.mul(new Decimal(supply.content_per_unit))
        : null;
    out.push({
      supply_id: supply.id,
      supply_name: supply.name,
      base_unit: supply.base_unit,
      content_per_unit: supply.content_per_unit ? supply.content_per_unit.toString() : null,
      content_unit: supply.content_unit,
      base_qty: base_qty.toString(),
      content_qty: contentQty ? contentQty.toString() : null,
    });
  }
  out.sort((a, b) => a.supply_name.localeCompare(b.supply_name));
  return out;
}

async function accumulate(
  client: PrismaLike,
  productId: string,
  variantId: string | null,
  scale: Decimal,
  visited: Set<string>,
  agg: Map<string, { supply: SupplyRow; base_qty: Decimal }>,
): Promise<void> {
  const recipe = variantId
    ? await client.recipe.findUnique({
        where: { variant_id: variantId },
        include: { items: true },
      })
    : await client.recipe.findUnique({
        where: { product_id: productId },
        include: { items: true },
      });
  if (!recipe) {
    throw new BadRequestError(
      variantId
        ? `Variant ${variantId} has no recipe`
        : `Product ${productId} has no recipe`,
    );
  }
  if (visited.has(recipe.id)) {
    throw new BadRequestError('Recipe cycle detected via preparation references');
  }
  visited.add(recipe.id);

  for (const item of recipe.items) {
    if (item.modifier_group_id) continue;

    if (item.supply_id) {
      const supply = await client.supply.findUnique({
        where: { id: item.supply_id },
        select: {
          id: true,
          name: true,
          base_unit: true,
          content_per_unit: true,
          content_unit: true,
        },
      });
      if (!supply) {
        throw new BadRequestError(
          `Recipe item references unknown supply ${item.supply_id}`,
        );
      }
      const perServing = convertRecipeQuantityToBase(
        item.quantity,
        item.unit,
        item.waste_pct,
        { content_per_unit: supply.content_per_unit, content_unit: supply.content_unit },
      );
      const scaled = perServing.mul(scale);
      const existing = agg.get(supply.id);
      if (existing) {
        existing.base_qty = existing.base_qty.add(scaled);
      } else {
        agg.set(supply.id, { supply, base_qty: scaled });
      }
      continue;
    }

    if (item.preparation_id) {
      const prepProduct = await client.product.findUnique({
        where: { id: item.preparation_id },
        select: { id: true, type: true, recipe: { select: { id: true, yield_quantity: true, yield_unit: true } } },
      });
      if (!prepProduct || prepProduct.type !== ProductType.PREPARATION) {
        throw new BadRequestError(
          `Recipe item references a non-preparation product ${item.preparation_id}`,
        );
      }
      if (!prepProduct.recipe) {
        throw new BadRequestError(
          `Preparation ${item.preparation_id} has no recipe defined`,
        );
      }
      const factor = computePreparationFactor(
        item.quantity,
        item.unit,
        item.waste_pct,
        prepProduct.recipe,
      );
      await accumulate(
        client,
        prepProduct.id,
        null,
        scale.mul(factor),
        visited,
        agg,
      );
      continue;
    }

    throw new BadRequestError(
      `Recipe item ${item.id} has neither supply_id, preparation_id, nor modifier_group_id`,
    );
  }
}
