import { ContentUnit, Prisma, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { BadRequestError } from '../../lib/errors.js';

type PrismaLike = Prisma.TransactionClient | typeof prisma;

// --- Unit normalization -----------------------------------------------------

const UNIT_ALIASES: Record<string, ContentUnit | 'PIECE'> = {
  ml: ContentUnit.ML,
  milliliter: ContentUnit.ML,
  milliliters: ContentUnit.ML,
  l: ContentUnit.L,
  liter: ContentUnit.L,
  liters: ContentUnit.L,
  g: ContentUnit.G,
  gram: ContentUnit.G,
  grams: ContentUnit.G,
  kg: ContentUnit.KG,
  kilogram: ContentUnit.KG,
  kilograms: ContentUnit.KG,
  oz: ContentUnit.OZ,
  ounce: ContentUnit.OZ,
  ounces: ContentUnit.OZ,
  'fl oz': ContentUnit.FL_OZ,
  fl_oz: ContentUnit.FL_OZ,
  floz: ContentUnit.FL_OZ,
  'fluid ounce': ContentUnit.FL_OZ,
  'fluid ounces': ContentUnit.FL_OZ,
  piece: 'PIECE',
  pieces: 'PIECE',
  pc: 'PIECE',
  pcs: 'PIECE',
  unit: 'PIECE',
  units: 'PIECE',
};

export function normalizeUnit(raw: string): ContentUnit | 'PIECE' {
  const key = raw.trim().toLowerCase();
  const normalized = UNIT_ALIASES[key];
  if (!normalized) {
    throw new BadRequestError(`Unrecognized recipe unit: "${raw}"`);
  }
  return normalized;
}

// Family membership and conversion rates *to the canonical family unit*.
// Volume canonical = ML, Weight canonical = G.
const VOLUME_TO_ML: Partial<Record<ContentUnit, Decimal>> = {
  [ContentUnit.ML]: new Decimal(1),
  [ContentUnit.L]: new Decimal(1000),
  [ContentUnit.FL_OZ]: new Decimal('29.5735'),
};

const WEIGHT_TO_G: Partial<Record<ContentUnit, Decimal>> = {
  [ContentUnit.G]: new Decimal(1),
  [ContentUnit.KG]: new Decimal(1000),
  [ContentUnit.OZ]: new Decimal('28.3495'),
};

function familyOf(unit: ContentUnit): 'volume' | 'weight' {
  if (VOLUME_TO_ML[unit] !== undefined) return 'volume';
  if (WEIGHT_TO_G[unit] !== undefined) return 'weight';
  throw new BadRequestError(`Unknown unit family: ${unit}`);
}

/**
 * Convert `quantity` from unit `from` to unit `to`. Units must belong to the
 * same measurement family (volume or weight). Cross-family (e.g. ml → g)
 * would require density and is rejected.
 */
export function convertQuantity(
  quantity: Decimal | string | number,
  from: ContentUnit,
  to: ContentUnit,
): Decimal {
  const qty = new Decimal(quantity);
  if (from === to) return qty;
  const fromFamily = familyOf(from);
  const toFamily = familyOf(to);
  if (fromFamily !== toFamily) {
    throw new BadRequestError(
      `Cannot convert ${from} to ${to} — different measurement families`,
    );
  }
  const table = fromFamily === 'volume' ? VOLUME_TO_ML : WEIGHT_TO_G;
  const canonicalQty = qty.mul(table[from]!);
  return canonicalQty.div(table[to]!);
}

// --- Cost computation --------------------------------------------------------

type RecipeItemRow = {
  supply_id: string | null;
  preparation_id: string | null;
  modifier_group_id: string | null;
  quantity: Prisma.Decimal;
  unit: string;
  waste_pct: Prisma.Decimal;
};

type RecipeRow = {
  id: string;
  product_id: string | null;
  variant_id: string | null;
  yield_quantity: Prisma.Decimal | null;
  yield_unit: string | null;
  items: RecipeItemRow[];
};

/**
 * Convert a recipe-line quantity (e.g. "200 ml") into the supply's base unit
 * (e.g. bottles), inflating by waste. Shared between cost computation and the
 * sale-deduction engine.
 *
 *   base_qty    = quantity_in_content_unit / content_per_unit    (if measurable)
 *   base_qty    = quantity                                        (if piece-type)
 *   adjusted_qty = base_qty / (1 - waste_pct/100)
 */
export function convertRecipeQuantityToBase(
  quantity: Decimal | string | number,
  recipeUnit: string,
  wastePct: Decimal | string | number,
  supply: {
    content_per_unit: Prisma.Decimal | null;
    content_unit: ContentUnit | null;
  },
): Decimal {
  const qty = new Decimal(quantity);
  const normalized = normalizeUnit(recipeUnit);
  let baseQty: Decimal;

  // Use explicit null check rather than truthiness: a legacy Supply row with
  // content_per_unit = 0 would be falsy and silently fall through to the
  // piece-mode branch. Here we surface it as an error up-front instead.
  const contentPerUnit =
    supply.content_per_unit != null ? new Decimal(supply.content_per_unit) : null;
  const hasMeasurable = contentPerUnit !== null && supply.content_unit !== null;

  if (hasMeasurable) {
    if (contentPerUnit!.lte(0)) {
      throw new BadRequestError(
        'Supply.content_per_unit must be positive — fix the supply before costing recipes',
      );
    }
    if (normalized === 'PIECE') {
      throw new BadRequestError(
        'Recipe unit "piece" is incompatible with a measurable supply',
      );
    }
    const qtyInContentUnit = convertQuantity(qty, normalized, supply.content_unit!);
    baseQty = qtyInContentUnit.div(contentPerUnit!);
  } else {
    if (normalized !== 'PIECE') {
      throw new BadRequestError(
        'Supply has no content_per_unit; recipe must use a piece/unit quantity',
      );
    }
    baseQty = qty;
  }

  const wasteFactor = new Decimal(1).sub(new Decimal(wastePct).div(100));
  if (wasteFactor.lte(0)) {
    throw new BadRequestError('waste_pct must be less than 100');
  }
  return baseQty.div(wasteFactor);
}

/**
 * Cost of a single raw-supply line: convert the recipe quantity into the
 * supply's base unit, inflate by waste, then multiply by the supply's WAC.
 *
 *   line_cost = convertRecipeQuantityToBase(...) * average_cost
 */
export function computeSupplyItemCost(
  quantity: Decimal | string | number,
  recipeUnit: string,
  wastePct: Decimal | string | number,
  supply: {
    content_per_unit: Prisma.Decimal | null;
    content_unit: ContentUnit | null;
    average_cost: Prisma.Decimal;
  },
): Decimal {
  const adjusted = convertRecipeQuantityToBase(quantity, recipeUnit, wastePct, supply);
  return adjusted.mul(new Decimal(supply.average_cost));
}

/**
 * How much of a preparation's recipe to consume given a request like
 * "30 ml of simple syrup" against a recipe that yields "150 ml". The factor
 * scales every ingredient in the preparation's recipe (waste on the calling
 * line is applied on top).
 */
export function computePreparationFactor(
  quantity: Decimal | string | number,
  recipeUnit: string,
  wastePct: Decimal | string | number,
  preparation: {
    yield_quantity: Prisma.Decimal | null;
    yield_unit: string | null;
  },
): Decimal {
  if (preparation.yield_quantity == null || preparation.yield_unit == null) {
    throw new BadRequestError(
      'Preparation recipe is missing yield_quantity / yield_unit — set them before using it as an ingredient',
    );
  }
  const yieldQty = new Decimal(preparation.yield_quantity);
  if (yieldQty.lte(0)) {
    throw new BadRequestError('Preparation yield_quantity must be positive');
  }
  const normalizedRecipe = normalizeUnit(recipeUnit);
  const normalizedYield = normalizeUnit(preparation.yield_unit);
  let qtyInYield: Decimal;
  if (normalizedRecipe === 'PIECE' || normalizedYield === 'PIECE') {
    if (normalizedRecipe !== normalizedYield) {
      throw new BadRequestError(
        `Cannot convert ${recipeUnit} to preparation yield unit ${preparation.yield_unit}`,
      );
    }
    qtyInYield = new Decimal(quantity);
  } else {
    qtyInYield = convertQuantity(new Decimal(quantity), normalizedRecipe, normalizedYield);
  }
  const wasteFactor = new Decimal(1).sub(new Decimal(wastePct).div(100));
  if (wasteFactor.lte(0)) throw new BadRequestError('waste_pct must be less than 100');
  return qtyInYield.div(yieldQty).div(wasteFactor);
}

/**
 * Cost for a line that references a sub-recipe (preparation).
 *
 *   line_cost = computePreparationFactor(...) * preparation_total_cost
 *
 * `preparationRecipeCost` is the total cost of the preparation's recipe (the
 * caller computes it recursively). Waste on the line still applies on top.
 */
export function computePreparationItemCost(
  quantity: Decimal | string | number,
  recipeUnit: string,
  wastePct: Decimal | string | number,
  preparation: {
    yield_quantity: Prisma.Decimal | null;
    yield_unit: string | null;
  },
  preparationRecipeCost: Decimal,
): Decimal {
  const factor = computePreparationFactor(quantity, recipeUnit, wastePct, preparation);
  return factor.mul(preparationRecipeCost);
}

/**
 * Walk a recipe and sum line costs. Follows preparation references recursively;
 * `visited` detects cycles (A uses B uses A) and throws before overflowing.
 * Returns the total recipe cost in the same unit as Supply.average_cost
 * (centavos).
 */
export async function computeRecipeCost(
  client: PrismaLike,
  recipeId: string,
  visited: Set<string> = new Set(),
): Promise<Decimal> {
  if (visited.has(recipeId)) {
    throw new BadRequestError('Recipe cycle detected via preparation references');
  }
  visited.add(recipeId);

  const recipe = (await client.recipe.findUnique({
    where: { id: recipeId },
    include: { items: true },
  })) as RecipeRow | null;
  if (!recipe) throw new BadRequestError(`Recipe ${recipeId} not found`);

  let total = new Decimal(0);

  for (const item of recipe.items) {
    if (item.supply_id) {
      const supply = await client.supply.findUnique({
        where: { id: item.supply_id },
        select: { content_per_unit: true, content_unit: true, average_cost: true },
      });
      if (!supply) {
        throw new BadRequestError(`Recipe item references unknown supply ${item.supply_id}`);
      }
      total = total.add(
        computeSupplyItemCost(item.quantity, item.unit, item.waste_pct, supply),
      );
      continue;
    }

    // modifier_group_id slots are costed against the group's is_default
    // modifier supply at ratio 1.0 — the "what the customer gets if they pick
    // nothing" case. Per-modifier ratios only matter at sale time.
    if (item.modifier_group_id) {
      const group = await client.modifierGroup.findUnique({
        where: { id: item.modifier_group_id },
        select: {
          id: true,
          modifiers: {
            where: { is_default: true },
            select: {
              id: true,
              supply: {
                select: {
                  content_per_unit: true,
                  content_unit: true,
                  average_cost: true,
                },
              },
            },
          },
        },
      });
      if (!group) {
        throw new BadRequestError(
          `Recipe item references unknown modifier group ${item.modifier_group_id}`,
        );
      }
      const defaultMod = group.modifiers[0];
      if (!defaultMod) {
        throw new BadRequestError(
          `Modifier group ${item.modifier_group_id} has no is_default modifier — recipe cannot be costed`,
        );
      }
      if (!defaultMod.supply) {
        throw new BadRequestError(
          `Default modifier in group ${item.modifier_group_id} has no supply — recipe cannot be costed`,
        );
      }
      total = total.add(
        computeSupplyItemCost(item.quantity, item.unit, item.waste_pct, defaultMod.supply),
      );
      continue;
    }

    if (item.preparation_id) {
      const prepProduct = await client.product.findUnique({
        where: { id: item.preparation_id },
        select: { id: true, type: true, recipe: true },
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
      const prepRecipeRow = await client.recipe.findUnique({
        where: { id: prepProduct.recipe.id },
        select: { id: true, yield_quantity: true, yield_unit: true },
      });
      if (!prepRecipeRow) {
        throw new BadRequestError(
          `Preparation ${item.preparation_id} recipe not found`,
        );
      }

      const prepCost = await computeRecipeCost(client, prepRecipeRow.id, visited);
      total = total.add(
        computePreparationItemCost(
          item.quantity,
          item.unit,
          item.waste_pct,
          prepRecipeRow,
          prepCost,
        ),
      );
      continue;
    }

    // Unreachable — the schema validation guarantees exactly one of
    // supply_id/preparation_id is set. Surface it loudly if the invariant
    // ever breaks rather than silently returning a wrong cost.
    throw new BadRequestError(
      `Recipe item ${String(item.supply_id)} has neither supply_id nor preparation_id`,
    );
  }

  return total;
}

/**
 * After a recipe changes, persist the recomputed cost onto the owning
 * Product or ProductVariant row plus the derived food_cost_pct and markup.
 * Idempotent — safe to call on recipe create, edit, or preparation updates.
 */
export async function applyRecipeCost(
  client: PrismaLike,
  recipeId: string,
): Promise<Decimal> {
  const cost = await computeRecipeCost(client, recipeId);
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    select: { product_id: true, variant_id: true },
  });
  if (!recipe) throw new BadRequestError(`Recipe ${recipeId} not found`);

  if (recipe.variant_id) {
    const variant = await client.productVariant.findUnique({
      where: { id: recipe.variant_id },
      select: { sell_price: true },
    });
    if (!variant) throw new BadRequestError('Variant missing for recipe');
    const sellPrice = new Decimal(variant.sell_price);
    const foodCostPct = sellPrice.isZero() ? new Decimal(0) : cost.div(sellPrice).mul(100);
    await client.productVariant.update({
      where: { id: recipe.variant_id },
      data: { recipe_cost: cost, food_cost_pct: foodCostPct },
    });
  } else if (recipe.product_id) {
    const product = await client.product.findUnique({
      where: { id: recipe.product_id },
      select: { sell_price: true },
    });
    if (!product) throw new BadRequestError('Product missing for recipe');
    const sellPrice = product.sell_price ? new Decimal(product.sell_price) : null;
    const foodCostPct =
      sellPrice && !sellPrice.isZero() ? cost.div(sellPrice).mul(100) : new Decimal(0);
    const markup = cost.isZero() || !sellPrice ? new Decimal(0) : sellPrice.div(cost);
    await client.product.update({
      where: { id: recipe.product_id },
      data: { recipe_cost: cost, food_cost_pct: foodCostPct, markup },
    });
  }

  return cost;
}

/**
 * When a preparation's recipe changes, every recipe that references that
 * preparation needs its cached cost refreshed. This walks one level of
 * dependents and applies costs; the caller is responsible for calling this
 * after preparation edits.
 */
export async function cascadeRecipeCostFromPreparation(
  client: PrismaLike,
  preparationProductId: string,
  visited: Set<string> = new Set(),
): Promise<void> {
  const dependents = await client.recipeItem.findMany({
    where: { preparation_id: preparationProductId },
    select: { recipe_id: true },
    distinct: ['recipe_id'],
  });
  for (const dep of dependents) {
    if (visited.has(dep.recipe_id)) continue;
    visited.add(dep.recipe_id);
    await applyRecipeCost(client, dep.recipe_id);
    // If the dependent recipe belongs to another preparation, cascade further.
    const parentRecipe = await client.recipe.findUnique({
      where: { id: dep.recipe_id },
      select: { product: { select: { id: true, type: true } } },
    });
    if (parentRecipe?.product?.type === ProductType.PREPARATION) {
      await cascadeRecipeCostFromPreparation(client, parentRecipe.product.id, visited);
    }
  }
}
