/**
 * Print orchestration. Loads order data + business/printer settings from the
 * database, shapes them into the formatter's input contract, and dispatches
 * to the TCP wrapper. Two public verbs:
 *
 *   • printKitchen(orderId)  — calls orders.sendToKitchen() to mark pending
 *                              items as sent (and resolve correction-vs-first-
 *                              print + voided tombstones), then prints.
 *   • printReceipt(orderId)  — reads a (typically PAID) order with its
 *                              payments, formats and prints the customer slip.
 *
 * Both are no-throw on printer errors — the result wraps `{ ok, error? }`
 * exactly like printer.sendLines, so the API can return 200 with a useful
 * message instead of bubbling a TCP failure as a 500.
 */
import { OrderType } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { getSetting } from '../settings/service.js';
import { SETTING_KEYS } from '../settings/schema.js';
import { sendToKitchen } from '../orders/service.js';
import {
  formatKitchenComanda,
  formatReceipt,
  type ComandaInput,
  type ReceiptInput,
} from './formatter.js';
import {
  paperWidthChars,
  probePrinter,
  sendLines,
  type PrintResult,
  type PrinterTarget,
} from './printer.js';

export interface PrinterStatus {
  kitchen: { configured: boolean; connected: boolean; ip: string; port: number };
  receipt: { configured: boolean; connected: boolean; ip: string; port: number };
  paper_width: number;
}

interface PrinterConfig {
  kitchen: PrinterTarget;
  receipt: PrinterTarget;
  paperWidthMm: number;
  businessName: string;
  businessAddress: string | null;
}

async function loadPrinterConfig(): Promise<PrinterConfig> {
  const [
    kitchenIp,
    kitchenPort,
    receiptIp,
    receiptPort,
    paperWidth,
    businessName,
    businessAddress,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.PRINTER_KITCHEN_IP),
    getSetting(SETTING_KEYS.PRINTER_KITCHEN_PORT),
    getSetting(SETTING_KEYS.PRINTER_RECEIPT_IP),
    getSetting(SETTING_KEYS.PRINTER_RECEIPT_PORT),
    getSetting(SETTING_KEYS.PRINTER_PAPER_WIDTH),
    getSetting(SETTING_KEYS.BUSINESS_NAME),
    getSetting(SETTING_KEYS.BUSINESS_ADDRESS),
  ]);

  const paper = Number(paperWidth ?? 80);
  const widthMm = paper === 58 ? 58 : 80;

  return {
    kitchen: {
      ip: kitchenIp ?? '',
      port: Number(kitchenPort ?? 9100),
      width: widthMm,
    },
    receipt: {
      ip: receiptIp ?? '',
      port: Number(receiptPort ?? 9100),
      width: widthMm,
    },
    paperWidthMm: widthMm,
    businessName: (businessName ?? '').trim() || 'Cafe POS',
    businessAddress: (businessAddress ?? '').trim() || null,
  };
}

function tableLabelForOrder(order: {
  order_type: OrderType;
  order_number: number;
  table: { number: number; zone: { name: string } } | null;
}): string | null {
  if (order.order_type === OrderType.TAKEOUT) {
    return `Takeout #${order.order_number}`;
  }
  if (order.table) {
    return `Table ${order.table.number}`;
  }
  return null;
}

/**
 * Resolve the order, send any pending items to the kitchen, and shape the
 * result into the formatter input. Mirrors what orders.sendToKitchen returns
 * but adapted for the comanda layout (modifier names flattened, [NEW] flags
 * computed from sent_at == printed_at).
 */
export async function buildKitchenComanda(orderId: string): Promise<{
  input: ComandaInput;
  printed_count: number;
  is_correction: boolean;
}> {
  const config = await loadPrinterConfig();
  const sendResult = await sendToKitchen(orderId);

  const items = sendResult.items.map((it) => ({
    quantity: it.quantity,
    product_name: it.product.name,
    variant_name: it.variant?.name ?? null,
    modifiers: it.modifiers.map((m) => m.name),
    notes: it.notes,
    is_new:
      it.sent_at != null &&
      it.sent_at.getTime() === sendResult.printed_at.getTime(),
  }));
  const voided_items = sendResult.voided_items.map((v) => ({
    quantity: v.quantity,
    product_name: v.product.name,
    variant_name: v.variant?.name ?? null,
    void_reason: v.void_reason,
  }));

  const order = sendResult.order;
  const input: ComandaInput = {
    order_number: order.order_number,
    table_label: tableLabelForOrder(order),
    waiter_name: order.user?.name ?? 'Unknown',
    printed_at: sendResult.printed_at,
    is_correction: sendResult.is_correction,
    items,
    voided_items,
    width: paperWidthChars(config.paperWidthMm),
  };

  return {
    input,
    printed_count: sendResult.printed_count,
    is_correction: sendResult.is_correction,
  };
}

/**
 * Build a customer receipt from an order. Doesn't require status=PAID — a
 * cashier can reprint the slip on a closed order, but pre-payment a "draft"
 * receipt is also useful (no payments listed). Tax label is the snapshotted
 * rate from the order items; for a mixed-tax cart we show the largest rate.
 */
export async function buildReceipt(orderId: string): Promise<ReceiptInput> {
  const config = await loadPrinterConfig();

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      user: { select: { id: true, name: true } },
      table: { select: { number: true, zone: { select: { name: true } } } },
      items: {
        where: { voided_at: null },
        orderBy: { created_at: 'asc' },
        include: {
          product: { select: { name: true } },
          variant: { select: { name: true } },
          modifiers: { select: { name: true, extra_price: true } },
        },
      },
      payments: { orderBy: { created_at: 'asc' } },
    },
  });
  if (!order) throw new NotFoundError('Order');

  const items = order.items.map((it) => ({
    quantity: it.quantity,
    product_name: it.product.name,
    variant_name: it.variant?.name ?? null,
    line_total_centavos: Number(it.line_total),
    modifiers: it.modifiers.map((m) => ({
      name: m.name,
      extra_price_centavos: Number(m.extra_price),
    })),
  }));

  // Pick the highest tax rate present on the cart for the line label. With a
  // single tax rate this is just "IVA 16%"; in a mixed cart it picks the
  // dominant one and the math still adds up because tax_amount is summed
  // across items rather than recomputed from this label.
  const taxRate = order.items.reduce((max, it) => {
    const r = Number(it.tax_rate);
    return r > max ? r : max;
  }, 0);
  const taxLabel = taxRate > 0
    ? `Tax ${taxRate.toFixed(2).replace(/\.00$/, '')}%`
    : 'Tax';

  const payments = order.payments.map((p) => ({
    method: p.method as 'CASH' | 'CARD' | 'TRANSFER',
    amount_centavos: Number(p.amount),
    change_centavos: Number(p.change_amount),
    reference: p.reference,
  }));

  return {
    business_name: config.businessName,
    business_address: config.businessAddress,
    order_number: order.order_number,
    date: order.created_at,
    cashier_name: order.user?.name ?? 'Unknown',
    table_label: tableLabelForOrder(order),
    items,
    subtotal_centavos: Number(order.subtotal),
    tax_label: taxLabel,
    tax_centavos: Number(order.tax_amount),
    discount_centavos: Number(order.discount_amount),
    total_centavos: Number(order.total),
    payments,
    width: paperWidthChars(config.paperWidthMm),
  };
}

export interface PrintKitchenResponse extends PrintResult {
  printed_count: number;
  is_correction: boolean;
  /** Lines that were sent (or would have been sent) to the printer. */
  lines: string[];
}

export async function printKitchen(orderId: string): Promise<PrintKitchenResponse> {
  const config = await loadPrinterConfig();
  const { input, printed_count, is_correction } = await buildKitchenComanda(orderId);
  const lines = formatKitchenComanda(input);
  // Skip the actual TCP send when there's nothing new on the order. We still
  // ran sendToKitchen above so its no-op contract holds.
  if (printed_count === 0) {
    return { ok: true, printed_count, is_correction, lines };
  }
  const result = await sendLines(config.kitchen, lines);
  return { ...result, printed_count, is_correction, lines };
}

export interface PrintReceiptResponse extends PrintResult {
  lines: string[];
}

export async function printReceipt(orderId: string): Promise<PrintReceiptResponse> {
  const config = await loadPrinterConfig();
  const input = await buildReceipt(orderId);
  const lines = formatReceipt(input);
  const result = await sendLines(config.receipt, lines);
  return { ...result, lines };
}

export async function getPrinterStatus(): Promise<PrinterStatus> {
  const config = await loadPrinterConfig();
  const [kitchenConnected, receiptConnected] = await Promise.all([
    probePrinter(config.kitchen),
    probePrinter(config.receipt),
  ]);
  return {
    kitchen: {
      configured: config.kitchen.ip.trim() !== '',
      connected: kitchenConnected,
      ip: config.kitchen.ip,
      port: config.kitchen.port,
    },
    receipt: {
      configured: config.receipt.ip.trim() !== '',
      connected: receiptConnected,
      ip: config.receipt.ip,
      port: config.receipt.port,
    },
    paper_width: config.paperWidthMm,
  };
}
