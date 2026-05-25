/**
 * Pure formatters that turn an order into a list of printable text lines for
 * an ESC/POS thermal printer. No side effects, no DB, no node-thermal-printer
 * import — kept here so the receipt/comanda layout can be unit-tested in
 * isolation. The printer adapter (printer.ts) feeds these lines into
 * `node-thermal-printer.println`.
 *
 * Width is in characters, not millimetres. The standard 80mm receipt printer
 * fits 48 characters per line; a 58mm printer fits 32.
 *
 * Both formatters accept an optional template object that controls which
 * sections appear and customizes text. When the template is undefined or a
 * field is missing, the formatter falls back to the defaults defined in
 * template-types.ts — so existing callers produce identical output.
 */

import type { ComandaTemplate, ReceiptTemplate } from './template-types.js';
import { DEFAULT_COMANDA_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from './template-types.js';

export interface ComandaItem {
  quantity: number;
  product_name: string;
  variant_name: string | null;
  modifiers: string[];
  notes: string | null;
  is_new: boolean;
  category_id?: string | null;
}

export interface ComandaVoidedItem {
  quantity: number;
  product_name: string;
  variant_name: string | null;
  void_reason: string | null;
  category_id?: string | null;
}

export interface ComandaInput {
  order_number: number;
  table_label: string | null;
  waiter_name: string;
  printed_at: Date;
  is_correction: boolean;
  items: ComandaItem[];
  voided_items: ComandaVoidedItem[];
  width: number;
  template?: ComandaTemplate | null;
}

export interface ReceiptItem {
  quantity: number;
  product_name: string;
  variant_name: string | null;
  line_total_centavos: number;
  modifiers: Array<{ name: string; extra_price_centavos: number }>;
}

export interface ReceiptPayment {
  method: 'CASH' | 'CARD' | 'TRANSFER';
  amount_centavos: number;
  change_centavos: number;
  tip_centavos: number;
  reference: string | null;
}

export interface ReceiptInput {
  business_name: string;
  business_address: string | null;
  order_number: number;
  date: Date;
  cashier_name: string;
  table_label: string | null;
  items: ReceiptItem[];
  subtotal_centavos: number;
  tax_label: string;
  tax_centavos: number;
  discount_centavos: number;
  total_centavos: number;
  tip_centavos: number;
  payments: ReceiptPayment[];
  width: number;
  template?: ReceiptTemplate | null;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

function leftRight(left: string, right: string, width: number): string {
  const maxLeft = Math.max(0, width - right.length - 1);
  const truncatedLeft = left.length > maxLeft ? left.slice(0, maxLeft) : left;
  const space = Math.max(1, width - truncatedLeft.length - right.length);
  return truncatedLeft + ' '.repeat(space) + right;
}

function rule(width: number, char = '='): string {
  return char.repeat(width);
}

function formatTime(d: Date): string {
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateTime(d: Date): string {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${da}  ${formatTime(d)}`;
}

export function formatMoney(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${String(cents).padStart(2, '0')}`;
}

function blankLines(n: number): string[] {
  return n > 0 ? Array(n).fill('') : [];
}

export function formatKitchenComanda(input: ComandaInput): string[] {
  const W = input.width;
  const t = { ...DEFAULT_COMANDA_TEMPLATE, ...(input.template ?? {}) };
  const lines: string[] = [];
  const sep = rule(W, '=');
  const dash = rule(W, '-');

  lines.push(...blankLines(t.margin_top));

  lines.push(sep);
  const headerText = t.header_text || 'ORDER';
  if (input.is_correction) {
    const corrText = headerText === DEFAULT_COMANDA_TEMPLATE.header_text
      ? 'CORRECTION'
      : `${headerText} — CORRECTION`;
    lines.push(center(corrText, W));
    lines.push(center('Replaces previous ticket', W));
  } else {
    lines.push(center(headerText, W));
  }
  lines.push(sep);

  const metaLines: string[] = [];
  if (t.show_order_number) {
    const tableLabel = t.show_table ? (input.table_label ?? '') : '';
    metaLines.push(leftRight(`Order #: ${input.order_number}`, tableLabel, W));
  } else if (t.show_table && input.table_label) {
    metaLines.push(input.table_label);
  }

  if (t.show_waiter || t.show_time) {
    const waiterPart = t.show_waiter ? `Waiter: ${input.waiter_name}` : '';
    const timePart = t.show_time ? formatTime(input.printed_at) : '';
    if (waiterPart && timePart) {
      metaLines.push(leftRight(waiterPart, timePart, W));
    } else if (waiterPart) {
      metaLines.push(waiterPart);
    } else if (timePart) {
      metaLines.push(timePart);
    }
  }

  if (metaLines.length > 0) {
    lines.push(...metaLines);
    lines.push(dash);
  }

  if (input.items.length === 0 && input.voided_items.length === 0) {
    lines.push(center('(no items)', W));
  }

  for (const item of input.items) {
    const variant = item.variant_name ? ` ${item.variant_name}` : '';
    const newTag = item.is_new && input.is_correction ? ' [NEW]' : '';
    lines.push(`${item.quantity}x ${item.product_name}${variant}${newTag}`);
    if (t.show_modifiers) {
      for (const mod of item.modifiers) lines.push(`   > ${mod}`);
    }
    if (t.show_notes && item.notes) lines.push(`   NOTE: ${item.notes}`);
  }

  if (t.show_voided && input.voided_items.length > 0) {
    lines.push(dash);
    lines.push(center('*** REMOVED ***', W));
    for (const v of input.voided_items) {
      const variant = v.variant_name ? ` ${v.variant_name}` : '';
      lines.push(`${v.quantity}x ${v.product_name}${variant}`);
      if (v.void_reason) lines.push(`   reason: ${v.void_reason}`);
    }
  }

  if (t.footer_text) {
    lines.push(dash);
    lines.push(center(t.footer_text, W));
  }

  lines.push(sep);
  lines.push(...blankLines(t.margin_bottom));
  return lines;
}

export function formatReceipt(input: ReceiptInput): string[] {
  const W = input.width;
  const t = { ...DEFAULT_RECEIPT_TEMPLATE, ...(input.template ?? {}) };
  const lines: string[] = [];
  const sep = rule(W, '=');
  const dash = rule(W, '-');

  lines.push(...blankLines(t.margin_top));

  lines.push(sep);
  if (t.show_business_name) {
    lines.push(center(input.business_name, W));
  }
  if (t.show_address && input.business_address) {
    lines.push(center(input.business_address, W));
  }
  lines.push(sep);

  if (t.show_order_number) {
    lines.push(`Order #: ${input.order_number}`);
  }
  if (t.show_datetime) {
    lines.push(`Date: ${formatDateTime(input.date)}`);
  }
  if (t.show_cashier) {
    const cashierLabel = `Cashier: ${input.cashier_name}`;
    if (t.show_table && input.table_label) {
      lines.push(leftRight(cashierLabel, input.table_label, W));
    } else {
      lines.push(cashierLabel);
    }
  } else if (t.show_table && input.table_label) {
    lines.push(input.table_label);
  }
  lines.push(dash);

  for (const item of input.items) {
    const qty = String(item.quantity);
    const variant = item.variant_name ? ` ${item.variant_name}` : '';
    const left = `${qty}  ${item.product_name}${variant}`;
    lines.push(leftRight(left, formatMoney(item.line_total_centavos), W));
    if (t.show_modifiers) {
      for (const mod of item.modifiers) {
        const modLeft = `   ${mod.name}`;
        const modRight = mod.extra_price_centavos > 0
          ? `+${formatMoney(mod.extra_price_centavos)}`
          : '';
        if (modRight) {
          lines.push(leftRight(modLeft, modRight, W));
        } else {
          lines.push(modLeft);
        }
      }
    }
  }
  lines.push(dash);

  if (t.show_subtotal) {
    lines.push(leftRight('Subtotal:', formatMoney(input.subtotal_centavos), W));
  }
  if (t.show_tax && input.tax_centavos > 0) {
    lines.push(leftRight(`${input.tax_label}:`, formatMoney(input.tax_centavos), W));
  }
  if (t.show_discount && input.discount_centavos > 0) {
    lines.push(leftRight('Discount:', `-${formatMoney(input.discount_centavos)}`, W));
  }
  if (t.show_total) {
    lines.push(leftRight('Total:', formatMoney(input.total_centavos), W));
  }
  if (t.show_tip && input.tip_centavos > 0) {
    lines.push(leftRight('Tip:', formatMoney(input.tip_centavos), W));
  }

  if (t.show_payments && input.payments.length > 0) {
    lines.push(dash);
    for (const p of input.payments) {
      const label = p.method.charAt(0) + p.method.slice(1).toLowerCase() + ':';
      lines.push(leftRight(label, formatMoney(p.amount_centavos), W));
      if (t.show_tip && p.tip_centavos > 0) {
        lines.push(`   incl. tip ${formatMoney(p.tip_centavos)}`);
      }
      if (t.show_change && p.method === 'CASH' && p.change_centavos > 0) {
        lines.push(leftRight('Change:', formatMoney(p.change_centavos), W));
      }
      if (p.reference && p.method !== 'CASH') {
        lines.push(`Ref: ${p.reference}`);
      }
    }
  }

  lines.push(sep);
  const thankYou = t.thank_you_text || 'Thank you!';
  if (thankYou) {
    lines.push(center(thankYou, W));
  }
  lines.push(sep);
  lines.push(...blankLines(t.margin_bottom));
  return lines;
}
