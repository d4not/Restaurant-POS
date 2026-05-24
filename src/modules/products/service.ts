import { Prisma, ProductType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateProductInput,
  UpdateProductInput,
  ListProductQuery,
  CreateVariantInput,
  UpdateVariantInput,
} from './schema.js';

const productInclude = {
  category: true,
  tax: true,
  supply: { select: { id: true, name: true, base_unit: true } },
  variants: { where: { active: true }, orderBy: { display_order: 'asc' } },
  modifier_groups: {
    include: {
      modifier_group: { include: { modifiers: { where: { active: true } } } },
    },
  },
} satisfies Prisma.ProductInclude;

async function assertCategoryExists(categoryId: string): Promise<void> {
  const exists = await prisma.productCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('category_id references a non-existent category');
}

async function assertTaxExists(taxId: string): Promise<void> {
  const exists = await prisma.tax.findUnique({ where: { id: taxId }, select: { id: true } });
  if (!exists) throw new BadRequestError('tax_id references a non-existent tax');
}

async function assertSupplyExists(supplyId: string): Promise<void> {
  const exists = await prisma.supply.findFirst({
    where: { id: supplyId, deleted_at: null },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('supply_id references a non-existent supply');
}

export async function createProduct(input: CreateProductInput) {
  if (input.category_id) await assertCategoryExists(input.category_id);
  if (input.tax_id) await assertTaxExists(input.tax_id);
  if (input.supply_id) await assertSupplyExists(input.supply_id);
  return prisma.product.create({ data: input, include: productInclude });
}

export async function listProducts(query: ListProductQuery) {
  const where: Prisma.ProductWhereInput = {
    ...(query.include_deleted ? {} : { deleted_at: null }),
    ...(query.type ? { type: query.type } : {}),
    ...(query.category_id ? { category_id: query.category_id } : {}),
    ...(query.active !== undefined ? { active: query.active } : {}),
    ...(query.search
      ? {
          OR: [
            { name: { contains: query.search, mode: 'insensitive' } },
            { barcode: { contains: query.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
  const rows = await prisma.product.findMany({
    where,
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
    include: productInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getProduct(id: string, includeDeleted = false) {
  const row = await prisma.product.findUnique({
    where: { id },
    include: productInclude,
  });
  if (!row) throw new NotFoundError('Product');
  if (!includeDeleted && row.deleted_at !== null) throw new NotFoundError('Product');
  return row;
}

export async function updateProduct(id: string, input: UpdateProductInput) {
  const existing = await getProduct(id);
  if (input.category_id && input.category_id !== existing.category_id) {
    await assertCategoryExists(input.category_id);
  }
  if (input.tax_id && input.tax_id !== existing.tax_id) {
    await assertTaxExists(input.tax_id);
  }
  if (input.supply_id && input.supply_id !== existing.supply_id) {
    await assertSupplyExists(input.supply_id);
  }
  // Changing type mid-life is allowed but must re-validate the constraints
  // the create schema already enforces against the merged payload.
  const nextType = input.type ?? existing.type;
  const nextSellPrice = input.sell_price !== undefined ? input.sell_price : existing.sell_price;
  const nextCategory = input.category_id !== undefined ? input.category_id : existing.category_id;
  const nextSupply = input.supply_id !== undefined ? input.supply_id : existing.supply_id;
  if (nextType === ProductType.PREPARATION) {
    if (nextSellPrice != null || nextCategory != null || nextSupply != null) {
      throw new BadRequestError(
        'PREPARATION products cannot have sell_price, category_id, or supply_id',
      );
    }
  }
  if (nextSupply != null && nextType !== ProductType.PRODUCT) {
    throw new BadRequestError('supply_id is only valid for type=PRODUCT');
  }

  return prisma.product.update({ where: { id }, data: input, include: productInclude });
}

export async function softDeleteProduct(id: string) {
  await getProduct(id);
  return prisma.product.update({
    where: { id },
    data: { deleted_at: new Date(), active: false },
  });
}

// ----------------------------------------------------------------------------
// Variants (nested under a product)
// ----------------------------------------------------------------------------

async function loadSellableProductOrThrow(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, type: true, deleted_at: true },
  });
  if (!product || product.deleted_at) throw new NotFoundError('Product');
  // Sizes (variants) are specific to prepared dishes. Packaged PRODUCTs use
  // ProductModification instead, and PREPARATIONs are never sold.
  if (product.type !== ProductType.DISH) {
    throw new BadRequestError('Only DISH products can have variants');
  }
  return product;
}

export async function createVariant(productId: string, input: CreateVariantInput) {
  await loadSellableProductOrThrow(productId);
  return prisma.productVariant.create({
    data: { ...input, product_id: productId },
  });
}

export async function listVariants(productId: string) {
  await loadSellableProductOrThrow(productId);
  return prisma.productVariant.findMany({
    where: { product_id: productId },
    orderBy: [{ display_order: 'asc' }, { name: 'asc' }],
  });
}

export async function getVariant(productId: string, variantId: string) {
  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant || variant.product_id !== productId) throw new NotFoundError('ProductVariant');
  return variant;
}

export async function updateVariant(
  productId: string,
  variantId: string,
  input: UpdateVariantInput,
) {
  await getVariant(productId, variantId);
  return prisma.productVariant.update({ where: { id: variantId }, data: input });
}

export async function deleteVariant(productId: string, variantId: string) {
  await getVariant(productId, variantId);
  await prisma.productVariant.delete({ where: { id: variantId } });
}

// ----------------------------------------------------------------------------
// ProductModifierGroup linking
// ----------------------------------------------------------------------------

export async function attachModifierGroup(productId: string, modifierGroupId: string) {
  await getProduct(productId);
  const group = await prisma.modifierGroup.findUnique({
    where: { id: modifierGroupId },
    select: { id: true },
  });
  if (!group) throw new BadRequestError('modifier_group_id references a non-existent group');
  try {
    return await prisma.productModifierGroup.create({
      data: { product_id: productId, modifier_group_id: modifierGroupId },
      include: { modifier_group: { include: { modifiers: true } } },
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === 'P2002' // unique violation on (product_id, modifier_group_id)
    ) {
      throw new ConflictError('Modifier group already attached to this product');
    }
    throw err;
  }
}

export async function detachModifierGroup(productId: string, modifierGroupId: string) {
  const link = await prisma.productModifierGroup.findFirst({
    where: { product_id: productId, modifier_group_id: modifierGroupId },
  });
  if (!link) throw new NotFoundError('ProductModifierGroup link');
  await prisma.productModifierGroup.delete({ where: { id: link.id } });
}

export async function listProductModifierGroups(productId: string) {
  await getProduct(productId);
  return prisma.productModifierGroup.findMany({
    where: { product_id: productId },
    include: { modifier_group: { include: { modifiers: { where: { active: true } } } } },
  });
}

// ----------------------------------------------------------------------------
// Duplicate
// ----------------------------------------------------------------------------

export async function duplicateProduct(id: string) {
  const src = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: true,
      modifier_groups: true,
      recipe: { include: { items: true } },
    },
  });
  if (!src || src.deleted_at) throw new NotFoundError('Product');

  return prisma.$transaction(async (tx) => {
    const product = await tx.product.create({
      data: {
        name: `${src.name} (copy)`,
        type: src.type,
        category_id: src.category_id,
        station_id: src.station_id,
        sell_price: src.sell_price,
        image_url: src.image_url,
        icon_color: src.icon_color,
        display_order: src.display_order,
        active: false,
        allow_discount: src.allow_discount,
        sold_by_weight: src.sold_by_weight,
        barcode: null,
        tax_id: src.tax_id,
        supply_id: src.supply_id,
      },
    });

    const variantMap = new Map<string, string>();
    for (const v of src.variants) {
      const nv = await tx.productVariant.create({
        data: {
          product_id: product.id,
          name: v.name,
          sell_price: v.sell_price,
          barcode: null,
          recipe_cost: v.recipe_cost,
          food_cost_pct: v.food_cost_pct,
          display_order: v.display_order,
          active: v.active,
        },
      });
      variantMap.set(v.id, nv.id);
    }

    for (const mg of src.modifier_groups) {
      await tx.productModifierGroup.create({
        data: {
          product_id: product.id,
          modifier_group_id: mg.modifier_group_id,
        },
      });
    }

    if (src.recipe) {
      const recipe = await tx.recipe.create({
        data: {
          product_id: product.id,
          yield_quantity: src.recipe.yield_quantity,
          yield_unit: src.recipe.yield_unit,
        },
      });
      for (const item of src.recipe.items) {
        await tx.recipeItem.create({
          data: {
            recipe_id: recipe.id,
            supply_id: item.supply_id,
            preparation_id: item.preparation_id,
            modifier_group_id: item.modifier_group_id,
            quantity: item.quantity,
            unit: item.unit,
            waste_pct: item.waste_pct,
          },
        });
      }
    }

    for (const [oldVId, newVId] of variantMap) {
      const vRecipe = await tx.recipe.findUnique({
        where: { variant_id: oldVId },
        include: { items: true },
      });
      if (!vRecipe) continue;
      const nr = await tx.recipe.create({
        data: {
          variant_id: newVId,
          yield_quantity: vRecipe.yield_quantity,
          yield_unit: vRecipe.yield_unit,
        },
      });
      for (const item of vRecipe.items) {
        await tx.recipeItem.create({
          data: {
            recipe_id: nr.id,
            supply_id: item.supply_id,
            preparation_id: item.preparation_id,
            modifier_group_id: item.modifier_group_id,
            quantity: item.quantity,
            unit: item.unit,
            waste_pct: item.waste_pct,
          },
        });
      }
    }

    return tx.product.findUniqueOrThrow({
      where: { id: product.id },
      include: productInclude,
    });
  });
}

// ----------------------------------------------------------------------------
// Bulk update
// ----------------------------------------------------------------------------

export async function bulkUpdateProducts(
  ids: string[],
  update: { active?: boolean },
) {
  if (ids.length === 0) throw new BadRequestError('ids must not be empty');
  if (ids.length > 100) throw new BadRequestError('Maximum 100 products per batch');
  await prisma.product.updateMany({
    where: { id: { in: ids }, deleted_at: null },
    data: update,
  });
  return { updated: ids.length };
}
