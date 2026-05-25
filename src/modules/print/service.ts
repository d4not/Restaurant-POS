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
  type ComandaItem,
  type ComandaVoidedItem,
  type ReceiptInput,
} from './formatter.js';
import type { ComandaTemplate } from './template-types.js';
import { DEFAULT_COMANDA_TEMPLATE } from './template-types.js';
import {
  paperWidthChars,
  probePrinter,
  sendLines,
  type PrintResult,
  type PrinterTarget,
} from './printer.js';
import { scanForPrinters, type DiscoveredPrinter } from './discovery.js';
import {
  getProfilesForPrinting,
  getRoutingMap,
} from '../printer-profiles/service.js';

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
    category_id: (it.product as { category_id?: string | null }).category_id ?? null,
  }));
  const voided_items = sendResult.voided_items.map((v) => ({
    quantity: v.quantity,
    product_name: v.product.name,
    variant_name: v.variant?.name ?? null,
    void_reason: v.void_reason,
    category_id: (v.product as { category_id?: string | null }).category_id ?? null,
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
    tip_centavos: Number(p.tip_amount),
    reference: p.reference,
  }));
  const tipTotal = payments.reduce((sum, p) => sum + p.tip_centavos, 0);

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
    tip_centavos: tipTotal,
    payments,
    width: paperWidthChars(config.paperWidthMm),
  };
}

export interface ProfilePrintResult {
  profile_id: string;
  profile_name: string;
  ok: boolean;
  error?: string;
}

export interface PrintKitchenResponse extends PrintResult {
  printed_count: number;
  is_correction: boolean;
  lines: string[];
  profile_results?: ProfilePrintResult[];
}

interface PrintBatch {
  items: ComandaItem[];
  voided: ComandaVoidedItem[];
}

function splitByPrintMode(
  mode: string,
  items: ComandaItem[],
  voided: ComandaVoidedItem[],
): PrintBatch[] {
  if (mode === 'per_item') {
    const batches: PrintBatch[] = items.map((item) => ({ items: [item], voided: [] }));
    if (voided.length > 0) {
      if (batches.length > 0) {
        batches[batches.length - 1].voided = voided;
      } else {
        batches.push({ items: [], voided });
      }
    }
    return batches.length > 0 ? batches : [{ items: [], voided }];
  }

  if (mode === 'per_category') {
    const catMap = new Map<string, ComandaItem[]>();
    for (const item of items) {
      const key = item.category_id ?? '__none__';
      const list = catMap.get(key) ?? [];
      list.push(item);
      catMap.set(key, list);
    }
    const batches: PrintBatch[] = [];
    for (const [, catItems] of catMap) {
      batches.push({ items: catItems, voided: [] });
    }
    if (voided.length > 0) {
      if (batches.length > 0) {
        batches[batches.length - 1].voided = voided;
      } else {
        batches.push({ items: [], voided });
      }
    }
    return batches.length > 0 ? batches : [{ items: [], voided }];
  }

  return [{ items, voided }];
}

function profileToTarget(profile: { address: string; paper_width: number }): PrinterTarget {
  const [ip, portStr] = profile.address.split(':');
  return {
    ip: ip || '',
    port: Number(portStr) || 9100,
    width: profile.paper_width === 32 ? 58 : profile.paper_width === 42 ? 76 : 80,
  };
}

export async function printKitchen(orderId: string): Promise<PrintKitchenResponse> {
  const { input, printed_count, is_correction } = await buildKitchenComanda(orderId);

  if (printed_count === 0) {
    return { ok: true, printed_count, is_correction, lines: [] };
  }

  // Try profile-based routing first
  const profiles = await getProfilesForPrinting('comandas');
  if (profiles.length > 0) {
    return printKitchenMultiProfile(input, printed_count, is_correction, profiles);
  }

  // Fallback to legacy single-printer path
  const config = await loadPrinterConfig();
  const lines = formatKitchenComanda(input);
  const result = await sendLines(config.kitchen, lines);
  return { ...result, printed_count, is_correction, lines };
}

async function printKitchenMultiProfile(
  input: ComandaInput,
  printed_count: number,
  is_correction: boolean,
  profiles: Awaited<ReturnType<typeof getProfilesForPrinting>>,
): Promise<PrintKitchenResponse> {
  const routingMap = await getRoutingMap();

  // Build a map: profileId → profile (for fast lookup)
  const profileMap = new Map(profiles.map((p) => [p.id, p]));

  // Group items by destination profile
  const grouped = new Map<string, typeof input.items>();
  const voidedGrouped = new Map<string, typeof input.voided_items>();

  for (const item of input.items) {
    const profileId = item.category_id ? routingMap[item.category_id] : undefined;
    if (!profileId || !profileMap.has(profileId)) continue;
    const list = grouped.get(profileId) ?? [];
    list.push(item);
    grouped.set(profileId, list);
  }

  for (const voided of input.voided_items) {
    const profileId = voided.category_id ? routingMap[voided.category_id] : undefined;
    if (!profileId || !profileMap.has(profileId)) continue;
    const list = voidedGrouped.get(profileId) ?? [];
    list.push(voided);
    voidedGrouped.set(profileId, list);
  }

  const profileResults: ProfilePrintResult[] = [];
  const allLines: string[] = [];

  for (const [profileId, items] of grouped) {
    const profile = profileMap.get(profileId)!;
    if (!profile.address) continue;

    const tpl = (profile.comanda_template ?? null) as ComandaTemplate | null;
    const printMode = tpl?.print_mode ?? DEFAULT_COMANDA_TEMPLATE.print_mode;
    const width = paperWidthChars(profile.paper_width === 32 ? 58 : profile.paper_width === 42 ? 76 : 80);
    const target = profileToTarget(profile);
    const voidedItems = voidedGrouped.get(profileId) ?? [];

    const batches = splitByPrintMode(printMode, items, voidedItems);

    for (const batch of batches) {
      const profileInput: ComandaInput = {
        ...input,
        items: batch.items,
        voided_items: batch.voided,
        width,
        template: tpl,
      };
      const lines = formatKitchenComanda(profileInput);
      allLines.push(...lines);

      const result = await sendLines(target, lines);
      profileResults.push({
        profile_id: profileId,
        profile_name: profile.name,
        ok: result.ok,
        error: result.error,
      });
    }
  }

  // Also send voided items to profiles that aren't receiving new items
  for (const [profileId, voidedItems] of voidedGrouped) {
    if (grouped.has(profileId)) continue;
    const profile = profileMap.get(profileId)!;
    if (!profile.address) continue;

    const tpl = (profile.comanda_template ?? null) as ComandaTemplate | null;
    const profileInput: ComandaInput = {
      ...input,
      items: [],
      voided_items: voidedItems,
      width: paperWidthChars(profile.paper_width === 32 ? 58 : profile.paper_width === 42 ? 76 : 80),
      template: tpl,
    };
    const lines = formatKitchenComanda(profileInput);
    allLines.push(...lines);

    const target = profileToTarget(profile);
    const result = await sendLines(target, lines);
    profileResults.push({
      profile_id: profileId,
      profile_name: profile.name,
      ok: result.ok,
      error: result.error,
    });
  }

  return {
    ok: profileResults.length === 0 || profileResults.every((r) => r.ok),
    printed_count,
    is_correction,
    lines: allLines,
    profile_results: profileResults,
  };
}

export interface PrintReceiptResponse extends PrintResult {
  lines: string[];
  profile_results?: ProfilePrintResult[];
}

export async function printReceipt(orderId: string): Promise<PrintReceiptResponse> {
  const input = await buildReceipt(orderId);

  // Try profile-based routing first
  const profiles = await getProfilesForPrinting('receipts');
  if (profiles.length > 0) {
    const results: ProfilePrintResult[] = [];
    let firstLines: string[] = [];
    for (const profile of profiles) {
      if (!profile.address) continue;
      const tpl = (profile.receipt_template ?? null) as import('./template-types.js').ReceiptTemplate | null;
      const lines = formatReceipt({ ...input, template: tpl });
      if (firstLines.length === 0) firstLines = lines;
      const target = profileToTarget(profile);
      const result = await sendLines(target, lines);
      results.push({
        profile_id: profile.id,
        profile_name: profile.name,
        ok: result.ok,
        error: result.error,
      });
    }
    return {
      ok: results.length === 0 || results.every((r) => r.ok),
      lines: firstLines,
      profile_results: results,
    };
  }

  // Fallback to legacy single-printer path
  const lines = formatReceipt(input);
  const config = await loadPrinterConfig();
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

// ─── Auto-detection + diagnostics ──────────────────────────────────────────

export type PrinterDiagnosticCode =
  | 'OK'
  | 'NOT_CONFIGURED'
  | 'INVALID_PORT'
  | 'UNREACHABLE'
  | 'OTHER_HOST_BUT_OFF';

export interface PrinterDiagnosticEntry {
  configured: boolean;
  connected: boolean;
  ip: string;
  port: number;
  code: PrinterDiagnosticCode;
  // Human-readable, rendered verbatim in the Settings UI banner. Translation
  // keys live on the frontend; this keeps the wire format simple.
  message: string;
  // A short list of next-step bullets the operator can act on without calling
  // support. Drawn from common ESC/POS failure modes.
  remedies: string[];
}

export interface PrinterDiagnostics {
  kitchen: PrinterDiagnosticEntry;
  receipt: PrinterDiagnosticEntry;
  paper_width: number;
  scanned_at: string;
}

function buildDiagnosticEntry(target: {
  ip: string;
  port: number;
  configured: boolean;
  connected: boolean;
}): PrinterDiagnosticEntry {
  const { ip, port, configured, connected } = target;
  if (!configured) {
    return {
      ip, port, configured, connected,
      code: 'NOT_CONFIGURED',
      message: 'Printer IP is not set yet.',
      remedies: [
        'Run a network scan from the printer panel and assign one of the discovered devices.',
        'Or open Settings → Printers and enter the printer IP manually.',
      ],
    };
  }
  if (!Number.isFinite(port) || port <= 0 || port > 65535) {
    return {
      ip, port, configured, connected,
      code: 'INVALID_PORT',
      message: 'Printer port is invalid.',
      remedies: [
        'Most ESC/POS printers listen on TCP 9100. Set the port to 9100 unless your model documents otherwise.',
      ],
    };
  }
  if (connected) {
    return {
      ip, port, configured, connected,
      code: 'OK',
      message: 'Printer reachable on the network.',
      remedies: [],
    };
  }
  return {
    ip, port, configured, connected,
    code: 'UNREACHABLE',
    message: `Cannot reach ${ip}:${port}.`,
    remedies: [
      'Confirm the printer is powered on and not displaying an error light.',
      'Check that the printer cable / Wi-Fi link is connected — many models require a brief power-cycle after a network drop.',
      'Verify the printer\'s IP address — it may have changed if your router renews DHCP leases. Use "Scan network" to discover the current address.',
      'On Windows hosts, ensure the printer driver is installed and the network spooler service is running.',
      'If the printer reports "OFFLINE" on its display, check for a paper jam or empty paper roll.',
    ],
  };
}

export async function getPrinterDiagnostics(): Promise<PrinterDiagnostics> {
  const status = await getPrinterStatus();
  return {
    kitchen: buildDiagnosticEntry(status.kitchen),
    receipt: buildDiagnosticEntry(status.receipt),
    paper_width: status.paper_width,
    scanned_at: new Date().toISOString(),
  };
}

export interface DiscoverPrintersResponse {
  subnet: string | null;
  port: number;
  scanned: number;
  printers: DiscoveredPrinter[];
}

export async function discoverPrinters(input: {
  subnet?: string;
  port?: number;
  timeoutMs?: number;
}): Promise<DiscoverPrintersResponse> {
  return scanForPrinters({
    subnet: input.subnet,
    port: input.port,
    timeoutMs: input.timeoutMs,
  });
}

// Diagnostic test print — short fixed payload so the operator can confirm the
// printer cuts paper and lays out characters correctly without depending on
// an order being available.
export async function testPrint(role: 'kitchen' | 'receipt'): Promise<PrintResult> {
  const config = await loadPrinterConfig();
  const target = role === 'kitchen' ? config.kitchen : config.receipt;
  const lines = [
    '================================',
    role === 'kitchen' ? '       COMANDA TEST PRINT' : '       RECEIPT TEST PRINT',
    '================================',
    `Printed: ${new Date().toLocaleString()}`,
    '',
    'If you can read these lines the',
    'printer is wired correctly.',
    '',
    'Counter:',
    '  1234567890',
    '  abcdefghijklmnop',
    '  ABCDEFGHIJKLMNOP',
    '================================',
  ];
  return sendLines(target, lines);
}
