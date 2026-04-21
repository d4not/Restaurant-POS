import { Prisma, PurchaseStatus, StockMovementType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal, recalculateWAC } from '../../lib/decimal.js';
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  AddPurchaseItemInput,
  UpdatePurchaseItemInput,
  ListPurchaseQuery,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const purchaseInclude = {
  items: { include: { supply: true, packaging: true } },
  supplier: { select: { id: true, name: true } },
  storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
} satisfies Prisma.PurchaseInclude;

async function loadPurchaseOrThrow(client: PrismaLike, id: string) {
  const row = await client.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!row) throw new NotFoundError('Purchase');
  return row;
}

async function assertDraft(client: PrismaLike, id: string): Promise<void> {
  const row = await client.purchase.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) throw new NotFoundError('Purchase');
  if (row.status !== PurchaseStatus.DRAFT) {
    throw new ConflictError(`Purchase is ${row.status.toLowerCase()} — items can only change while DRAFT`);
  }
}

async function resolveItemValues(
  client: PrismaLike,
  supplyId: string,
  packagingId: string | null | undefined,
  packageQuantity: Decimal | string | number,
  pricePerPackage: Decimal | string | number,
): Promise<{ baseQty: Decimal; unitCost: Decimal; lineTotal: Decimal }> {
  const supply = await client.supply.findFirst({
    where: { id: supplyId, deleted_at: null },
    select: { id: true },
  });
  if (!supply) throw new BadRequestError('supply_id references a non-existent supply');

  let unitsPerPackage = new Decimal(1);
  if (packagingId) {
    const packaging = await client.purchasePackaging.findUnique({
      where: { id: packagingId },
      select: { id: true, supply_id: true, units_per_package: true, active: true },
    });
    if (!packaging) throw new BadRequestError('packaging_id references a non-existent packaging');
    if (packaging.supply_id !== supplyId) {
      throw new BadRequestError('packaging belongs to a different supply');
    }
    unitsPerPackage = new Decimal(packaging.units_per_package);
  }
  const pkgQty = new Decimal(packageQuantity);
  const price = new Decimal(pricePerPackage);
  if (unitsPerPackage.lte(0)) {
    throw new BadRequestError('packaging units_per_package must be positive');
  }
  return {
    baseQty: pkgQty.mul(unitsPerPackage),
    unitCost: price.div(unitsPerPackage),
    lineTotal: pkgQty.mul(price),
  };
}

async function recomputePurchaseTotal(client: PrismaLike, purchaseId: string): Promise<void> {
  const items = await client.purchaseItem.findMany({
    where: { purchase_id: purchaseId },
    select: { package_quantity: true, price_per_package: true },
  });
  const total = items.reduce(
    (sum, it) =>
      sum.add(new Decimal(it.package_quantity).mul(new Decimal(it.price_per_package))),
    new Decimal(0),
  );
  await client.purchase.update({ where: { id: purchaseId }, data: { total } });
}

export async function createPurchase(userId: string, input: CreatePurchaseInput) {
  return prisma.$transaction(async (tx) => {
    const [supplier, storage] = await Promise.all([
      tx.supplier.findUnique({
        where: { id: input.supplier_id },
        select: { id: true, active: true },
      }),
      tx.storage.findUnique({
        where: { id: input.storage_id },
        select: { id: true, active: true },
      }),
    ]);
    if (!supplier) throw new BadRequestError('supplier_id references a non-existent supplier');
    if (!supplier.active) throw new BadRequestError('supplier is inactive');
    if (!storage) throw new BadRequestError('storage_id references a non-existent storage');
    if (!storage.active) throw new BadRequestError('storage is inactive');

    const purchase = await tx.purchase.create({
      data: {
        supplier_id: input.supplier_id,
        storage_id: input.storage_id,
        date: input.date,
        payment_method: input.payment_method,
        notes: input.notes,
        user_id: userId,
        status: PurchaseStatus.DRAFT,
      },
    });

    for (const item of input.items ?? []) {
      const { baseQty, unitCost } = await resolveItemValues(
        tx,
        item.supply_id,
        item.packaging_id ?? null,
        item.package_quantity,
        item.price_per_package,
      );
      await tx.purchaseItem.create({
        data: {
          purchase_id: purchase.id,
          supply_id: item.supply_id,
          packaging_id: item.packaging_id ?? null,
          package_quantity: new Decimal(item.package_quantity),
          price_per_package: new Decimal(item.price_per_package),
          base_unit_quantity: baseQty,
          unit_cost: unitCost,
        },
      });
    }

    if ((input.items ?? []).length > 0) {
      await recomputePurchaseTotal(tx, purchase.id);
    }
    return loadPurchaseOrThrow(tx, purchase.id);
  });
}

export async function listPurchases(query: ListPurchaseQuery) {
  const where: Prisma.PurchaseWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.purchase.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: purchaseInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getPurchase(id: string) {
  return loadPurchaseOrThrow(prisma, id);
}

export async function updatePurchase(id: string, input: UpdatePurchaseInput) {
  return prisma.$transaction(async (tx) => {
    await assertDraft(tx, id);
    if (input.supplier_id) {
      const s = await tx.supplier.findUnique({
        where: { id: input.supplier_id },
        select: { id: true, active: true },
      });
      if (!s) throw new BadRequestError('supplier_id references a non-existent supplier');
      if (!s.active) throw new BadRequestError('supplier is inactive');
    }
    if (input.storage_id) {
      const s = await tx.storage.findUnique({
        where: { id: input.storage_id },
        select: { id: true, active: true },
      });
      if (!s) throw new BadRequestError('storage_id references a non-existent storage');
      if (!s.active) throw new BadRequestError('storage is inactive');
    }
    await tx.purchase.update({ where: { id }, data: input });
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function deletePurchase(id: string) {
  return prisma.$transaction(async (tx) => {
    await assertDraft(tx, id);
    await tx.purchase.delete({ where: { id } });
  });
}

export async function cancelPurchase(id: string) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({ where: { id }, select: { status: true } });
    if (!purchase) throw new NotFoundError('Purchase');
    if (purchase.status === PurchaseStatus.CONFIRMED) {
      // Reversing a confirmed purchase would require walking back WAC/stock;
      // out of scope for Phase 2. Force users to file a write-off or adjustment.
      throw new ConflictError('Cannot cancel a confirmed purchase');
    }
    if (purchase.status === PurchaseStatus.CANCELLED) return loadPurchaseOrThrow(tx, id);
    await tx.purchase.update({ where: { id }, data: { status: PurchaseStatus.CANCELLED } });
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function addPurchaseItem(purchaseId: string, input: AddPurchaseItemInput) {
  return prisma.$transaction(async (tx) => {
    await assertDraft(tx, purchaseId);
    const { baseQty, unitCost } = await resolveItemValues(
      tx,
      input.supply_id,
      input.packaging_id ?? null,
      input.package_quantity,
      input.price_per_package,
    );
    const item = await tx.purchaseItem.create({
      data: {
        purchase_id: purchaseId,
        supply_id: input.supply_id,
        packaging_id: input.packaging_id ?? null,
        package_quantity: new Decimal(input.package_quantity),
        price_per_package: new Decimal(input.price_per_package),
        base_unit_quantity: baseQty,
        unit_cost: unitCost,
      },
    });
    await recomputePurchaseTotal(tx, purchaseId);
    return item;
  });
}

export async function updatePurchaseItem(
  purchaseId: string,
  itemId: string,
  input: UpdatePurchaseItemInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertDraft(tx, purchaseId);
    const existing = await tx.purchaseItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.purchase_id !== purchaseId) {
      throw new NotFoundError('PurchaseItem');
    }

    const supplyId = input.supply_id ?? existing.supply_id;
    const packagingId =
      input.packaging_id !== undefined ? input.packaging_id : existing.packaging_id;
    const packageQuantity: Decimal | number =
      input.package_quantity ?? new Decimal(existing.package_quantity);
    const pricePerPackage: Decimal | number =
      input.price_per_package ?? new Decimal(existing.price_per_package);

    const { baseQty, unitCost } = await resolveItemValues(
      tx,
      supplyId,
      packagingId,
      packageQuantity,
      pricePerPackage,
    );

    const updated = await tx.purchaseItem.update({
      where: { id: itemId },
      data: {
        supply_id: supplyId,
        packaging_id: packagingId,
        package_quantity: new Decimal(packageQuantity),
        price_per_package: new Decimal(pricePerPackage),
        base_unit_quantity: baseQty,
        unit_cost: unitCost,
      },
    });
    await recomputePurchaseTotal(tx, purchaseId);
    return updated;
  });
}

export async function removePurchaseItem(purchaseId: string, itemId: string) {
  return prisma.$transaction(async (tx) => {
    await assertDraft(tx, purchaseId);
    const existing = await tx.purchaseItem.findUnique({ where: { id: itemId } });
    if (!existing || existing.purchase_id !== purchaseId) {
      throw new NotFoundError('PurchaseItem');
    }
    await tx.purchaseItem.delete({ where: { id: itemId } });
    await recomputePurchaseTotal(tx, purchaseId);
  });
}

/**
 * Confirm a DRAFT purchase. This is the hot path for the supplies module:
 *
 *  1. Recompute base_unit_quantity + unit_cost per item (defensive — they should
 *     already be correct from item add/update)
 *  2. Upsert StorageStock at the receiving storage (+= base_unit_quantity)
 *  3. Recalculate the supply's weighted average cost using the supply-wide
 *     stock total BEFORE this line, and update average_cost + last_cost
 *  4. Append a StockMovement row of type PURCHASE
 *  5. Flip purchase.status to CONFIRMED and store the recomputed total
 *
 * Everything runs inside a single Prisma transaction — any failure rolls back
 * stock, WAC, and status together.
 */
export async function confirmPurchase(id: string) {
  return prisma.$transaction(async (tx) => {
    // Atomic status claim: only one concurrent caller can flip DRAFT→CONFIRMED.
    // The read-then-write pattern used elsewhere would let two transactions
    // both see DRAFT, each apply stock/WAC mutations, and double-count the
    // purchase. updateMany returns count=0 if no row matches, which lets us
    // distinguish "already confirmed" from "not found" with a follow-up read.
    const claim = await tx.purchase.updateMany({
      where: { id, status: PurchaseStatus.DRAFT },
      data: { status: PurchaseStatus.CONFIRMED },
    });
    if (claim.count === 0) {
      const existing = await tx.purchase.findUnique({
        where: { id },
        select: { status: true },
      });
      if (!existing) throw new NotFoundError('Purchase');
      if (existing.status === PurchaseStatus.CONFIRMED) {
        throw new ConflictError('Purchase already confirmed');
      }
      throw new ConflictError('Cannot confirm a cancelled purchase');
    }

    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { packaging: true } } },
    });
    if (purchase.items.length === 0) {
      throw new BadRequestError('Cannot confirm a purchase with no items');
    }

    let total = new Decimal(0);

    for (const item of purchase.items) {
      // Defensive re-validation: a supply may have been soft-deleted after the
      // draft was built. Confirming against a deleted supply would pollute WAC
      // and storage stock with a row the business has already retired.
      const supply = await tx.supply.findFirst({
        where: { id: item.supply_id, deleted_at: null },
        select: { id: true, average_cost: true },
      });
      if (!supply) {
        throw new BadRequestError(`supply ${item.supply_id} no longer available`);
      }

      const unitsPerPackage = item.packaging
        ? new Decimal(item.packaging.units_per_package)
        : new Decimal(1);
      const baseQty = new Decimal(item.package_quantity).mul(unitsPerPackage);
      const unitCost = new Decimal(item.price_per_package).div(unitsPerPackage);
      total = total.add(new Decimal(item.package_quantity).mul(new Decimal(item.price_per_package)));

      await tx.purchaseItem.update({
        where: { id: item.id },
        data: { base_unit_quantity: baseQty, unit_cost: unitCost },
      });

      // Upsert stock at the receiving storage
      await tx.storageStock.upsert({
        where: {
          supply_id_storage_id: {
            supply_id: item.supply_id,
            storage_id: purchase.storage_id,
          },
        },
        create: {
          supply_id: item.supply_id,
          storage_id: purchase.storage_id,
          quantity: baseQty,
        },
        update: { quantity: { increment: baseQty } },
      });

      // WAC uses the supply-wide stock total; compute the pre-increment total
      // by summing all storages and subtracting this line's contribution.
      const agg = await tx.storageStock.aggregate({
        where: { supply_id: item.supply_id },
        _sum: { quantity: true },
      });
      const totalAfter = new Decimal(agg._sum.quantity ?? 0);
      const totalBefore = totalAfter.sub(baseQty);
      const newAvg = recalculateWAC(totalBefore, supply.average_cost, baseQty, unitCost);

      await tx.supply.update({
        where: { id: item.supply_id },
        data: { average_cost: newAvg, last_cost: unitCost },
      });

      await tx.stockMovement.create({
        data: {
          supply_id: item.supply_id,
          storage_id: purchase.storage_id,
          type: StockMovementType.PURCHASE,
          quantity: baseQty,
          reference_type: 'Purchase',
          reference_id: purchase.id,
          unit_cost: unitCost,
        },
      });
    }

    // Status was already flipped to CONFIRMED by the atomic claim above;
    // only the recomputed total still needs to land.
    await tx.purchase.update({
      where: { id: purchase.id },
      data: { total },
    });

    return loadPurchaseOrThrow(tx, purchase.id);
  });
}
