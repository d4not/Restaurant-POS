import {
  CashMovementType,
  CashRegisterStatus,
  Prisma,
  PurchaseKind,
  PurchaseStatus,
  StockMovementType,
  UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal, recalculateWAC } from '../../lib/decimal.js';
import {
  loadCurrentOpenRegister,
  recomputeRegisterTotals,
} from '../cash-registers/service.js';
import type {
  CreatePurchaseInput,
  UpdatePurchaseInput,
  AddPurchaseItemInput,
  UpdatePurchaseItemInput,
  ListPurchaseQuery,
  ReplyPurchaseInput,
  PayPurchaseInput,
  InTransitInput,
  ReceiveInput,
  VerifyInput,
  DispatchInput,
  ReturnInput,
  CancelInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const purchaseInclude = {
  items: { include: { supply: true, packaging: true } },
  supplier: {
    select: {
      id: true,
      name: true,
      kind: true,
      whatsapp_phone: true,
      message_template: true,
    },
  },
  storage: { select: { id: true, name: true } },
  user: { select: { id: true, name: true } },
  runner: { select: { id: true, name: true } },
  verifier: { select: { id: true, name: true } },
  canceller: { select: { id: true, name: true } },
  cash_movements: {
    select: {
      id: true,
      type: true,
      amount: true,
      reason: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' as const },
  },
} satisfies Prisma.PurchaseInclude;

async function loadPurchaseOrThrow(client: PrismaLike, id: string) {
  const row = await client.purchase.findUnique({ where: { id }, include: purchaseInclude });
  if (!row) throw new NotFoundError('Purchase');
  return row;
}

// Items + supplier + storage can only mutate while the purchase is still a
// DRAFT — once we leave DRAFT, header fields are part of the supplier's
// negotiated record and shouldn't be silently rewritten. Use the per-state
// transitions (reply/pay/receive/etc.) to change anything downstream.
async function assertDraft(client: PrismaLike, id: string): Promise<void> {
  const row = await client.purchase.findUnique({
    where: { id },
    select: { status: true },
  });
  if (!row) throw new NotFoundError('Purchase');
  if (row.status !== PurchaseStatus.DRAFT) {
    throw new ConflictError(
      `Purchase is ${row.status.toLowerCase()} — items can only change while DRAFT`,
    );
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

// Validates that we're flipping from one of `expected` to `next` and stamps
// `extra` columns alongside. Uses the same atomic updateMany pattern as
// confirmPurchase + completeInventoryCheck so concurrent transitions can't
// both succeed. Returns the loaded purchase after the flip.
async function transitionWithClaim(
  tx: Tx,
  id: string,
  expected: PurchaseStatus | PurchaseStatus[],
  next: PurchaseStatus,
  extra: Prisma.PurchaseUncheckedUpdateInput = {},
): Promise<void> {
  const expectedList = Array.isArray(expected) ? expected : [expected];
  const claim = await tx.purchase.updateMany({
    where: { id, status: { in: expectedList } },
    data: { status: next, ...extra },
  });
  if (claim.count === 0) {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!existing) throw new NotFoundError('Purchase');
    throw new ConflictError(
      `Purchase is ${existing.status.toLowerCase()} — cannot transition to ${next.toLowerCase()}`,
    );
  }
}

function assertKind(
  purchase: { kind: PurchaseKind },
  expected: PurchaseKind,
  action: string,
): void {
  if (purchase.kind !== expected) {
    throw new ConflictError(
      `${action} only applies to ${expected.toLowerCase()} purchases (this is ${purchase.kind.toLowerCase()})`,
    );
  }
}

export async function createPurchase(userId: string, input: CreatePurchaseInput) {
  return prisma.$transaction(async (tx) => {
    const [supplier, storage] = await Promise.all([
      tx.supplier.findUnique({
        where: { id: input.supplier_id },
        select: { id: true, active: true, kind: true },
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

    // If the caller didn't pick a kind, infer one from the supplier's profile
    // so a DELIVERY-only supplier never accidentally lands on an ERRAND ticket
    // (and vice versa). BOTH defaults to DELIVERY because that's the more
    // structured flow operators reach for first.
    const requestedKind = input.kind;
    if (requestedKind) {
      if (supplier.kind !== 'BOTH' && supplier.kind !== requestedKind) {
        throw new BadRequestError(
          `Supplier ${supplier.id} is configured as ${supplier.kind} — cannot create a ${requestedKind} purchase`,
        );
      }
    }
    const kind: PurchaseKind =
      requestedKind ?? (supplier.kind === 'ERRAND' ? PurchaseKind.ERRAND : PurchaseKind.DELIVERY);

    const purchase = await tx.purchase.create({
      data: {
        supplier_id: input.supplier_id,
        storage_id: input.storage_id,
        date: input.date,
        payment_method: input.payment_method,
        notes: input.notes,
        expected_arrival: input.expected_arrival ?? null,
        user_id: userId,
        kind,
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
    ...(query.kind ? { kind: query.kind } : {}),
    ...(query.supplier_id ? { supplier_id: query.supplier_id } : {}),
    ...(query.storage_id ? { storage_id: query.storage_id } : {}),
    ...(query.runner_user_id ? { runner_user_id: query.runner_user_id } : {}),
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

// ─── Items CRUD (DRAFT only) ────────────────────────────────────────────────

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

// ─── DELIVERY transitions ───────────────────────────────────────────────────

export async function sendPurchase(id: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true, items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'send-to-supplier');
    if (existing.items.length === 0) {
      throw new BadRequestError('Cannot send an empty purchase order to a supplier');
    }
    await transitionWithClaim(tx, id, PurchaseStatus.DRAFT, PurchaseStatus.SENT_TO_SUPPLIER, {
      message_sent_at: new Date(),
    });
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function replyPurchase(id: string, input: ReplyPurchaseInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true, items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'register supplier reply');

    // Apply per-item unavailability flags before the status flip so the
    // captured response is consistent with the new state.
    if (input.items?.length) {
      const existingIds = new Set(existing.items.map((i) => i.id));
      for (const it of input.items) {
        if (!existingIds.has(it.id)) {
          throw new BadRequestError(`item ${it.id} is not part of this purchase`);
        }
        await tx.purchaseItem.update({
          where: { id: it.id },
          data: { unavailable: it.unavailable ?? false },
        });
      }
    }

    await transitionWithClaim(
      tx,
      id,
      PurchaseStatus.SENT_TO_SUPPLIER,
      PurchaseStatus.SUPPLIER_REPLIED,
      {
        supplier_replied_at: new Date(),
        supplier_subtotal:
          input.supplier_subtotal != null ? new Decimal(input.supplier_subtotal) : null,
        shipping_cost:
          input.shipping_cost != null ? new Decimal(input.shipping_cost) : null,
      },
    );
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function payPurchase(id: string, input: PayPurchaseInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'mark paid');

    await transitionWithClaim(
      tx,
      id,
      PurchaseStatus.SUPPLIER_REPLIED,
      PurchaseStatus.PAID,
      {
        paid_at: new Date(),
        payment_reference: input.payment_reference ?? null,
      },
    );
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function markInTransit(id: string, input: InTransitInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'mark in-transit');

    await transitionWithClaim(tx, id, PurchaseStatus.PAID, PurchaseStatus.IN_TRANSIT, {
      in_transit_at: new Date(),
      ...(input.expected_arrival !== undefined
        ? { expected_arrival: input.expected_arrival ?? null }
        : {}),
    });
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function receivePurchase(id: string, input: ReceiveInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'mark arrived');

    await applyReceivedItems(tx, existing.id, existing.items, input.items ?? []);

    await transitionWithClaim(tx, id, PurchaseStatus.IN_TRANSIT, PurchaseStatus.ARRIVED, {
      arrived_at: new Date(),
    });
    return loadPurchaseOrThrow(tx, id);
  });
}

// ─── ERRAND transitions ─────────────────────────────────────────────────────

export async function dispatchPurchase(
  id: string,
  userId: string,
  input: DispatchInput,
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true, items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.ERRAND, 'dispatch');
    if (existing.items.length === 0) {
      throw new BadRequestError('Cannot dispatch an empty errand — add items first');
    }

    const runner = await tx.user.findUnique({
      where: { id: input.runner_user_id },
      select: { id: true, active: true },
    });
    if (!runner || !runner.active) {
      throw new BadRequestError('runner_user_id references a non-existent or inactive user');
    }

    // Cash leaves the drawer right now — the dispatch only flies if there's
    // an open, non-provisional shift to attach the CashMovement to.
    const reg = await loadCurrentOpenRegister(tx);
    if (!reg) {
      throw new ConflictError('No open shift — cannot dispatch a cash errand');
    }
    if (reg.is_provisional) {
      throw new ConflictError(
        'Shift is provisional — verify it before dispatching cash errands',
      );
    }

    const cashAdvanced = new Decimal(input.cash_advanced);
    if (cashAdvanced.lte(0)) {
      throw new BadRequestError('cash_advanced must be positive');
    }

    await transitionWithClaim(tx, id, PurchaseStatus.DRAFT, PurchaseStatus.DISPATCHED, {
      runner_user_id: runner.id,
      cash_advanced: cashAdvanced,
      dispatched_at: new Date(),
    });

    await tx.cashMovement.create({
      data: {
        register_id: reg.id,
        user_id: userId,
        type: CashMovementType.CASH_OUT,
        amount: cashAdvanced,
        reason: input.reason ?? `Errand #${id.slice(0, 8)}`,
        reference_type: 'Purchase',
        reference_id: id,
      },
    });
    await recomputeRegisterTotals(tx, reg.id);

    return loadPurchaseOrThrow(tx, id);
  });
}

export async function returnPurchase(id: string, userId: string, input: ReturnInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.ERRAND, 'return');

    await applyReceivedItems(tx, existing.id, existing.items, input.items ?? []);

    const cashReturned = new Decimal(input.cash_returned ?? 0);
    if (cashReturned.lt(0)) {
      throw new BadRequestError('cash_returned cannot be negative');
    }
    const cashAdvanced = new Decimal(existing.cash_advanced ?? 0);
    if (cashReturned.gt(cashAdvanced)) {
      throw new BadRequestError(
        'cash_returned exceeds cash_advanced — that money never left the drawer',
      );
    }

    await transitionWithClaim(tx, id, PurchaseStatus.DISPATCHED, PurchaseStatus.RETURNED, {
      cash_returned: cashReturned,
      returned_at: new Date(),
    });

    // The drawer needs the same register that hosted the dispatch's CASH_OUT,
    // so re-use it instead of "the currently-open one" — a shift change
    // between dispatch and return would otherwise post the change-back into
    // an unrelated shift.
    const dispatchMove = await tx.cashMovement.findFirst({
      where: { reference_type: 'Purchase', reference_id: id, type: CashMovementType.CASH_OUT },
      select: { register_id: true },
      orderBy: { created_at: 'asc' },
    });
    if (!dispatchMove) {
      throw new ConflictError(
        'Cannot find the dispatch CashMovement — register state is inconsistent',
      );
    }

    if (cashReturned.gt(0)) {
      await tx.cashMovement.create({
        data: {
          register_id: dispatchMove.register_id,
          user_id: userId,
          type: CashMovementType.CASH_IN,
          amount: cashReturned,
          reason: input.reason ?? `Errand #${id.slice(0, 8)} — change`,
          reference_type: 'Purchase',
          reference_id: id,
        },
      });
    }
    await recomputeRegisterTotals(tx, dispatchMove.register_id);

    return loadPurchaseOrThrow(tx, id);
  });
}

// ─── Verify (stock-absorbing, manager+) ─────────────────────────────────────

export async function verifyPurchase(id: string, userId: string, input: VerifyInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      include: { items: { select: { id: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');

    // Verify is the manager+ sign-off that turns "we received it" into
    // "stock + WAC reflect it". Both lifecycles converge here.
    const allowed: PurchaseStatus[] =
      existing.kind === PurchaseKind.DELIVERY
        ? [PurchaseStatus.ARRIVED, PurchaseStatus.DRAFT] // DRAFT only for the legacy /confirm alias
        : [PurchaseStatus.RETURNED];

    // Optional manager override of received quantities on /verify. Both
    // delivery (cashier captured at /receive) and errand (cashier captured
    // at /return) already populated received_package_quantity; verify is
    // the trust-but-correct moment.
    if (input.items?.length) {
      await applyReceivedItems(tx, existing.id, existing.items, input.items);
    }

    await transitionWithClaim(tx, id, allowed, PurchaseStatus.VERIFIED, {
      verified_at: new Date(),
      verified_by_user_id: userId,
    });

    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { packaging: true } } },
    });
    await absorbStockWithinTx(tx, purchase);

    return loadPurchaseOrThrow(tx, id);
  });
}

// Legacy alias — DRAFT → VERIFIED in one shot, with received_package_quantity
// defaulted to package_quantity for every item. Older callers (and the
// existing terminal AdminMode "Confirm" button) hit POST /:id/confirm; this
// keeps them green while the new wizard rolls out.
export async function confirmPurchase(id: string, userId: string) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      include: { items: { select: { id: true, package_quantity: true } } },
    });
    if (!existing) throw new NotFoundError('Purchase');
    if (existing.status !== PurchaseStatus.DRAFT) {
      throw new ConflictError(
        `Purchase is ${existing.status.toLowerCase()} — /confirm only applies to DRAFT`,
      );
    }
    if (existing.items.length === 0) {
      throw new BadRequestError('Cannot confirm a purchase with no items');
    }

    // Stamp received = ordered before flipping to VERIFIED so the stock
    // absorption loop in verify uses the right numbers.
    for (const it of existing.items) {
      await tx.purchaseItem.update({
        where: { id: it.id },
        data: { received_package_quantity: it.package_quantity },
      });
    }
    await transitionWithClaim(tx, id, PurchaseStatus.DRAFT, PurchaseStatus.VERIFIED, {
      verified_at: new Date(),
      verified_by_user_id: userId,
    });

    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id },
      include: { items: { include: { packaging: true } } },
    });
    await absorbStockWithinTx(tx, purchase);

    return loadPurchaseOrThrow(tx, id);
  });
}

// ─── Terminal-state transitions ─────────────────────────────────────────────

export async function rejectPurchase(id: string, userId: string, input: CancelInput) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.purchase.findUnique({
      where: { id },
      select: { kind: true, status: true },
    });
    if (!existing) throw new NotFoundError('Purchase');
    assertKind(existing, PurchaseKind.DELIVERY, 'reject');
    // Reject only makes sense before money leaves the building — once paid,
    // use cancel (which is also pre-stock) and recover via write-off.
    const allowed: PurchaseStatus[] = [
      PurchaseStatus.SENT_TO_SUPPLIER,
      PurchaseStatus.SUPPLIER_REPLIED,
    ];
    await transitionWithClaim(tx, id, allowed, PurchaseStatus.REJECTED, {
      cancel_reason: input.cancel_reason,
      cancelled_at: new Date(),
      cancelled_by_user_id: userId,
    });
    return loadPurchaseOrThrow(tx, id);
  });
}

export async function cancelPurchase(id: string, userId: string, input?: CancelInput) {
  return prisma.$transaction(async (tx) => {
    const purchase = await tx.purchase.findUnique({
      where: { id },
      select: { status: true, kind: true },
    });
    if (!purchase) throw new NotFoundError('Purchase');
    // Once a purchase is VERIFIED its stock has already landed — cancelling
    // would silently leave units in the warehouse. Operators must file a
    // write-off / adjustment to back it out.
    if (purchase.status === PurchaseStatus.VERIFIED) {
      throw new ConflictError(
        'Cannot cancel a verified purchase — file a write-off or adjustment instead',
      );
    }
    if (purchase.status === PurchaseStatus.CANCELLED) {
      return loadPurchaseOrThrow(tx, id);
    }
    // Force operators to /return a DISPATCHED errand first (so cash gets
    // reconciled). Then /cancel from RETURNED is a clean no-stock cancel.
    if (purchase.status === PurchaseStatus.DISPATCHED) {
      throw new ConflictError(
        'Cannot cancel a dispatched errand — record the runner\'s return first',
      );
    }
    await tx.purchase.update({
      where: { id },
      data: {
        status: PurchaseStatus.CANCELLED,
        cancel_reason: input?.cancel_reason ?? null,
        cancelled_at: new Date(),
        canceller: { connect: { id: userId } },
      },
    });
    return loadPurchaseOrThrow(tx, id);
  });
}

// ─── Helpers (stock absorption + received-item bookkeeping) ─────────────────

async function applyReceivedItems(
  tx: Tx,
  purchaseId: string,
  existingItems: { id: string }[],
  inputs: ReceiveInput['items'],
): Promise<void> {
  if (!inputs?.length) return;
  const existingIds = new Set(existingItems.map((i) => i.id));
  for (const it of inputs) {
    if (!existingIds.has(it.id)) {
      throw new BadRequestError(`item ${it.id} is not part of purchase ${purchaseId}`);
    }
    const received = new Decimal(it.received_package_quantity);
    if (received.lt(0)) {
      throw new BadRequestError(`received_package_quantity for item ${it.id} cannot be negative`);
    }
    await tx.purchaseItem.update({
      where: { id: it.id },
      data: {
        received_package_quantity: received,
        shortfall_reason: it.shortfall_reason ?? null,
      },
    });
  }
}

/**
 * Walk a verified purchase's items and apply the stock + WAC + movement-log
 * triple. Mirrors the loop that used to live in confirmPurchase but reads
 * received_package_quantity (falling back to package_quantity for legacy /
 * confirm paths) — so a delivery that arrived short only absorbs what
 * actually landed.
 *
 * Caller is responsible for opening the transaction and flipping
 * status → VERIFIED before invoking this (the atomic claim must already
 * have succeeded so two concurrent verifies can't both apply stock).
 */
async function absorbStockWithinTx(
  tx: Tx,
  purchase: Prisma.PurchaseGetPayload<{
    include: { items: { include: { packaging: true } } };
  }>,
): Promise<void> {
  if (purchase.items.length === 0) {
    throw new BadRequestError('Cannot verify a purchase with no items');
  }

  let total = new Decimal(0);

  for (const item of purchase.items) {
    // Skip rows the supplier marked unavailable and that received 0; nothing
    // to absorb, no movement to log. We still recompute the purchase total
    // from what *was* ordered + priced, not what arrived, because the supplier
    // invoice tends to bill for the ordered quantity until the chargeback is
    // negotiated separately.
    const orderedPkg = new Decimal(item.package_quantity);
    const receivedPkg =
      item.received_package_quantity != null
        ? new Decimal(item.received_package_quantity)
        : orderedPkg;

    total = total.add(orderedPkg.mul(new Decimal(item.price_per_package)));

    if (receivedPkg.lte(0)) continue;

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
    const baseQty = receivedPkg.mul(unitsPerPackage);
    const unitCost = new Decimal(item.price_per_package).div(unitsPerPackage);

    await tx.purchaseItem.update({
      where: { id: item.id },
      data: { base_unit_quantity: baseQty, unit_cost: unitCost },
    });

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

    // WAC uses the supply-wide stock total; subtract this line's contribution
    // from the post-increment aggregate to get "before".
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

  await tx.purchase.update({
    where: { id: purchase.id },
    data: { total },
  });
}

// Re-export for tests / debugging — kept internal otherwise so external
// callers can't bypass the status flip.
export { absorbStockWithinTx as __absorbStockWithinTx };
// Suppress unused warnings for imports that other modules may not need yet.
void CashRegisterStatus;
void UserRole;
