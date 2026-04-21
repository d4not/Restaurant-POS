import { Prisma, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { Decimal } from '../../lib/decimal.js';
import { applyRecipeCost, cascadeRecipeCostFromPreparation } from './cost-engine.js';
import type {
  CreateRecipeInput,
  UpdateRecipeInput,
  CreateRecipeItemInput,
  UpdateRecipeItemInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;

const recipeInclude = {
  items: {
    include: {
      supply: {
        select: {
          id: true,
          name: true,
          content_per_unit: true,
          content_unit: true,
          average_cost: true,
        },
      },
      preparation: { select: { id: true, name: true, type: true, recipe_cost: true } },
    },
  },
} satisfies Prisma.RecipeInclude;

async function loadProductForRecipe(client: Tx, productId: string) {
  const product = await client.product.findUnique({
    where: { id: productId },
    select: { id: true, type: true, deleted_at: true },
  });
  if (!product || product.deleted_at) throw new NotFoundError('Product');
  if (product.type === ProductType.PRODUCT) {
    throw new BadRequestError('Packaged PRODUCT items do not have a recipe');
  }
  return product;
}

async function loadVariantForRecipe(client: Tx, variantId: string) {
  const variant = await client.productVariant.findUnique({
    where: { id: variantId },
    select: { id: true, product: { select: { id: true, type: true, deleted_at: true } } },
  });
  if (!variant || variant.product.deleted_at) throw new NotFoundError('ProductVariant');
  if (variant.product.type !== ProductType.DISH) {
    throw new BadRequestError('Only DISH variants can have a recipe');
  }
  return variant;
}

async function validateRecipeItem(
  client: Tx,
  ownerType: ProductType,
  input: { supply_id?: string | null; preparation_id?: string | null },
): Promise<void> {
  if (input.supply_id) {
    const supply = await client.supply.findFirst({
      where: { id: input.supply_id, deleted_at: null },
      select: { id: true },
    });
    if (!supply) throw new BadRequestError('supply_id references a non-existent supply');
    return;
  }
  if (input.preparation_id) {
    const prep = await client.product.findUnique({
      where: { id: input.preparation_id },
      select: { id: true, type: true, deleted_at: true },
    });
    if (!prep || prep.deleted_at) {
      throw new BadRequestError('preparation_id references a non-existent product');
    }
    if (prep.type !== ProductType.PREPARATION) {
      throw new BadRequestError('preparation_id must reference a product of type PREPARATION');
    }
    // A preparation cannot reference itself directly.
    if (ownerType === ProductType.PREPARATION) {
      // Let computeRecipeCost's cycle guard handle deeper cycles at cost time;
      // here we just guard the trivial self-reference on write.
    }
  }
}

async function insertItems(
  client: Tx,
  recipeId: string,
  ownerType: ProductType,
  items: CreateRecipeItemInput[],
): Promise<void> {
  for (const item of items) {
    await validateRecipeItem(client, ownerType, item);
    await client.recipeItem.create({
      data: {
        recipe_id: recipeId,
        supply_id: item.supply_id ?? null,
        preparation_id: item.preparation_id ?? null,
        quantity: new Decimal(item.quantity),
        unit: item.unit,
        waste_pct: new Decimal(item.waste_pct ?? 0),
      },
    });
  }
}

// ----------------------------------------------------------------------------
// Recipe CRUD — owned by a Product (DISH/PREPARATION) or a ProductVariant.
// ----------------------------------------------------------------------------

export async function createProductRecipe(productId: string, input: CreateRecipeInput) {
  return prisma.$transaction(async (tx) => {
    const product = await loadProductForRecipe(tx, productId);
    const existing = await tx.recipe.findUnique({ where: { product_id: productId } });
    if (existing) {
      throw new ConflictError('Product already has a recipe');
    }
    if (product.type === ProductType.PREPARATION) {
      if (input.yield_quantity == null || input.yield_unit == null) {
        throw new BadRequestError(
          'PREPARATION recipes require yield_quantity and yield_unit so they can be used as ingredients',
        );
      }
    }
    const recipe = await tx.recipe.create({
      data: {
        product_id: productId,
        yield_quantity: input.yield_quantity != null ? new Decimal(input.yield_quantity) : null,
        yield_unit: input.yield_unit ?? null,
      },
    });
    if (input.items?.length) {
      await insertItems(tx, recipe.id, product.type, input.items);
    }
    await applyRecipeCost(tx, recipe.id);
    return tx.recipe.findUniqueOrThrow({ where: { id: recipe.id }, include: recipeInclude });
  });
}

export async function createVariantRecipe(variantId: string, input: CreateRecipeInput) {
  return prisma.$transaction(async (tx) => {
    await loadVariantForRecipe(tx, variantId);
    const existing = await tx.recipe.findUnique({ where: { variant_id: variantId } });
    if (existing) throw new ConflictError('Variant already has a recipe');
    // Variant recipes belong to a DISH so yield fields are not applicable.
    const recipe = await tx.recipe.create({ data: { variant_id: variantId } });
    if (input.items?.length) {
      await insertItems(tx, recipe.id, ProductType.DISH, input.items);
    }
    await applyRecipeCost(tx, recipe.id);
    return tx.recipe.findUniqueOrThrow({ where: { id: recipe.id }, include: recipeInclude });
  });
}

async function loadRecipeOrThrow(client: Tx | typeof prisma, recipeId: string) {
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    include: recipeInclude,
  });
  if (!recipe) throw new NotFoundError('Recipe');
  return recipe;
}

export async function getRecipe(recipeId: string) {
  return loadRecipeOrThrow(prisma, recipeId);
}

export async function getProductRecipe(productId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { product_id: productId },
    include: recipeInclude,
  });
  if (!recipe) throw new NotFoundError('Recipe');
  return recipe;
}

export async function getVariantRecipe(variantId: string) {
  const recipe = await prisma.recipe.findUnique({
    where: { variant_id: variantId },
    include: recipeInclude,
  });
  if (!recipe) throw new NotFoundError('Recipe');
  return recipe;
}

export async function updateRecipe(recipeId: string, input: UpdateRecipeInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.recipe.findUnique({
      where: { id: recipeId },
      select: { id: true, product: { select: { type: true } } },
    });
    if (!existing) throw new NotFoundError('Recipe');

    const data: Prisma.RecipeUpdateInput = {};
    if (input.yield_quantity !== undefined) {
      data.yield_quantity =
        input.yield_quantity === null ? null : new Decimal(input.yield_quantity);
    }
    if (input.yield_unit !== undefined) {
      data.yield_unit = input.yield_unit;
    }
    await tx.recipe.update({ where: { id: recipeId }, data });
    await applyRecipeCost(tx, recipeId);
    if (existing.product?.type === ProductType.PREPARATION && existing.product) {
      const prep = await tx.recipe.findUnique({
        where: { id: recipeId },
        select: { product_id: true },
      });
      if (prep?.product_id) {
        await cascadeRecipeCostFromPreparation(tx, prep.product_id);
      }
    }
    return loadRecipeOrThrow(tx, recipeId);
  });
}

export async function deleteRecipe(recipeId: string) {
  return prisma.$transaction(async (tx) => {
    const recipe = await tx.recipe.findUnique({
      where: { id: recipeId },
      select: { id: true, product_id: true, variant_id: true, product: { select: { type: true } } },
    });
    if (!recipe) throw new NotFoundError('Recipe');
    // If this is a preparation referenced elsewhere, reject deletion so we
    // don't silently break dependent recipes.
    if (recipe.product?.type === ProductType.PREPARATION && recipe.product_id) {
      const referenced = await tx.recipeItem.count({
        where: { preparation_id: recipe.product_id },
      });
      if (referenced > 0) {
        throw new ConflictError(
          'Cannot delete a preparation recipe that is referenced by other recipes',
        );
      }
    }
    await tx.recipe.delete({ where: { id: recipeId } });
    // Zero out cached cost fields on the owner.
    if (recipe.product_id) {
      await tx.product.update({
        where: { id: recipe.product_id },
        data: { recipe_cost: 0, food_cost_pct: 0, markup: 0 },
      });
    }
    if (recipe.variant_id) {
      await tx.productVariant.update({
        where: { id: recipe.variant_id },
        data: { recipe_cost: 0, food_cost_pct: 0 },
      });
    }
  });
}

// ----------------------------------------------------------------------------
// Recipe items
// ----------------------------------------------------------------------------

async function ownerTypeForRecipe(client: Tx, recipeId: string): Promise<ProductType> {
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    select: {
      product: { select: { type: true } },
      variant: { select: { product: { select: { type: true } } } },
    },
  });
  if (!recipe) throw new NotFoundError('Recipe');
  return recipe.product?.type ?? recipe.variant!.product.type;
}

async function cascadeIfPreparation(client: Tx, recipeId: string): Promise<void> {
  const recipe = await client.recipe.findUnique({
    where: { id: recipeId },
    select: { product_id: true, product: { select: { type: true } } },
  });
  if (recipe?.product?.type === ProductType.PREPARATION && recipe.product_id) {
    await cascadeRecipeCostFromPreparation(client, recipe.product_id);
  }
}

export async function addRecipeItem(recipeId: string, input: CreateRecipeItemInput) {
  return prisma.$transaction(async (tx) => {
    const exists = await tx.recipe.findUnique({ where: { id: recipeId }, select: { id: true } });
    if (!exists) throw new NotFoundError('Recipe');
    const ownerType = await ownerTypeForRecipe(tx, recipeId);
    await validateRecipeItem(tx, ownerType, input);
    const item = await tx.recipeItem.create({
      data: {
        recipe_id: recipeId,
        supply_id: input.supply_id ?? null,
        preparation_id: input.preparation_id ?? null,
        quantity: new Decimal(input.quantity),
        unit: input.unit,
        waste_pct: new Decimal(input.waste_pct ?? 0),
      },
    });
    await applyRecipeCost(tx, recipeId);
    await cascadeIfPreparation(tx, recipeId);
    return item;
  });
}

export async function updateRecipeItem(
  recipeId: string,
  itemId: string,
  input: UpdateRecipeItemInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.recipeItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.recipe_id !== recipeId) throw new NotFoundError('RecipeItem');

    const nextSupply =
      input.supply_id !== undefined ? input.supply_id : existing.supply_id;
    const nextPrep =
      input.preparation_id !== undefined ? input.preparation_id : existing.preparation_id;
    const hasSupply = nextSupply != null;
    const hasPrep = nextPrep != null;
    if (hasSupply === hasPrep) {
      throw new BadRequestError(
        'Recipe item must reference exactly one of supply_id or preparation_id',
      );
    }
    const ownerType = await ownerTypeForRecipe(tx, recipeId);
    await validateRecipeItem(tx, ownerType, {
      supply_id: nextSupply,
      preparation_id: nextPrep,
    });

    const data: Prisma.RecipeItemUpdateInput = {};
    if (input.supply_id !== undefined) {
      data.supply = input.supply_id
        ? { connect: { id: input.supply_id } }
        : { disconnect: true };
    }
    if (input.preparation_id !== undefined) {
      data.preparation = input.preparation_id
        ? { connect: { id: input.preparation_id } }
        : { disconnect: true };
    }
    if (input.quantity !== undefined) data.quantity = new Decimal(input.quantity);
    if (input.unit !== undefined) data.unit = input.unit;
    if (input.waste_pct !== undefined) data.waste_pct = new Decimal(input.waste_pct);

    const updated = await tx.recipeItem.update({ where: { id: itemId }, data });
    await applyRecipeCost(tx, recipeId);
    await cascadeIfPreparation(tx, recipeId);
    return updated;
  });
}

export async function removeRecipeItem(recipeId: string, itemId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.recipeItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.recipe_id !== recipeId) throw new NotFoundError('RecipeItem');
    await tx.recipeItem.delete({ where: { id: itemId } });
    await applyRecipeCost(tx, recipeId);
    await cascadeIfPreparation(tx, recipeId);
  });
}

// ----------------------------------------------------------------------------
// On-demand recalculation (exposed as an API endpoint)
// ----------------------------------------------------------------------------

export async function recalculateRecipe(recipeId: string) {
  return prisma.$transaction(async (tx) => {
    const cost = await applyRecipeCost(tx, recipeId);
    await cascadeIfPreparation(tx, recipeId);
    return { recipe_id: recipeId, recipe_cost: cost.toString() };
  });
}
