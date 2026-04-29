import {
  CashRegisterStatus,
  OrderStatus,
  OrderType,
  PaymentMethod,
  Prisma,
  ProductType,
  ShiftType,
  StockMovementType,
  TableStatus,
  TakeoutChannel,
  type UserRole,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { Decimal } from '../../lib/decimal.js';
import { deductSaleFromInventory } from '../sales/service.js';
import { getSetting } from '../settings/service.js';
import { SETTING_KEYS } from '../settings/schema.js';
import type {
  AddOrderItemInput,
  CancelOrderInput,
  CreateOrderInput,
  CreatePaymentInput,
  ListOrderQuery,
  RemoveOrderItemInput,
  RequestAttentionInput,
  RestoreOrderItemInput,
  UpdateOrderInput,
  UpdateOrderItemInput,
} from './schema.js';
import { ForbiddenError } from '../../lib/errors.js';

/**
 * Re-authenticate ANY active CASHIER/MANAGER/ADMIN by PIN — used to gate
 * destructive actions on items that have already left the workspace (sent to
 * kitchen, the comanda was printed, or the order is being voided). The flow
 * is "waiter clicks → cashier walks over and types their PIN to approve",
 * so the PIN is matched against the cashier ring rather than the JWT user.
 *
 * Returns the approving user's id so the caller can record it in audit fields.
 */
async function authorizeCashierPin(pin: string | undefined): Promise<string> {
  if (!pin) throw new ForbiddenError('Cashier PIN required');
  const matches = await prisma.user.findMany({
    where: {
      pin,
      active: true,
      role: { in: ['CASHIER', 'MANAGER', 'ADMIN'] },
    },
    take: 2,
    select: { id: true },
  });
  if (matches.length === 0) {
    throw new ForbiddenError('Incorrect PIN');
  }
  if (matches.length > 1) {
    // Two cashiers sharing a PIN can't approve — admin needs to fix the dupes.
    throw new ConflictError(
      'PIN is shared by multiple active users — ask an admin to assign unique PINs',
    );
  }
  return matches[0].id;
}

type Tx = Prisma.TransactionClient;
type PrismaLike = Tx | typeof prisma;

const orderInclude = {
  register: { select: { id: true, status: true, user_id: true } },
  user: { select: { id: true, name: true } },
  // cancelled_by is null for OPEN/PAID orders. The admin timeline surfaces
  // who pulled the trigger when the order was voided.
  cancelled_by: { select: { id: true, name: true } },
  table: {
    select: {
      id: true,
      number: true,
      capacity: true,
      status: true,
      zone: { select: { id: true, name: true } },
    },
  },
  items: {
    // Sort active lines first, then voided lines at the bottom — the cashier
    // sees the live ticket up top with the struck-through history below.
    orderBy: [{ voided_at: 'asc' }, { created_at: 'asc' }],
    include: {
      product: { select: { id: true, name: true, type: true, tax_id: true, station_id: true } },
      variant: { select: { id: true, name: true } },
      modifiers: true,
      added_by_user: { select: { id: true, name: true } },
      voided_by_user: { select: { id: true, name: true } },
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

/**
 * Tax-inclusive split for one line. line_total is what the customer pays;
 * base is the revenue portion and tax is what gets remitted.
 *
 *   base = round(line_total / (1 + rate/100))
 *   tax  = line_total - base
 *
 * Deriving tax as the remainder (instead of computing both independently)
 * guarantees base + tax === line_total even after rounding — the receipt
 * never shows a 1-centavo gap.
 */
function computeTaxInclusive(
  lineTotal: Decimal,
  taxRate: Decimal | number | string,
): { base: Decimal; tax: Decimal } {
  const rate = new Decimal(taxRate);
  if (rate.isZero()) return { base: lineTotal, tax: new Decimal(0) };
  const divisor = new Decimal(1).add(rate.div(100));
  const base = lineTotal.div(divisor).toDecimalPlaces(0, Decimal.ROUND_HALF_UP);
  const tax = lineTotal.sub(base);
  return { base, tax };
}

/**
 * Recompute subtotal / tax / total from the current set of order_items under
 * tax-inclusive pricing:
 *
 *   order.total    = sum(line_totals) - discount   (what the customer pays)
 *   order.tax      = sum(tax_amounts)              (tax portion extracted)
 *   order.subtotal = order.total - order.tax       (revenue before tax)
 *
 * This inverts the historical tax-added-on-top formula: subtotal is now
 * LESS than total, not more. Discount is applied to the tax-inclusive
 * total and does NOT retroactively change the per-line tax snapshots.
 *
 * Must be invoked after every add / update / remove / discount change.
 */
async function recalculateOrderTotals(tx: Tx, orderId: string): Promise<void> {
  const [order, items] = await Promise.all([
    tx.order.findUniqueOrThrow({
      where: { id: orderId },
      select: { discount_amount: true },
    }),
    // Voided lines are kept on the ticket for audit + Restore but contribute
    // zero to subtotal/tax/total — same convention as a hard-deleted line.
    tx.orderItem.findMany({
      where: { order_id: orderId, voided_at: null },
      select: { line_total: true, tax_amount: true },
    }),
  ]);

  let grossTotal = new Decimal(0);
  let taxAmount = new Decimal(0);

  for (const item of items) {
    grossTotal = grossTotal.add(new Decimal(item.line_total));
    taxAmount = taxAmount.add(new Decimal(item.tax_amount));
  }

  const discount = new Decimal(order.discount_amount);
  // total >= 0: even if the user sets a discount larger than the gross, clamp
  // so payments can complete without a negative balance.
  const afterDiscount = grossTotal.sub(discount);
  const total = afterDiscount.isNegative() ? new Decimal(0) : afterDiscount;
  // subtotal is the base (revenue) portion of what the customer actually
  // pays: total - tax. Computed after the discount clamp so it follows total.
  const subtotal = total.sub(taxAmount);
  const subtotalClamped = subtotal.isNegative() ? new Decimal(0) : subtotal;

  await tx.order.update({
    where: { id: orderId },
    data: { subtotal: subtotalClamped, tax_amount: taxAmount, total },
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

/**
 * Validate a table assignment for a DINE_IN order. RESERVED tables are open
 * for seating (the host marked them held for a customer who has now arrived);
 * inactive tables and TAKEOUT-with-table combinations are rejected.
 */
async function assertTableAssignable(
  tx: Tx,
  tableId: string,
  orderType: OrderType,
): Promise<void> {
  if (orderType !== OrderType.DINE_IN) {
    throw new BadRequestError('Only DINE_IN orders can be assigned to a table');
  }
  const table = await tx.table.findUnique({
    where: { id: tableId },
    select: { id: true, active: true, number: true },
  });
  if (!table) throw new BadRequestError('table_id references a non-existent table');
  if (!table.active) {
    throw new BadRequestError(`Table ${table.number} is inactive`);
  }
}

/**
 * Reflect the table's badge state from the OPEN orders attached to it. Called
 * after every status transition that could change the count: order create
 * (set OCCUPIED), pay/cancel/reseat (release if no remaining open orders).
 *
 * RESERVED is left alone — it's a manual host-only state. Any other state
 * (AVAILABLE / OCCUPIED) is recomputed from the current open-order count.
 */
async function syncTableStatus(tx: Tx, tableId: string): Promise<void> {
  const table = await tx.table.findUnique({
    where: { id: tableId },
    select: { status: true },
  });
  if (!table) return;
  if (table.status === TableStatus.RESERVED) return;

  const openCount = await tx.order.count({
    where: { table_id: tableId, status: OrderStatus.OPEN },
  });
  const next = openCount > 0 ? TableStatus.OCCUPIED : TableStatus.AVAILABLE;
  if (next !== table.status) {
    await tx.table.update({ where: { id: tableId }, data: { status: next } });
  }
}

// ----------------------------------------------------------------------------
// Order CRUD
// ----------------------------------------------------------------------------

const TAKEOUT_CHANNEL_SETTING_KEY: Record<TakeoutChannel, string> = {
  LOCAL: 'takeout_channel_local_active',
  DELIVERY_LOCAL: 'takeout_channel_delivery_local_active',
  DELIVERY_APP: 'takeout_channel_delivery_app_active',
};

const TAKEOUT_CHANNEL_LABEL: Record<TakeoutChannel, string> = {
  LOCAL: 'Local pickup',
  DELIVERY_LOCAL: 'Local delivery',
  DELIVERY_APP: 'Delivery app',
};

// Settings store the per-channel active flag as a string ("true" / "false").
// We treat anything that isn't an explicit "false" as enabled — that matches
// the migration default and avoids breaking when a key was wiped manually.
async function assertTakeoutChannelActive(
  tx: Prisma.TransactionClient,
  channel: TakeoutChannel,
): Promise<void> {
  const value = await getSetting(TAKEOUT_CHANNEL_SETTING_KEY[channel], tx);
  if (value === 'false') {
    throw new BadRequestError(
      `${TAKEOUT_CHANNEL_LABEL[channel]} is currently disabled — enable it in settings before taking orders for this channel`,
    );
  }
}

// Centralise the order_type ↔ takeout_channel rules so create/update share
// them. For TAKEOUT, channel is required and must be active. For DINE_IN, a
// channel is meaningless and is rejected outright.
async function validateOrderTypeAndChannel(
  tx: Prisma.TransactionClient,
  orderType: OrderType,
  channel: TakeoutChannel | null | undefined,
): Promise<void> {
  if (orderType === OrderType.TAKEOUT) {
    if (!channel) {
      throw new BadRequestError(
        'takeout_channel is required for TAKEOUT orders',
      );
    }
    await assertTakeoutChannelActive(tx, channel);
  } else if (channel) {
    throw new BadRequestError(
      'takeout_channel is only valid for TAKEOUT orders',
    );
  }
}

// Empty strings from form fields collapse to null so the DB stays clean and
// "is the field set?" checks don't have to special-case "".
function nullifyBlank(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const trimmed = v.trim();
  return trimmed === '' ? null : trimmed;
}

const TAKEOUT_FIELD_KEYS = [
  'customer_name',
  'customer_phone',
  'delivery_address',
  'delivery_reference',
  'delivery_driver_name',
  'delivery_app',
  'delivery_app_order_id',
] as const;

interface TakeoutFieldsInput {
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_reference?: string | null;
  delivery_driver_name?: string | null;
  delivery_app?: string | null;
  delivery_app_order_id?: string | null;
}

// Build a Prisma data slice from the raw form input, dropping fields that
// weren't sent so a PATCH /orders/:id only touches what the cashier changed.
function pickTakeoutFields(
  input: TakeoutFieldsInput,
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const key of TAKEOUT_FIELD_KEYS) {
    const v = nullifyBlank(input[key]);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

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

    await validateOrderTypeAndChannel(tx, input.order_type, input.takeout_channel);

    if (input.table_id) {
      await assertTableAssignable(tx, input.table_id, input.order_type);
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
            takeout_channel:
              input.order_type === OrderType.TAKEOUT
                ? input.takeout_channel ?? null
                : null,
            table_id: input.table_id ?? null,
            notes: input.notes,
            order_number: orderNumber,
            order_date: date,
            ...(input.order_type === OrderType.TAKEOUT
              ? pickTakeoutFields(input)
              : {}),
          },
        });
        if (input.table_id) {
          await syncTableStatus(tx, input.table_id);
        }
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
    ...(query.table_id ? { table_id: query.table_id } : {}),
    // Zone filter relies on the relation — Prisma rewrites this into a join
    // on tables.zone_id. Cheap given the orders.table_id index.
    ...(query.zone_id ? { table: { zone_id: query.zone_id } } : {}),
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

    // Snapshot the current state — we need the old table_id to re-sync its
    // status if the user reseats, and the order_type so a new table_id is
    // validated against the correct (possibly just-changed) type.
    const current = await tx.order.findUniqueOrThrow({
      where: { id },
      select: {
        table_id: true,
        order_type: true,
        takeout_channel: true,
        register: { select: { type: true } },
      },
    });

    // Discount is the one PATCH field that's blocked on provisional shifts.
    // Floor staff running a side-flow shouldn't be cutting prices — that
    // decision belongs to the cashier on the parent shift. Other PATCH
    // fields (notes, table reseat, takeout snapshots) stay open.
    const settingDiscount =
      input.discount_amount !== undefined || input.discount_reason !== undefined;
    if (settingDiscount && current.register.type === ShiftType.PROVISIONAL) {
      throw new ForbiddenError(
        'Discounts are not allowed on a provisional shift',
      );
    }
    const nextOrderType = input.order_type ?? current.order_type;
    // Pick the next channel: explicit input wins, else keep the current one
    // unless the type is flipping to DINE_IN (which forces null).
    const nextChannel =
      nextOrderType === OrderType.DINE_IN
        ? null
        : input.takeout_channel !== undefined
          ? input.takeout_channel
          : current.takeout_channel;
    await validateOrderTypeAndChannel(tx, nextOrderType, nextChannel);
    if (input.table_id !== undefined && input.table_id !== null) {
      await assertTableAssignable(tx, input.table_id, nextOrderType);
    }

    // Flip back to DINE_IN clears every takeout snapshot field — keeps stale
    // delivery info from showing on a now-dine-in order.
    const clearTakeoutFields =
      input.order_type === OrderType.DINE_IN && current.order_type !== OrderType.DINE_IN;

    await tx.order.update({
      where: { id },
      data: {
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.order_type !== undefined ? { order_type: input.order_type } : {}),
        // Persist the resolved channel whenever the type or channel input
        // changed — covers "flip to DINE_IN clears channel" and explicit
        // channel updates.
        ...(input.order_type !== undefined || input.takeout_channel !== undefined
          ? { takeout_channel: nextChannel }
          : {}),
        ...(input.table_id !== undefined ? { table_id: input.table_id } : {}),
        ...(input.discount_amount !== undefined
          ? { discount_amount: new Decimal(input.discount_amount) }
          : {}),
        ...(input.discount_reason !== undefined ? { discount_reason: input.discount_reason } : {}),
        ...(clearTakeoutFields
          ? {
              customer_name: null,
              customer_phone: null,
              delivery_address: null,
              delivery_reference: null,
              delivery_driver_name: null,
              delivery_app: null,
              delivery_app_order_id: null,
            }
          : pickTakeoutFields(input)),
      },
    });
    if (input.discount_amount !== undefined) {
      await recalculateOrderTotals(tx, id);
    }

    // Re-sync both the old and new table so badges flip consistently when the
    // assignment moves (or detaches).
    if (input.table_id !== undefined) {
      if (current.table_id && current.table_id !== input.table_id) {
        await syncTableStatus(tx, current.table_id);
      }
      if (input.table_id) {
        await syncTableStatus(tx, input.table_id);
      }
    }

    return loadOrderOrThrow(tx, id);
  });
}

export async function cancelOrder(
  id: string,
  currentUserId: string,
  input: CancelOrderInput,
) {
  // Decide BEFORE opening a transaction whether this cancel needs cashier
  // approval. The rule: if any line on the order has been sent to the kitchen
  // we've made a promise to the kitchen, and voiding requires a written
  // reason + a cashier+'s PIN. Untouched orders (no items, or all items
  // unsent) are a no-friction cancel — waiters can void their own mistakes.
  // Voided lines no longer represent a live kitchen promise (the comanda
  // either already showed the void, or will on the next send) so they don't
  // count toward the "needs cashier approval" gate.
  const sentItems = await prisma.orderItem.count({
    where: { order_id: id, sent_to_kitchen: true, voided_at: null },
  });
  const requiresApproval = sentItems > 0;

  let approverId: string | null = null;
  let cancelReason: string | null = null;

  if (requiresApproval) {
    // Voiding a sent-to-kitchen ticket on a provisional shift is off-limits —
    // the cashier on the parent shift must do this once they take over. Floor
    // staff can still cancel orders that haven't reached the kitchen yet (the
    // requiresApproval=false branch below).
    const orderRegister = await prisma.order.findUnique({
      where: { id },
      select: { register: { select: { type: true } } },
    });
    if (orderRegister?.register.type === ShiftType.PROVISIONAL) {
      throw new ForbiddenError(
        'Cannot cancel an order with sent items on a provisional shift',
      );
    }
    if (!input.reason || input.reason.trim().length < 5) {
      throw new ForbiddenError('Reason required (5+ characters)');
    }
    approverId = await authorizeCashierPin(input.pin);
    cancelReason = input.reason.trim();
  } else {
    // Even on the free path we keep whatever reason the waiter typed so the
    // audit trail isn't completely silent. Skip the PIN check.
    cancelReason = input.reason?.trim() || null;
    approverId = currentUserId;
  }

  return prisma.$transaction(async (tx) => {
    // Snapshot table_id BEFORE the status flip so we still know which table to
    // re-sync after the order leaves OPEN.
    const before = await tx.order.findUnique({
      where: { id },
      select: { table_id: true },
    });

    // Atomic OPEN→CANCELLED claim. Any other status (PAID, already CANCELLED)
    // fails the count==0 check and throws a 409.
    const claim = await tx.order.updateMany({
      where: { id, status: OrderStatus.OPEN },
      data: {
        status: OrderStatus.CANCELLED,
        cancel_reason: cancelReason,
        cancelled_by_user_id: approverId,
        cancelled_at: new Date(),
      },
    });
    if (claim.count === 0) {
      const existing = await tx.order.findUnique({ where: { id }, select: { status: true } });
      if (!existing) throw new NotFoundError('Order');
      if (existing.status === OrderStatus.PAID) {
        throw new ConflictError('Cannot cancel a paid order');
      }
      throw new ConflictError('Order already cancelled');
    }
    if (before?.table_id) {
      await syncTableStatus(tx, before.table_id);
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
      tax_id: true,
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

  // Snapshot the applicable tax rate onto the line. Precedence:
  //   1. Product's own tax_id wins (including explicit 0% "Tax Exempt" taxes).
  //   2. If null, fall back to the default_tax_id setting.
  //   3. If neither resolves, the line is untaxed.
  let taxRate = new Decimal(0);
  if (product.tax) {
    taxRate = new Decimal(product.tax.rate);
  } else if (product.tax_id == null) {
    const defaultTaxId = await getSetting(SETTING_KEYS.DEFAULT_TAX_ID, tx);
    if (defaultTaxId) {
      const defaultTax = await tx.tax.findUnique({
        where: { id: defaultTaxId },
        select: { rate: true },
      });
      if (defaultTax) taxRate = new Decimal(defaultTax.rate);
    }
  }

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

export async function addOrderItem(
  orderId: string,
  input: AddOrderItemInput,
  userId?: string,
) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const quantity = input.quantity ?? 1;
    const resolved = await resolveOrderLine(tx, input);

    // Merge into an existing UNSENT line with the exact same shape (product /
    // variant / modifier set / notes) so repeated taps of the same drink show
    // up as a single "3× Bottled Water" instead of three separate 1× rows.
    // We never merge into a sent_to_kitchen=true line — once the comanda is
    // out, additions are a separate batch and need their own row so the
    // kitchen sees the new ticket.
    const incomingModIds = (resolved.modifierRows.map((m) => m.modifier_id))
      .slice()
      .sort();
    const incomingNotes = input.notes ?? null;

    const candidates = await tx.orderItem.findMany({
      where: {
        order_id: orderId,
        product_id: resolved.productId,
        variant_id: resolved.variantId,
        sent_to_kitchen: false,
        // Never merge into a voided line — it's struck-through on the ticket
        // and the cashier expects the new tap to show up as a fresh row.
        voided_at: null,
        notes: incomingNotes,
      },
      include: { modifiers: { select: { modifier_id: true } } },
    });

    const match = candidates.find((c) => {
      const cmIds = c.modifiers.map((m) => m.modifier_id).slice().sort();
      if (cmIds.length !== incomingModIds.length) return false;
      for (let i = 0; i < cmIds.length; i++) {
        if (cmIds[i] !== incomingModIds[i]) return false;
      }
      return true;
    });

    if (match) {
      const newQty = match.quantity + quantity;
      const newLineTotal = resolved.unitPrice
        .add(resolved.modifiersPrice)
        .mul(newQty);
      const { base, tax } = computeTaxInclusive(newLineTotal, resolved.taxRate);
      await tx.orderItem.update({
        where: { id: match.id },
        data: {
          quantity: newQty,
          line_total: newLineTotal,
          tax_amount: tax,
          base_amount: base,
        },
      });
    } else {
      const lineTotal = resolved.unitPrice
        .add(resolved.modifiersPrice)
        .mul(quantity);
      const { base, tax } = computeTaxInclusive(lineTotal, resolved.taxRate);

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
          tax_amount: tax,
          base_amount: base,
          notes: input.notes,
          added_by: userId ?? null,
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
    }

    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

/**
 * Re-resolve the price of an order line given a (possibly new) variant and
 * modifier set. Mirrors the validation in resolveOrderLine but reuses the
 * snapshot tax_rate and product_id from the existing line — the customer is
 * editing one ticket row, not adding a different product.
 */
async function resolveItemEdit(
  tx: Tx,
  productId: string,
  variantId: string | null,
  modifierIds: string[],
): Promise<{
  variantId: string | null;
  unitPrice: Decimal;
  modifiersPrice: Decimal;
  modifierRows: { modifier_id: string; name: string; extra_price: Decimal }[];
}> {
  const product = await tx.product.findFirst({
    where: { id: productId, deleted_at: null },
    select: { id: true, type: true, active: true, sell_price: true },
  });
  if (!product) throw new NotFoundError('Product');
  if (!product.active) throw new BadRequestError('Product is inactive');

  let unitPrice: Decimal;
  if (variantId) {
    if (product.type !== ProductType.DISH) {
      throw new BadRequestError('Only DISH products have variants');
    }
    const variant = await tx.productVariant.findUnique({
      where: { id: variantId },
      select: { id: true, product_id: true, sell_price: true, active: true },
    });
    if (!variant || variant.product_id !== productId) {
      throw new NotFoundError('ProductVariant');
    }
    if (!variant.active) throw new BadRequestError('Variant is inactive');
    unitPrice = new Decimal(variant.sell_price);
  } else {
    if (product.sell_price == null) {
      throw new BadRequestError('Product has no sell_price — cannot reprice line');
    }
    unitPrice = new Decimal(product.sell_price);
  }

  const modifierRows: { modifier_id: string; name: string; extra_price: Decimal }[] = [];
  let modifiersPrice = new Decimal(0);
  if (modifierIds.length) {
    const modifiers = await tx.modifier.findMany({
      where: { id: { in: modifierIds } },
      select: { id: true, name: true, extra_price: true, active: true },
    });
    if (modifiers.length !== modifierIds.length) {
      const found = new Set(modifiers.map((m) => m.id));
      const missing = modifierIds.find((id) => !found.has(id));
      throw new NotFoundError(`Modifier ${missing}`);
    }
    for (const id of modifierIds) {
      const m = modifiers.find((x) => x.id === id)!;
      if (!m.active) throw new BadRequestError(`Modifier ${id} is inactive`);
      const extra = new Decimal(m.extra_price);
      modifierRows.push({ modifier_id: m.id, name: m.name, extra_price: extra });
      modifiersPrice = modifiersPrice.add(extra);
    }
  }

  return { variantId, unitPrice, modifiersPrice, modifierRows };
}

export async function updateOrderItem(
  orderId: string,
  itemId: string,
  input: UpdateOrderItemInput,
) {
  // Sent-to-kitchen items represent a real promise to the kitchen — quantity
  // edits and other tweaks need a fresh PIN check before touching the line.
  // Notes-only edits are also gated since the kitchen may have already worked
  // off the printed comanda. The PIN is matched against any active cashier+
  // (waiter→cashier authorization), not the JWT user.
  //
  // Voided lines are read-only here — the cashier must Restore them first
  // before any edit. This keeps the audit trail honest: a voided line stays
  // exactly as it was at the moment it was voided.
  const preflight = await prisma.orderItem.findUnique({
    where: { id: itemId },
    select: {
      sent_to_kitchen: true,
      order_id: true,
      voided_at: true,
    },
  });
  if (!preflight || preflight.order_id !== orderId) {
    throw new NotFoundError('OrderItem');
  }
  if (preflight.voided_at != null) {
    throw new ConflictError('Voided items cannot be edited — restore the item first');
  }
  if (preflight.sent_to_kitchen) {
    await authorizeCashierPin(input.pin);
  }

  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const existing = await tx.orderItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        order_id: true,
        product_id: true,
        variant_id: true,
        quantity: true,
        unit_price: true,
        modifiers_price: true,
        tax_rate: true,
        modifiers: { select: { modifier_id: true } },
      },
    });
    if (!existing || existing.order_id !== orderId) throw new NotFoundError('OrderItem');

    // Re-price + replace modifiers iff the caller actually sent shape changes.
    // Notes/qty-only edits skip the re-resolve so they don't pay for an extra
    // round-trip and don't accidentally re-validate a now-inactive variant.
    const reshape = input.variant_id !== undefined || input.modifier_ids !== undefined;

    let unitPrice = new Decimal(existing.unit_price);
    let modifiersPrice = new Decimal(existing.modifiers_price);
    let nextVariantId = existing.variant_id;
    let nextModifierRows: { modifier_id: string; name: string; extra_price: Decimal }[] | null =
      null;

    if (reshape) {
      const targetVariantId =
        input.variant_id !== undefined ? input.variant_id : existing.variant_id;
      const targetModifierIds =
        input.modifier_ids !== undefined
          ? input.modifier_ids
          : existing.modifiers.map((m) => m.modifier_id);
      const resolved = await resolveItemEdit(
        tx,
        existing.product_id,
        targetVariantId,
        targetModifierIds,
      );
      unitPrice = resolved.unitPrice;
      modifiersPrice = resolved.modifiersPrice;
      nextVariantId = resolved.variantId;
      nextModifierRows = resolved.modifierRows;
    }

    const quantity = input.quantity ?? existing.quantity;
    const lineTotal = unitPrice.add(modifiersPrice).mul(quantity);
    const { base, tax } = computeTaxInclusive(lineTotal, existing.tax_rate);

    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        ...(input.quantity !== undefined ? { quantity } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(reshape
          ? {
              variant_id: nextVariantId,
              unit_price: unitPrice,
              modifiers_price: modifiersPrice,
            }
          : {}),
        line_total: lineTotal,
        tax_amount: tax,
        base_amount: base,
      },
    });

    if (nextModifierRows) {
      // Wipe + reinsert is the simplest correct operation; OrderItemModifier
      // has no FK references pointing at it (the cascading is one-way) so a
      // delete-many followed by createMany inside the same transaction is
      // both atomic and cheap (modifier counts per line are tiny).
      await tx.orderItemModifier.deleteMany({ where: { order_item_id: itemId } });
      if (nextModifierRows.length > 0) {
        await tx.orderItemModifier.createMany({
          data: nextModifierRows.map((m) => ({
            order_item_id: itemId,
            modifier_id: m.modifier_id,
            name: m.name,
            extra_price: m.extra_price,
          })),
        });
      }
    }

    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

/**
 * Remove an order line. Two paths depending on whether the line ever made it
 * to the kitchen:
 *   • Unsent line → hard delete. No audit trail needed because the kitchen
 *     never knew it existed.
 *   • Sent line   → soft-delete (void). The row stays on the ticket struck
 *     through with a Restore option, totals/inventory ignore it, and the
 *     next Send to Kitchen prints a "REMOVED" notification so the cooks know
 *     to drop it. Voided lines store voided_by / void_reason for the audit
 *     log; restoring re-runs the same flow in reverse.
 *
 * The PIN check is required for either path on a sent line — the same gate
 * that protects qty-edits / notes on sent items.
 */
export async function removeOrderItem(
  orderId: string,
  itemId: string,
  input: RemoveOrderItemInput,
) {
  const preflight = await prisma.orderItem.findUnique({
    where: { id: itemId },
    select: { sent_to_kitchen: true, order_id: true, voided_at: true },
  });
  if (!preflight || preflight.order_id !== orderId) {
    throw new NotFoundError('OrderItem');
  }
  if (preflight.voided_at != null) {
    throw new ConflictError('Item is already voided');
  }
  let approverId: string | null = null;
  if (preflight.sent_to_kitchen) {
    // Sent lines always need a categorical reason_code — reporting splits
    // merma vs. non-merma off it. The free-text `reason` is required ONLY
    // when the cashier picked OTHER, since the three named categories speak
    // for themselves. The kitchen still sees whatever text was provided on
    // the next comanda's REMOVED block.
    if (!input.reason_code) {
      throw new BadRequestError('reason_code is required when removing a sent item');
    }
    if (input.reason_code === 'OTHER') {
      const trimmedReason = input.reason?.trim() ?? '';
      if (trimmedReason.length < 3) {
        throw new BadRequestError('reason must be at least 3 characters when reason_code is OTHER');
      }
    }
    approverId = await authorizeCashierPin(input.pin);
  }

  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const existing = await tx.orderItem.findUnique({
      where: { id: itemId },
      select: { id: true, order_id: true, sent_to_kitchen: true, voided_at: true },
    });
    if (!existing || existing.order_id !== orderId) throw new NotFoundError('OrderItem');
    if (existing.voided_at != null) {
      throw new ConflictError('Item is already voided');
    }

    if (existing.sent_to_kitchen) {
      const trimmedReason = input.reason?.trim();
      // Soft delete — preserve the line as a tombstone the cashier can
      // restore and the kitchen comanda can announce.
      await tx.orderItem.update({
        where: { id: itemId },
        data: {
          voided_at: new Date(),
          voided_by: approverId,
          void_reason_code: input.reason_code ?? null,
          void_reason: trimmedReason && trimmedReason.length > 0 ? trimmedReason : null,
          // void_printed_at stays null so the next Send to Kitchen catches it
          // and prints the REMOVE notification.
          void_printed_at: null,
        },
      });
    } else {
      // Free-cancel path for unsent items — same as before. No audit row
      // because the kitchen has no expectation to disappoint.
      await tx.orderItem.delete({ where: { id: itemId } });
    }

    await recalculateOrderTotals(tx, orderId);
    return loadOrderOrThrow(tx, orderId);
  });
}

/**
 * Reverse a soft-delete. Two sub-paths:
 *   • Void was never printed → just clear the void fields and the line is
 *     back on the ticket as it was. No kitchen comms needed because the
 *     kitchen was never told it was gone.
 *   • Void was already printed → the kitchen has tossed (or never started)
 *     the item, so restoring it is effectively re-ordering. We clear the
 *     void fields AND reset sent_to_kitchen / sent_at / void_printed_at so
 *     the line shows up as a fresh pending item that the cashier must Send
 *     to Kitchen again.
 *
 * Either path requires cashier PIN — the original void was a privileged
 * action and so is the undo.
 */
export async function restoreOrderItem(
  orderId: string,
  itemId: string,
  input: RestoreOrderItemInput,
) {
  const preflight = await prisma.orderItem.findUnique({
    where: { id: itemId },
    select: { order_id: true, voided_at: true, void_printed_at: true },
  });
  if (!preflight || preflight.order_id !== orderId) {
    throw new NotFoundError('OrderItem');
  }
  if (preflight.voided_at == null) {
    throw new ConflictError('Item is not voided');
  }
  await authorizeCashierPin(input.pin);
  const wasPrinted = preflight.void_printed_at != null;

  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    const existing = await tx.orderItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        order_id: true,
        voided_at: true,
        void_printed_at: true,
      },
    });
    if (!existing || existing.order_id !== orderId) throw new NotFoundError('OrderItem');
    if (existing.voided_at == null) {
      throw new ConflictError('Item is not voided');
    }

    await tx.orderItem.update({
      where: { id: itemId },
      data: {
        voided_at: null,
        voided_by: null,
        void_reason_code: null,
        void_reason: null,
        void_printed_at: null,
        // If the kitchen was already told the item was removed, the only safe
        // way to restore it is to treat it as a fresh order — reset the sent
        // state so the next Send to Kitchen reprints it as new.
        ...(wasPrinted ? { sent_to_kitchen: false, sent_at: null } : {}),
      },
    });

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
export async function addPayment(
  orderId: string,
  input: CreatePaymentInput,
  userId: string,
  userRole: UserRole,
) {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        status: true,
        total: true,
        register_id: true,
        table_id: true,
        // Voided lines are excluded from the deduction set and the empty check
        // — the customer isn't paying for them and we shouldn't draw inventory
        // for items the kitchen never made.
        items: {
          where: { voided_at: null },
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

    // The order may have been opened during a previous shift whose register
    // is now closed. In that case the cashier on the new shift should still
    // be able to settle it — we re-anchor the order to whichever register
    // *they* currently have open and route the cash delta there. If the user
    // has no open register we still refuse, since payment events without an
    // open drawer can't be reconciled.
    const originalRegister = await tx.cashRegister.findUnique({
      where: { id: order.register_id },
      select: { id: true, status: true, kind: true },
    });
    let activeRegisterId = order.register_id;
    let activeRegisterKind = originalRegister?.kind ?? null;
    if (!originalRegister || originalRegister.status !== CashRegisterStatus.OPEN) {
      // Singleton-shift model: any open register works. The arriving cashier
      // doesn't need a personal one — they settle against whichever shift is
      // currently open.
      const fallback = await tx.cashRegister.findFirst({
        where: { status: CashRegisterStatus.OPEN },
        select: { id: true, kind: true },
      });
      if (!fallback) {
        throw new ConflictError(
          "The order's original register is closed and no shift is open — open one before settling.",
        );
      }
      activeRegisterId = fallback.id;
      activeRegisterKind = fallback.kind;
      // Re-anchor the order so the close-shift recomputation, sales reports,
      // and deduction rules all see the cashier who actually settled it.
      await tx.order.update({
        where: { id: orderId },
        data: { register_id: activeRegisterId },
      });
    }

    // Waiter/Barista emergency-shift flow: ordinarily they need a cashier+'s
    // PIN to settle a ticket (recorded on Payment.approved_by_user_id). When
    // the active shift is PROVISIONAL, however, there is no cashier on site
    // by definition — that's the whole point of provisional. We waive the
    // PIN requirement and stamp the floor staff member as the implicit
    // approver so the audit trail still names a real person. The arriving
    // cashier reconciles cash at close time.
    let approverUserId: string | null = null;
    const isProvisional = activeRegisterKind === 'PROVISIONAL';
    if (userRole === 'WAITER' || userRole === 'BARISTA') {
      if (isProvisional) {
        approverUserId = userId;
      } else {
        approverUserId = await authorizeCashierPin(input.pin);
      }
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
        approved_by_user_id: approverUserId,
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
          where: { id: activeRegisterId },
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
        { pos_register_id: activeRegisterId, client: tx },
      );

      // Release the table when this order leaves OPEN. syncTableStatus will
      // leave the badge OCCUPIED if other open orders still share the table
      // (group ordering: settle one ticket while the rest of the party stays).
      if (order.table_id) {
        await syncTableStatus(tx, order.table_id);
      }
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

// ----------------------------------------------------------------------------
// Kitchen routing — terminal "Send to Kitchen" flow
// ----------------------------------------------------------------------------

export interface SendToKitchenItem {
  id: string;
  quantity: number;
  notes: string | null;
  sent_at: Date | null;
  product: { id: string; name: string; type: string; station_id: string | null };
  variant: { id: string; name: string } | null;
  modifiers: Array<{ id: string; name: string }>;
}

export interface SendToKitchenVoidedItem extends SendToKitchenItem {
  voided_at: Date | null;
  void_reason: string | null;
}

export interface SendToKitchenResult {
  order_id: string;
  printed_at: Date;
  // Total kitchen-bound rows on this print (active items + voided tombstones
  // when in correction mode, or just the newly-added rows on first print).
  // Drives the renderer's "did anything actually print?" check.
  printed_count: number;
  // True when this is a CORRECTION ticket — the kitchen has seen a comanda
  // for this order before, and the renderer should print "REPLACES PREVIOUS
  // TICKET" so the cocina swaps their slip. False on the first print of an
  // order. Drives both the header text and the "should I show all items vs
  // only new ones?" decision.
  is_correction: boolean;
  // What to print as active rows:
  //   • First print:   only the brand-new items
  //   • Correction:    the full snapshot of currently-active items so the
  //                    kitchen has a self-contained ticket they can swap in.
  //                    Items with sent_at == printed_at are "newly added" in
  //                    this batch and the renderer flags them with [NEW].
  items: SendToKitchenItem[];
  // Voided tombstones to print struck-through. Always the full set of voids
  // on the order (correction mode), so the kitchen always has the complete
  // "what NOT to make" list on a single ticket. Empty on the first print
  // (an order can't have voids before it has ever been sent).
  voided_items: SendToKitchenVoidedItem[];
  order: Awaited<ReturnType<typeof loadOrderOrThrow>>;
}

/**
 * Send the order's current state to the kitchen printer.
 *
 * Two flavors of comanda:
 *   • First print     — there is no prior comanda. Header reads "KITCHEN
 *                       ORDER", body lists only the newly-added items.
 *   • Correction      — a prior comanda exists. Header reads "KITCHEN
 *                       CORRECTION — Replaces previous ticket" and the body
 *                       contains the FULL current snapshot: every active
 *                       item plus every voided tombstone. The cocina trashes
 *                       their old slip and replaces it with this one.
 *
 * Newly-added items in correction mode (sent_at stamped in this transaction)
 * are flagged via sent_at == printed_at so the renderer can highlight them
 * with a [NEW] marker — easy for the cooks to spot what changed.
 *
 * Skips the print entirely when there are no pending changes (no unsent
 * items AND no unprinted voids); returns printed_count=0 and the renderer
 * silently no-ops. Cancelled/paid orders are rejected since the kitchen
 * shouldn't get any more notifications after the order leaves OPEN.
 *
 * Side effects (in one transaction):
 *   • Unsent active items   → sent_to_kitchen=true, sent_at=now
 *   • Unprinted voided rows → void_printed_at=now
 */
export async function sendToKitchen(orderId: string): Promise<SendToKitchenResult> {
  return prisma.$transaction(async (tx) => {
    const order = await tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true },
    });
    if (!order) throw new NotFoundError('Order');
    if (order.status !== OrderStatus.OPEN) {
      throw new ConflictError(
        `Order is ${order.status.toLowerCase()} — cannot send to kitchen`,
      );
    }

    const sendItemSelect = {
      id: true,
      quantity: true,
      notes: true,
      sent_at: true,
      product: {
        select: { id: true, name: true, type: true, station_id: true },
      },
      variant: { select: { id: true, name: true } },
      modifiers: { select: { id: true, name: true } },
    } as const;

    // Snapshot ids first so update-then-fetch returns exactly the rows we
    // claimed; concurrent adds/voids land in the next send instead of
    // mutating this batch mid-flight.
    const pending = await tx.orderItem.findMany({
      where: { order_id: orderId, sent_to_kitchen: false, voided_at: null },
      orderBy: { created_at: 'asc' },
      select: { id: true },
    });
    const pendingVoids = await tx.orderItem.findMany({
      where: {
        order_id: orderId,
        sent_to_kitchen: true,
        voided_at: { not: null },
        void_printed_at: null,
      },
      orderBy: { voided_at: 'asc' },
      select: { id: true },
    });

    const printedAt = new Date();

    // Nothing changed since the last comanda → silent no-op. The frontend
    // gates the printer call on printed_count > 0 so the cashier won't burn
    // paper on a redundant send.
    if (pending.length === 0 && pendingVoids.length === 0) {
      return {
        order_id: orderId,
        printed_at: printedAt,
        printed_count: 0,
        is_correction: false,
        items: [],
        voided_items: [],
        order: await loadOrderOrThrow(tx, orderId),
      };
    }

    // "Was a comanda ever printed for this order?" — drives the CORRECTION vs
    // first-print decision. Looks at items present BEFORE we stamp the new
    // sent_at / void_printed_at below, since items being marked in this
    // transaction don't count as "previously printed".
    const wasEverPrinted = await tx.orderItem.findFirst({
      where: {
        order_id: orderId,
        OR: [
          { sent_at: { not: null } },
          { void_printed_at: { not: null } },
        ],
      },
      select: { id: true },
    });
    const isCorrection = wasEverPrinted != null;

    if (pending.length > 0) {
      await tx.orderItem.updateMany({
        where: { id: { in: pending.map((p) => p.id) } },
        data: { sent_to_kitchen: true, sent_at: printedAt },
      });
    }
    if (pendingVoids.length > 0) {
      await tx.orderItem.updateMany({
        where: { id: { in: pendingVoids.map((p) => p.id) } },
        data: { void_printed_at: printedAt },
      });
    }

    // Build the print payload.
    //   • Correction → snapshot of every currently-active item, plus every
    //     voided tombstone (regardless of whether the void was already on a
    //     previous comanda — the new ticket must be self-contained so the
    //     cocina can fully replace their slip).
    //   • First print → only the items we just marked as sent. No voids
    //     possible (an order with zero prior comandas can't have any
    //     "previously sent" items to void).
    let items: SendToKitchenItem[] = [];
    let voidedRaw: Array<
      SendToKitchenItem & { voided_at: Date | null; void_reason: string | null }
    > = [];

    if (isCorrection) {
      items = await tx.orderItem.findMany({
        where: { order_id: orderId, voided_at: null },
        orderBy: { created_at: 'asc' },
        select: sendItemSelect,
      });
      voidedRaw = await tx.orderItem.findMany({
        where: { order_id: orderId, voided_at: { not: null } },
        orderBy: { voided_at: 'asc' },
        select: { ...sendItemSelect, voided_at: true, void_reason: true },
      });
    } else if (pending.length > 0) {
      items = await tx.orderItem.findMany({
        where: { id: { in: pending.map((p) => p.id) } },
        orderBy: { created_at: 'asc' },
        select: sendItemSelect,
      });
    }

    const voided_items: SendToKitchenVoidedItem[] = voidedRaw.map((v) => ({
      id: v.id,
      quantity: v.quantity,
      notes: v.notes,
      sent_at: v.sent_at,
      product: v.product,
      variant: v.variant,
      modifiers: v.modifiers,
      voided_at: v.voided_at,
      void_reason: v.void_reason,
    }));

    const fullOrder = await loadOrderOrThrow(tx, orderId);

    return {
      order_id: orderId,
      printed_at: printedAt,
      printed_count: items.length + voided_items.length,
      is_correction: isCorrection,
      items,
      voided_items,
      order: fullOrder,
    };
  });
}

// ----------------------------------------------------------------------------
// Active orders — terminal polling endpoint
// ----------------------------------------------------------------------------

/**
 * Return every OPEN order with its full nested payload. No pagination — the
 * terminal needs the full list to decide which tables/cards to highlight, and
 * the count is bounded by the café's seating (rarely > 30 at a time).
 *
 * Ordered by created_at asc so the cashier's queue reads top-down by age.
 */
export async function listActiveOrders() {
  return prisma.order.findMany({
    where: { status: OrderStatus.OPEN },
    orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    include: orderInclude,
  });
}

// ----------------------------------------------------------------------------
// Request Edit — waiter flags, cashier clears
// ----------------------------------------------------------------------------

/**
 * Waiter-side: flip needs_attention=true on an OPEN order. Idempotent — calling
 * twice just overwrites the reason. Reason may be null/empty (the badge alone
 * is enough to signal the cashier); we store whatever was passed for context.
 */
export async function flagOrderForAttention(orderId: string, input: RequestAttentionInput) {
  return prisma.$transaction(async (tx) => {
    await assertOrderOpen(tx, orderId);
    await tx.order.update({
      where: { id: orderId },
      data: {
        needs_attention: true,
        attention_reason: input.reason?.trim() ? input.reason.trim() : null,
      },
    });
    return loadOrderOrThrow(tx, orderId);
  });
}

/**
 * Cashier-side: clear the attention flag and wipe the reason. Works on any
 * status so a cashier can also dismiss a flag on an already-paid order that
 * accidentally stayed flagged.
 */
export async function clearOrderAttention(orderId: string) {
  const exists = await prisma.order.findUnique({
    where: { id: orderId },
    select: { id: true },
  });
  if (!exists) throw new NotFoundError('Order');
  return prisma.order.update({
    where: { id: orderId },
    data: { needs_attention: false, attention_reason: null },
    include: orderInclude,
  });
}
