import { Prisma, PurchaseStatus, InventoryCheckStatus } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import type {
  CreateSupplyInput,
  UpdateSupplyInput,
  ListSupplyQuery,
  SupplyStockQuery,
  SupplyMovementsQuery,
  SupplyPurchaseHistoryQuery,
  SupplyCountVarianceQuery,
  ResolveDependenciesInput,
} from './schema.js';

async function assertCategoryExists(categoryId: string): Promise<void> {
  const exists = await prisma.supplyCategory.findUnique({
    where: { id: categoryId },
    select: { id: true },
  });
  if (!exists) throw new BadRequestError('category_id references a non-existent category');
}

export async function createSupply(input: CreateSupplyInput) {
  await assertCategoryExists(input.category_id);
  const { initial_unit_cost, ...rest } = input;
  return prisma.supply.create({
    data:
      initial_unit_cost !== undefined && initial_unit_cost > 0
        ? { ...rest, average_cost: initial_unit_cost, last_cost: initial_unit_cost }
        : rest,
  });
}

export async function listSupplies(query: ListSupplyQuery) {
  const where: Prisma.SupplyWhereInput = {
    ...(query.include_deleted ? {} : { deleted_at: null }),
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
  const rows = await prisma.supply.findMany({
    where,
    orderBy: { name: 'asc' },
    include: { category: true, tare_weight: true },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getSupply(id: string, includeDeleted = false) {
  const row = await prisma.supply.findUnique({
    where: { id },
    include: { category: true, tare_weight: true },
  });
  if (!row) throw new NotFoundError('Supply');
  if (!includeDeleted && row.deleted_at !== null) throw new NotFoundError('Supply');
  return row;
}

export async function updateSupply(id: string, input: UpdateSupplyInput) {
  const existing = await getSupply(id);
  if (input.category_id && input.category_id !== existing.category_id) {
    await assertCategoryExists(input.category_id);
  }
  // unit_cost is a wire-only override that flows into both the WAC and last
  // cost columns. We pull it out of `input` before handing the rest to Prisma
  // (the column doesn't exist on the Supply model under that name).
  const { unit_cost, ...rest } = input;
  return prisma.supply.update({
    where: { id },
    data:
      unit_cost !== undefined
        ? { ...rest, average_cost: unit_cost, last_cost: unit_cost }
        : rest,
    include: { category: true, tare_weight: true },
  });
}

export async function softDeleteSupply(id: string) {
  await getSupply(id);
  return prisma.supply.update({
    where: { id },
    data: { deleted_at: new Date(), active: false },
  });
}

export async function listSupplyStocks(supplyId: string, query: SupplyStockQuery) {
  await getSupply(supplyId);
  const rows = await prisma.storageStock.findMany({
    where: { supply_id: supplyId },
    include: { storage: { select: { id: true, name: true, active: true } } },
    orderBy: { id: 'asc' },
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

// Counts every downstream reference the delete-confirmation UI warns about.
// Surfacing concrete numbers (recipes / products via recipes / modifiers /
// storages-with-stock / last movement) lets the operator decide whether a
// soft-delete is safe or whether cascade-resolution is required first.
export async function getSupplyDependencies(id: string) {
  await getSupply(id);

  const [recipeRefs, modifierCount, stocks, lastMovement] = await Promise.all([
    prisma.recipeItem.findMany({
      where: { supply_id: id },
      select: {
        recipe_id: true,
        recipe: { select: { product_id: true } },
      },
    }),
    prisma.modifier.count({ where: { supply_id: id } }),
    prisma.storageStock.findMany({
      where: { supply_id: id },
      select: { quantity: true },
    }),
    prisma.stockMovement.findFirst({
      where: { supply_id: id },
      orderBy: { created_at: 'desc' },
      select: { created_at: true },
    }),
  ]);

  const distinctRecipeIds = new Set(recipeRefs.map((r) => r.recipe_id));
  const distinctProductIds = new Set(
    recipeRefs
      .map((r) => r.recipe?.product_id ?? null)
      .filter((v): v is string => v !== null),
  );

  let storagesWithStock = 0;
  let total = new Prisma.Decimal(0);
  for (const s of stocks) {
    const q = new Prisma.Decimal(s.quantity);
    if (q.gt(0)) storagesWithStock += 1;
    total = total.add(q);
  }

  return {
    recipe_count: distinctRecipeIds.size,
    product_count: distinctProductIds.size,
    modifier_count: modifierCount,
    storages_with_stock: storagesWithStock,
    total_stock: total.toString(),
    last_movement_at: lastMovement?.created_at ?? null,
  };
}

// ─── Phase 2: analytics endpoints for SupplyInfoView ───────────────────────
// Each function powers one section of the per-supply detail page. Shapes are
// flattened on the way out (no nested Prisma payloads bleed into the API
// contract) so the frontend can render directly without re-shaping.

export async function listSupplyMovements(supplyId: string, query: SupplyMovementsQuery) {
  await getSupply(supplyId);

  const where: Prisma.StockMovementWhereInput = {
    supply_id: supplyId,
    ...(query.type ? { type: query.type } : {}),
    ...(query.from || query.to
      ? {
          created_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };

  const rows = await prisma.stockMovement.findMany({
    where,
    include: { storage: { select: { id: true, name: true } } },
    orderBy: { created_at: 'desc' },
    ...buildCursorArgs(query),
  });

  return toPageResult(rows, query.limit);
}

// Aggregates "who has sold us this supply" by walking PurchaseItem rows of
// CONFIRMED purchases, grouping by Purchase.supplier_id. The set is small
// enough (a supply usually has ≤ a handful of suppliers) that paginating
// would be net-negative — the page renders the whole list at once.
export async function listSupplySuppliers(supplyId: string) {
  await getSupply(supplyId);

  // Pull the primary packaging hint first so we can flag the "primary"
  // supplier badge regardless of whether they have any confirmed purchases yet.
  const primaryPackaging = await prisma.purchasePackaging.findFirst({
    where: { supply_id: supplyId, is_primary: true, active: true },
    select: { supplier_id: true },
  });
  const primarySupplierId = primaryPackaging?.supplier_id ?? null;

  const items = await prisma.purchaseItem.findMany({
    where: {
      supply_id: supplyId,
      purchase: { status: PurchaseStatus.CONFIRMED },
    },
    select: {
      base_unit_quantity: true,
      unit_cost: true,
      package_quantity: true,
      price_per_package: true,
      purchase: {
        select: {
          id: true,
          date: true,
          supplier: {
            select: { id: true, name: true, contact_name: true, active: true },
          },
        },
      },
    },
    orderBy: { purchase: { date: 'desc' } },
  });

  interface Agg {
    supplier_id: string;
    name: string;
    contact_name: string | null;
    active: boolean;
    last_purchase_date: Date;
    last_unit_cost: string;
    total_base_quantity: Prisma.Decimal;
    total_spend_cents: Prisma.Decimal;
    // Counted via the size of `purchase_ids` at projection time — keeping the
    // set here lets us count distinct purchases even when a supplier shipped
    // the same supply across several line items of the same PO.
    purchase_ids: Set<string>;
  }

  const byId = new Map<string, Agg>();
  for (const it of items) {
    const sup = it.purchase.supplier;
    const existing = byId.get(sup.id);
    if (existing) {
      existing.total_base_quantity = existing.total_base_quantity.add(it.base_unit_quantity);
      existing.total_spend_cents = existing.total_spend_cents.add(
        new Prisma.Decimal(it.package_quantity).mul(it.price_per_package),
      );
      existing.purchase_ids.add(it.purchase.id);
      // Rows are ordered by purchase date desc, so the first row we see for a
      // supplier already carries its most recent purchase — don't overwrite.
    } else {
      byId.set(sup.id, {
        supplier_id: sup.id,
        name: sup.name,
        contact_name: sup.contact_name,
        active: sup.active,
        last_purchase_date: it.purchase.date,
        last_unit_cost: it.unit_cost.toString(),
        total_base_quantity: new Prisma.Decimal(it.base_unit_quantity),
        total_spend_cents: new Prisma.Decimal(it.package_quantity).mul(it.price_per_package),
        purchase_ids: new Set([it.purchase.id]),
      });
    }
  }

  // Surface the primary-only case too: if the operator marked a packaging as
  // primary but no purchases landed yet, the supplier still belongs on the
  // list so the UI can show the link.
  if (primarySupplierId && !byId.has(primarySupplierId)) {
    const stub = await prisma.supplier.findUnique({
      where: { id: primarySupplierId },
      select: { id: true, name: true, contact_name: true, active: true },
    });
    if (stub) {
      byId.set(stub.id, {
        supplier_id: stub.id,
        name: stub.name,
        contact_name: stub.contact_name,
        active: stub.active,
        last_purchase_date: new Date(0),
        last_unit_cost: '0',
        total_base_quantity: new Prisma.Decimal(0),
        total_spend_cents: new Prisma.Decimal(0),
        purchase_ids: new Set(),
      });
    }
  }

  const list = Array.from(byId.values())
    .map((a) => ({
      supplier_id: a.supplier_id,
      name: a.name,
      contact_name: a.contact_name,
      active: a.active,
      is_primary: a.supplier_id === primarySupplierId,
      last_purchase_date: a.purchase_ids.size > 0 ? a.last_purchase_date : null,
      last_unit_cost: a.purchase_ids.size > 0 ? a.last_unit_cost : null,
      total_base_quantity: a.total_base_quantity.toString(),
      total_spend_cents: a.total_spend_cents.toDecimalPlaces(0).toString(),
      purchase_count: a.purchase_ids.size,
    }))
    .sort((a, b) => {
      // Primary first, then by most recent purchase desc, then by total spend desc.
      if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
      const da = a.last_purchase_date ? new Date(a.last_purchase_date).getTime() : 0;
      const db = b.last_purchase_date ? new Date(b.last_purchase_date).getTime() : 0;
      if (da !== db) return db - da;
      return Number(b.total_spend_cents) - Number(a.total_spend_cents);
    });

  return { items: list };
}

// Recent purchase events that included this supply. Defaults to CONFIRMED
// only; pass `status` to surface drafts/cancellations explicitly.
export async function listSupplyPurchaseHistory(
  supplyId: string,
  query: SupplyPurchaseHistoryQuery,
) {
  await getSupply(supplyId);

  const statusFilter = query.status
    ? { status: query.status }
    : { status: PurchaseStatus.CONFIRMED };

  const where: Prisma.PurchaseItemWhereInput = {
    supply_id: supplyId,
    purchase: {
      ...statusFilter,
      ...(query.from || query.to
        ? {
            date: {
              ...(query.from ? { gte: query.from } : {}),
              ...(query.to ? { lte: query.to } : {}),
            },
          }
        : {}),
    },
  };

  // Order by purchase date desc, then by item id desc as a tiebreaker so the
  // cursor remains stable when several items land on the same date.
  const rows = await prisma.purchaseItem.findMany({
    where,
    include: {
      purchase: {
        select: {
          id: true,
          date: true,
          status: true,
          supplier: { select: { id: true, name: true } },
          storage: { select: { id: true, name: true } },
        },
      },
      packaging: { select: { id: true, name: true } },
    },
    orderBy: [{ purchase: { date: 'desc' } }, { id: 'desc' }],
    ...buildCursorArgs(query),
  });

  return toPageResult(rows, query.limit);
}

// Products whose recipes consume this supply (directly via RecipeItem, not via
// preparations or modifier groups — those are separate concerns). Returns one
// row per recipe-item so a product with two slots for the same supply (e.g.
// double shot) shows both. Small set: not paginated.
export async function listSupplyConsumingProducts(supplyId: string) {
  await getSupply(supplyId);

  const rows = await prisma.recipeItem.findMany({
    where: { supply_id: supplyId },
    select: {
      id: true,
      quantity: true,
      unit: true,
      waste_pct: true,
      recipe: {
        select: {
          id: true,
          product: {
            select: { id: true, name: true, type: true, active: true, deleted_at: true },
          },
          variant: {
            select: {
              id: true,
              name: true,
              active: true,
              product: {
                select: { id: true, name: true, type: true, active: true, deleted_at: true },
              },
            },
          },
        },
      },
    },
  });

  // Flatten product / variant relations so the API contract stays single-layer.
  const items = rows
    .map((r) => {
      // Recipe always belongs to either a product OR a variant — flatten both
      // paths to a common shape for the consumer.
      const product = r.recipe.product ?? r.recipe.variant?.product ?? null;
      if (!product) return null;
      const variant = r.recipe.variant ?? null;
      return {
        recipe_item_id: r.id,
        recipe_id: r.recipe.id,
        product_id: product.id,
        product_name: product.name,
        product_type: product.type,
        product_active: product.active && product.deleted_at === null,
        variant_id: variant?.id ?? null,
        variant_name: variant?.name ?? null,
        variant_active: variant?.active ?? null,
        quantity: r.quantity.toString(),
        unit: r.unit,
        waste_pct: r.waste_pct.toString(),
      };
    })
    .filter((v): v is NonNullable<typeof v> => v !== null)
    .sort((a, b) => {
      // Active products first, then alphabetic by product (variant breaks ties).
      if (a.product_active !== b.product_active) return a.product_active ? -1 : 1;
      const byProduct = a.product_name.localeCompare(b.product_name);
      if (byProduct !== 0) return byProduct;
      return (a.variant_name ?? '').localeCompare(b.variant_name ?? '');
    });

  return { items };
}

// Variance rows from COMPLETED inventory checks (in-progress checks aren't
// auditable yet — they'd skew the picture). Includes storage + check date so
// the UI can plot drift over time.
export async function listSupplyCountVariance(
  supplyId: string,
  query: SupplyCountVarianceQuery,
) {
  await getSupply(supplyId);

  const rows = await prisma.inventoryCheckItem.findMany({
    where: {
      supply_id: supplyId,
      check: { status: InventoryCheckStatus.COMPLETED },
    },
    include: {
      check: {
        select: {
          id: true,
          date: true,
          completed_at: true,
          type: true,
          storage: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: [{ check: { date: 'desc' } }, { id: 'desc' }],
    ...buildCursorArgs(query),
  });

  return toPageResult(rows, query.limit);
}

// ─── Phase 4: cascade resolver ─────────────────────────────────────────────
// Applies a per-recipe-item action plan, nulls out the soft references on
// Modifier / Product / ProductModification, and (optionally) soft-deletes the
// supply at the end. Everything runs in a single transaction so a partial
// failure leaves the catalogue untouched.
//
// Action semantics:
//   replace      — UPDATE RecipeItem (new supply_id, optional new quantity).
//                  The recipe line stays, just points elsewhere.
//   remove_line  — DELETE RecipeItem. The recipe survives without this line.
//   remove_owner — Soft-delete the parent Product (when the recipe is a
//                  product recipe) or deactivate the ProductVariant (when
//                  the recipe is a variant recipe). The RecipeItem itself is
//                  left intact so the original recipe stays auditable if the
//                  owner is later reactivated.
//
// All Modifier / Product / ProductModification rows that referenced this
// supply via their nullable supply_id are set to NULL automatically — those
// are soft references and the operator already opted in to "resolve" them.

interface CascadeResult {
  replaced: number;
  removed_lines: number;
  removed_owners: number;
  modifier_refs_nulled: number;
  product_refs_nulled: number;
  product_modification_refs_nulled: number;
  supply_soft_deleted: boolean;
  skipped_recipe_items: number; // refs to this supply NOT included in the plan
}

export async function resolveSupplyDependencies(
  supplyId: string,
  input: ResolveDependenciesInput,
): Promise<CascadeResult> {
  // The supply must exist and be live — resolving the cascade on an already-
  // deleted row is a no-op that the caller should treat as a programming
  // mistake.
  await getSupply(supplyId);

  // Dedupe by recipe_item_id: keep the latest entry per id so the UI can
  // safely re-submit if the operator clicks twice while the request is in
  // flight. Drops the older entry rather than erroring — the user's intent
  // is "this is what I want", not "fail the whole batch".
  const dedup = new Map<string, ResolveDependenciesInput['resolutions'][number]>();
  for (const r of input.resolutions) dedup.set(r.recipe_item_id, r);
  const plan = [...dedup.values()];

  // Pre-fetch every recipe item the plan touches so we can validate ownership
  // (must reference this supply) and route the per-recipe action without
  // additional round trips inside the transaction.
  const targetItems =
    plan.length === 0
      ? []
      : await prisma.recipeItem.findMany({
          where: { id: { in: plan.map((r) => r.recipe_item_id) } },
          select: {
            id: true,
            supply_id: true,
            recipe: {
              select: {
                id: true,
                product_id: true,
                variant_id: true,
              },
            },
          },
        });
  const itemById = new Map(targetItems.map((it) => [it.id, it]));

  // Hard rejection — a stray id or one pointing at a different supply means
  // the UI is out of sync. Better to bail than to silently mutate the wrong
  // recipe.
  for (const r of plan) {
    const item = itemById.get(r.recipe_item_id);
    if (!item) {
      throw new NotFoundError(`Recipe item ${r.recipe_item_id} not found`);
    }
    if (item.supply_id !== supplyId) {
      throw new BadRequestError(
        `Recipe item ${r.recipe_item_id} does not reference this supply`,
      );
    }
  }

  // Validate every replacement target exists, is live, and is distinct from
  // the supply we're about to delete.
  const replacementIds = Array.from(
    new Set(
      plan
        .filter((r) => r.action === 'replace' && r.replacement_supply_id)
        .map((r) => r.replacement_supply_id as string),
    ),
  );
  if (replacementIds.length > 0) {
    if (replacementIds.includes(supplyId)) {
      throw new BadRequestError('Cannot replace a supply with itself');
    }
    const found = await prisma.supply.findMany({
      where: { id: { in: replacementIds }, deleted_at: null, active: true },
      select: { id: true },
    });
    if (found.length !== replacementIds.length) {
      throw new BadRequestError(
        'One or more replacement supplies are missing, deleted, or inactive',
      );
    }
  }

  // How many references to this supply are we leaving untouched? The UI uses
  // this to decide whether to nag the operator before soft-deleting.
  const totalRefs = await prisma.recipeItem.count({ where: { supply_id: supplyId } });

  const result: CascadeResult = {
    replaced: 0,
    removed_lines: 0,
    removed_owners: 0,
    modifier_refs_nulled: 0,
    product_refs_nulled: 0,
    product_modification_refs_nulled: 0,
    supply_soft_deleted: false,
    skipped_recipe_items: totalRefs - plan.length,
  };

  await prisma.$transaction(async (tx) => {
    // ── Apply per-item resolutions ─────────────────────────────────────
    for (const r of plan) {
      const item = itemById.get(r.recipe_item_id)!;
      switch (r.action) {
        case 'replace': {
          await tx.recipeItem.update({
            where: { id: r.recipe_item_id },
            data: {
              supply_id: r.replacement_supply_id!,
              ...(r.new_quantity !== undefined ? { quantity: r.new_quantity } : {}),
            },
          });
          result.replaced += 1;
          break;
        }
        case 'remove_line': {
          await tx.recipeItem.delete({ where: { id: r.recipe_item_id } });
          result.removed_lines += 1;
          break;
        }
        case 'remove_owner': {
          if (item.recipe.product_id) {
            // Soft-delete only if not already deleted (idempotent — many
            // recipe items can share an owner, e.g. when a product has
            // multiple variants all hitting this supply).
            await tx.product.updateMany({
              where: { id: item.recipe.product_id, deleted_at: null },
              data: { deleted_at: new Date(), active: false },
            });
          } else if (item.recipe.variant_id) {
            await tx.productVariant.updateMany({
              where: { id: item.recipe.variant_id, active: true },
              data: { active: false },
            });
          }
          result.removed_owners += 1;
          break;
        }
      }
    }

    // ── Null out soft references on the supporting tables ──────────────
    const modifierUpd = await tx.modifier.updateMany({
      where: { supply_id: supplyId },
      data: { supply_id: null, supply_quantity: null, supply_unit: null },
    });
    result.modifier_refs_nulled = modifierUpd.count;

    const productUpd = await tx.product.updateMany({
      where: { supply_id: supplyId },
      data: { supply_id: null },
    });
    result.product_refs_nulled = productUpd.count;

    const productModUpd = await tx.productModification.updateMany({
      where: { supply_id: supplyId },
      data: { supply_id: null },
    });
    result.product_modification_refs_nulled = productModUpd.count;

    // ── Soft-delete the supply itself (idempotent) ─────────────────────
    if (input.soft_delete) {
      await tx.supply.update({
        where: { id: supplyId },
        data: { deleted_at: new Date(), active: false },
      });
      result.supply_soft_deleted = true;
    }
  });

  return result;
}
