import {
  CashRegisterStatus,
  OrderStatus,
  PaymentMethod,
  Prisma,
  ProductType,
  StockMovementType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { deductSaleFromInventory } from '../sales/service.js';
import type {
  AddOrderItemInput,
  CreateOrderInput,
  CreatePaymentInput,
  ListOrderQuery,
  UpdateOrderInput,
  UpdateOrderItemInput,
} from './schema.js';

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const orderInclude = {
  register: { select: { id: true, status: true, user_id: true } },
  user: { select: { id: true, name: true } },
  items: {
    orderBy: { created_at: 'asc' },
    include: {
      product: { select: { id: true, name: true, type: true, tax_id: true, station_id: true } },
      variant: { select: { id: true, name: true } },
      modifiers: true,
    },
  },
  payments: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.OrderInclude;

/**
 * Truncate a DateTime to midnight UTC. order_date is a DATE column; Prisma
 * accepts a JS Date and persists the date portion, but we normalize here so
 * two orders on the same civil day always produce the same key in the
 * (order_date, order_number) uniqueness constraint.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function loadOrderOrThrow(client: PrismaLike, id: string) {
  const row = await client.order.findUnique({ where: { id }, include: orderInclude });
  if (!row) throw new NotFoundError('Order');
  return row;
}

async function assertOrderOpen(client: PrismaLike, id: string): Promise<void> {
  const row = await client.order.findUnique({ where: { id }, select: { status: true } });
  if (!row) throw new NotFoundError('Order');
  if (row.status !== OrderStatus.OPEN) {
    throw new ConflictError(`Order is ${row.status.toLowerCase()} — cannot modify`);
  }
}

// Round half-up to nearest centavo. Every place that computes tax must use the
// same rounding so line-level + order-level tax stays internally consistent.
function computeLineTax(lineTotal: Decimal, taxRate: Decimal | number | string): Decimal {
  const rate = new Decimal(taxRate);
  if (rate.isZero()) return new Decimal(0);
  return lineTotal.mul(rate.div(100)).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
}

/**
 * Recompute subtotal / tax / total from the current set of order_items.
 * Tax is the sum of each item's per-line snapshot (tax_rate × line_total),
 * already stored on the item. Discount is applied to the overall total.
 *
 * Must be invoked after every add / update / remove / discount change.
 */
async function recalculateOrderTotals(tx: Tx, orderId: string): Promise<void> {
  const [order, items] = await Promise.all([
    tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { discount_amount: true },
    }),
    tx.orderItem.findMany({
      where: { order_id: orderId },
      select: { line_total: true, tax_amount: true },
    }),
  ]);

  let subtotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  for (const item of items) {
    subtotal = subtotal.add(new Decimal(item.line_total));
    taxAmount = taxAmount.add(new Decimal(item.tax_amount));
  }

  const discount = new Decimal(order.discount_amount);
  // total >= 0 always: even if the user sets a discount larger than the subtotal+tax
  // we clamp to zero so payments can complete without a negative balance.
  const gross = subtotal.add(taxAmount).sub(discount);
  const total = gross.isNegative() ? new Decimal(0) : gross;

  await tx.order.update({
    where: { id: orderId },
    data: { subtotal, tax_amount: taxAmount, total },
  });
}

/**
 * Allocate the next order_number for today. We count same-day orders and add 1.
 * Collisions are possible under concurrency — the unique constraint on
 * (order_date, order_number) will throw P2002 which we catch and retry up to
 * a handful of times. This is simpler than a dedicated sequence table and
 * plenty fast for a single-café deployment.
 */
async function nextOrderNumber(tx: Tx, date: Date): Promise<number> {
  const latest = await tx.order.findFirst({
    where: { order_date: date },
    orderBy: { order_number: 'desc' },
    select: { order_number: true },
  });
  return (latest?.order_number ?? 0) + 1;
}

// ----------------------------------------------------------------------------
// Order CRUD
// ----------------------------------------------------------------------------

export async function createOrder(userId: string, input: CreateOrderInput) {
  return prisma.$transaction(async (tx) => {
    const register = await tx.cashRegister.findUnique({
      where: { id: input.register_id },
      select: { id: true, status: true, user_id: true },
    });
    if (!register) throw new BadRequestError('register_id references a non-existent register');
    if (register.status !== CashRegisterStatus.OPEN) {
      throw new ConflictError('Cannot create an order while the cash register is closed');
    }

    const date = todayUtc();

    // Retry a few times if two concurrent creates race on the same number.
    const MAX_ATTEMPTS = 5;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const orderNumber = await nextOrderNumber(tx, date);
      try {
        const order = await tx.order.create({
          data: {
            register_id: input.register_id,
            user_id: userId,
            order_type: input.order_type,
            notes: input.notes,
            order_number: orderNumber,
            order_date: date,
          },
        });
        return loadOrderOrThrow(tx, order.id);
      } catch (err) {
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === 'P2002' &&
          attempt < MAX_ATTEMPTS
        ) {
          continue;
        }
        throw err;
      }
    }
    throw new ConflictError('Could not allocate an order number — please retry');
  });
}

export async function listOrders(query: ListOrderQuery) {
  const where: Prisma.OrderWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.register_id ? { register_id: query.register_id } : {}),
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.order_type ? { order_type: query.order_type } : {}),
    ...(query.from || query.to
      ? {
          created_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.order.findMany({
    where,
    orderBy: [{ created_at: 'desc' }, { id: 'asc' }],
    include: orderInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getOrder(id: string) {
  return loadOrderOrThrow(prisma, id);
}

export async function updateOrder(id: string, input: UpdateOrderInput) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, id);
    await tx.order.update({
      where: { id },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.order_type !== undefined ? { order_type: input.order_type } : {}),
        ...(input.discount_amount !== undefined
          ? { discount_amount: new Decimal(input.discount_amount) }
          : {}),
        ...(input.discount_reason !== undefined ? { discount_reason: input.discount_reason } : {}),
      },
    });
    if (input.discount_amount !== undefined) {
      await recalculateOrderTotals(tx, id);
    }
    return loadOrderOrThrow(tx, id);
  });
}

export async function cancelOrder(id: string) {
  return prisma.$transaction(async (tx) => {
    // Atomic OPEN→CANCELLED claim. Any other status (PAID, already CANCELLED)
    // fails the count==0 check and throws a 409.
    const claim = await tx.order.updateMany({
      where: { id, status: OrderStatus.OPEN },
      data: { status: OrderStatus.CANCELLED },
    });
    if (claim.count === 0) {
      const existing = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new NotFoundError('Order');
      if (existing.status === OrderStatus.PAID) {
        throw new ConflictError('Cannot cancel a paid order');
      }
      throw new ConflictError('Order already cancelled');
    }
    return loadOrderOrThrow(tx, id);
  });
}

// ----------------------------------------------------------------------------
// Order items
// ----------------------------------------------------------------------------

/**
 * Snapshot prices at the moment of adding an item. Once persisted the line
 * doesn't chase future menu changes — a receipt printed tomorrow must match
 * a receipt printed today.
 */
async function resolveOrderLine(
  tx: Tx,
  input: AddOrderItemInput,
): Promise<{
  productId: string;
  variantId: string | null;
  unitPrice: Decimal;
  modifiersPrice: Decimal;
  taxRate: Decimal;
  modifierRows: { modifier_id: string; name: string; extra_price: Decimal }[];
}> {
  const product = await tx.product.findFirst({
    where: { id: input.product_id, deleted_at: null },
    select: {
      id: true,
      type: true,
      active: true,
      sell_price: true,
      tax: { select: { rate: true } },
    },
  });
  if (!product) throw new NotFoundError('Product');
  if (!product.active) throw new BadRequestError('Product is inactive');
  if (product.type === ProductType.PREPARATION) {
    throw new BadRequestError('PREPARATION products cannot be sold');
  }

  let variantId: string | null = null;
  let unitPrice: Decimal;

  if (input.variant_id) {
    if (product.type !== ProductType.DISH) {
      throw new BadRequestError('Only DISH products have variants');
    }
    const variant = await tx.productVariant.findUnique({
      where: { id: input.variant_id },
      select: { id: true, product_id: true, sell_price: true, active: true },
    });
    if (!variant || variant.product_id !== input.product_id) {
      throw new NotFoundError('ProductVariant');
    }
    if (!variant.active) throw new BadRequestError('Variant is inactive');
    variantId = variant.id;
    unitPrice = new Decimal(variant.sell_price);
  } else {
    if (product.sell_price == null) {
      throw new BadRequestError('Product has no sell_price — cannot add to order');
    }
    unitPrice = new Decimal(product.sell_price);
  }

  // Snapshot the product's current tax rate onto the line. Products without a
  // tax_id are tax-exempt (rate stays 0).
  const taxRate = product.tax ? new Decimal(product.tax.rate) : new Decimal(0);

  const modifierRows: { modifier_id: string; name: string; extra_price: Decimal }[] = [];
  let modifiersPrice = new Decimal(0);

  if (input.modifier_ids?.length) {
    const modifiers = await tx.modifier.findMany({
      where: { id: { in: input.modifier_ids } },
      select: { id: true, name: true, extra_price: true, active: true },
    });
    if (modifiers.length !== input.modifier_ids.length) {
      const found = new Set(modifiers.map((m) => m.id));
      const missing = input.modifier_ids.find((id) => !found.has(id));
      throw new NotFoundError(`Modifier ${missing}`);
    }
    // Preserve the caller's order so repeated modifiers (e.g. 2× "Extra Shot"
    // listed explicitly) deduct as many times as requested.
    for (const id of input.modifier_ids) {
      const m = modifiers.find((x) => x.id === id)!;
      if (!m.active) throw new BadRequestError(`Modifier ${id} is inactive`);
      const extra = new Decimal(m.extra_price);
      modifierRows.push({ modifier_id: m.id, name: m.name, extra_price: extra });
      modifiersPrice = modifiersPrice.add(extra);
    }
  }

  return { productId: product.id, variantId, unitPrice, modifiersPrice, taxRate, modifierRows };
}

export async function addOrderItem(orderId: string, input: AddOrderItemInput) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const quantity = input.quantity ?? 1;
    const resolved = await resolveOrderLine(tx, input);
    const lineTotal = resolved.unitPrice
      .add(resolved.modifiersPrice)
      .mul(quantity);
    const taxAmount = computeLineTax(lineTotal, resolved.taxRate);

    const item = await tx.orderItem.create({
      data: {
        order_id: orderId,
        product_id: resolved.productId,
        variant_id: resolved.variantId,
        quantity,
        unit_price: resolved.unitPrice,
        modifiers_price: resolved.modifiersPrice,
        line_total: lineTotal,
        tax_rate: resolved.taxRate,
        tax_amount: taxAmount,
        notes: input.notes,
      },
    });

    if (resolved.modifierRows.length > 0) {
      await tx.orderItemModifier.createMany({
        data: resolved.modifierRows.map((m) => ({
          order_item_id: item.id,
          modifier_id: m.modifier_id,
          name: m.name,
          extra_price: m.extra_price,
        })),
      });
    }

    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

export async function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const existing = await tx.orderItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        order_id: true,
        quantity: true,
        unit_price: true,
        modifiers_price: true,
        tax_rate: true,
      },
    });
    if (!existing || existing.order_id !== orderId) throw new NotFoundError('OrderItem');

    const quantity = input.quantity ?? existing.quantity;
    const lineTotal = new Decimal(existing.unit_price)
      .add(new Decimal(existing.modifiers_price))
      .mul(quantity);
    const taxAmount = computeLineTax(lineTotal, existing.tax_rate);

    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        ...(input.quantity !== undefined ? { quantity } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        line_total: lineTotal,
        tax_amount: taxAmount,
      },
    });

    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

export async function removeOrderItem(orderId: string, itemId: string) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const existing = await tx.orderItem.findUnique({
      where: { id: itemId },
      select: { id: true, order_id: true },
    });
    if (!existing || existing.order_id !== orderId) throw new NotFoundError('OrderItem');
    await tx.orderItem.delete({ where: { id: itemId } });
    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

// ----------------------------------------------------------------------------
// Payments & checkout
// ----------------------------------------------------------------------------

/**
 * Record a payment against an order. Splits are supported — call repeatedly
 * with the same order_id. When the running total of payments first covers
 * the order total, this call ALSO:
 *  - flips order.status to PAID (atomic claim so two racing tenders can't both settle),
 *  - calls deductSaleFromInventory for all order lines,
 *  - updates the cash register's expected_amount by (cash_payments - change_given).
 *
 * All of the above runs in one Prisma transaction.
 *
 * Payment rules:
 *  - CASH: amount >= remaining; change_amount = amount - remaining
 *  - CARD / TRANSFER: amount must equal remaining exactly (no change given)
 *  - Any method: amount may NOT exceed remaining for non-CASH (overpay is only
 *    allowed on cash, since that's how change works in real life)
 */
export async function addPayment(orderId: string, input: CreatePaymentInput) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        total: true,
        register_id: true,
        items: {
          select: {
            product_id: true,
            variant_id: true,
            quantity: true,
            modifiers: { select: { modifier_id: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictError(
        order.status === OrderStatus.PAID
          ? 'Order already paid'
          : 'Cancelled orders cannot accept payment',
      );
    }
    if (order.items.length === 0) {
      throw new BadRequestError('Cannot pay for an order with no items');
    }

    // Register must still be OPEN when the tender is rung up — this also
    // prevents settling an order whose register has been closed out of band.
    const register = await tx.cashRegister.findUnique({
      where: { id: order.register_id },
      select: { id: true, status: true },
    });
    if (!register || register.status !== CashRegisterStatus.OPEN) {
      throw new ConflictError('Cash register must be OPEN to record a payment');
    }

    const total = new Decimal(order.total);
    const paidSoFar = await tx.payment.aggregate({
      where: { order_id: orderId },
      _sum: { amount: true, change_amount: true },
    });
    const netPaid = new Decimal(paidSoFar._sum.amount ?? 0).sub(
      new Decimal(paidSoFar._sum.change_amount ?? 0),
    );
    const remaining = total.sub(netPaid);

    if (remaining.lte(0)) {
      // Defensive — status should already be PAID in this case, but a previous
      // partial failure could theoretically leave an OPEN order fully tendered.
      throw new ConflictError('Order is already fully paid');
    }

    const amount = new Decimal(input.amount);
    let changeAmount = new Decimal(0);

    if (input.method === PaymentMethod.CASH) {
      // A cash tender can be partial (< remaining, no change) OR final
      // (>= remaining, change = overpay). Both are common in splits.
      changeAmount = amount.lt(remaining) ? new Decimal(0) : amount.sub(remaining);
    } else {
      // CARD / TRANSFER per SPEC.md §7.6: "amount must equal exactly what's
      // owed (no change)". Splits with card/transfer therefore settle the
      // remaining balance in full — cash-first splits remain possible.
      if (!amount.equals(remaining)) {
        throw new BadRequestError(
          `${input.method} payment must equal the remaining balance exactly (${remaining.toString()} centavos)`,
        );
      }
    }

    const payment = await tx.payment.create({
      data: {
        order_id: orderId,
        method: input.method,
        amount,
        change_amount: changeAmount,
        reference: input.reference ?? null,
      },
    });

    // Update the running "net paid" with this payment.
    const newNetPaid = netPaid.add(amount).sub(changeAmount);
    const fullyPaid = newNetPaid.gte(total);

    // Always reflect cash tenders in the register's expected_amount, not only
    // on checkout — the drawer is opened for each cash tender regardless.
    if (input.method === PaymentMethod.CASH) {
      const cashDelta = amount.sub(changeAmount);
      if (!cashDelta.isZero()) {
        await tx.cashRegister.update({
          where: { id: order.register_id },
          data: { expected_amount: { increment: cashDelta } },
        });
      }
    }

    let deductionResult = null as Awaited<ReturnType<typeof deductSaleFromInventory>> | null;
    if (fullyPaid) {
      // Atomic OPEN→PAID claim — prevents two simultaneous final tenders from
      // double-deducting inventory.
      const claim = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.OPEN },
        data: { status: OrderStatus.PAID },
      });
      if (claim.count === 0) {
        throw new ConflictError('Order status changed concurrently — please retry');
      }

      deductionResult = await deductSaleFromInventory(
        order.items.map((item) => ({
          product_id: item.product_id,
          variant_id: item.variant_id,
          quantity: item.quantity,
          modifier_ids: item.modifiers.map((m) => m.modifier_id),
        })),
        null, // no station concept in Phase 7 — deduction rule falls back to register or last-purchase
        orderId,
        { pos_register_id: order.register_id, client: tx },
      );
    }

    return {
      payment,
      order: await loadOrderOrThrow(tx, orderId),
      deduction: deductionResult,
    };
  });
}

// ----------------------------------------------------------------------------
// Ingredients actually deducted for an order
// ----------------------------------------------------------------------------

export interface OrderIngredientRow {
  supply_id: string;
  supply_name: string;
  quantity: string;
  unit: string;
  unit_cost: string;
  total_cost: string;
}

export interface OrderIngredientsResult {
  order_id: string;
  ingredients: OrderIngredientRow[];
  grand_total_cost: string;
}

// Reads the SALE StockMovements written when the order was paid. Unlike the
// product-analysis endpoint this is truthful — one order, exactly what was
// drawn. Returns an empty ingredients list for orders that never reached PAID
// (OPEN / CANCELLED) since no movements would exist.
export async function getOrderIngredients(orderId: string): Promise<OrderIngredientsResult> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!order) throw new NotFoundError('Order');

  const movements = await prisma.stockMovement.findMany({
    where: {
      reference_type: 'Order',
      reference_id: orderId,
      type: StockMovementType.SALE,
    },
    select: {
      supply_id: true,
      quantity: true,
      unit_cost: true,
      supply: { select: { name: true, base_unit: true } },
    },
    orderBy: { created_at: 'asc' },
  });

  let grandTotal = new Decimal(0);
  const ingredients: OrderIngredientRow[] = movements.map((m) => {
    // SALE rows are stored as negative quantities — present the positive value
    // so consumers don't have to remember to flip signs.
    const qty = new Decimal(m.quantity).abs();
    const unitCost = new Decimal(m.unit_cost);
    const total = qty.mul(unitCost);
    grandTotal = grandTotal.add(total);
    return {
      supply_id: m.supply_id,
      supply_name: m.supply.name,
      quantity: qty.toString(),
      unit: m.supply.base_unit,
      unit_cost: unitCost.toString(),
      total_cost: total.toString(),
    };
  });

  return {
    order_id: orderId,
    ingredients,
    grand_total_cost: grandTotal.toString(),
  };
}
