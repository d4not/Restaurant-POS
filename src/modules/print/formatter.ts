/**
 * Pure formatters that turn an order into a list of printable text lines for
 * an ESC/POS thermal printer. No side effects, no DB, no node-thermal-printer
 * import — kept here so the receipt/comanda layout can be unit-tested in
 * isolation. The printer adapter (printer.ts) feeds these lines into
 * `node-thermal-printer.println`.
 *
 * Width is in characters, not millimetres. The standard 80mm receipt printer
 * fits 48 characters per line; a 58mm printer fits 32.
 */

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
  // Tip portion of `amount` — surfaced as a sub-line under each payment so
  // the customer sees what they actually contributed to the tip jar.
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
  // Total tip across all payments on this order. Rendered as a single Tip
  // line in the summary block when > 0 — separate from the Total so the
  // customer can see "$80 sale + $20 tip = $100 paid".
  tip_centavos: number;
  payments: ReceiptPayment[];
  width: number;
}

function center(text: string, width: number): string {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  return ' '.repeat(left) + text;
}

function leftRight(left: string, right: string, width: number): string {
  // Truncate the left side first if both can't fit — the right value (price,
  // total, time) is the load-bearing piece.
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

/**
 * Centavos → "$1,234.50" (en-US grouping, two decimals). Negative amounts get
 * a leading minus. Bigger-than-Number values aren't a concern here — receipts
 * are bounded by daily takings.
 */
export function formatMoney(centavos: number): string {
  const sign = centavos < 0 ? '-' : '';
  const abs = Math.abs(centavos);
  const dollars = Math.floor(abs / 100);
  const cents = abs % 100;
  // Group thousands by inserting commas right-to-left.
  const grouped = String(dollars).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${grouped}.${String(cents).padStart(2, '0')}`;
}

/**
 * Format a kitchen comanda (order ticket for the cooks). The output mirrors
 * the structure documented in docs/TERMINAL-SPEC.md §"Kitchen Printing":
 *
 *   ================================
 *           KITCHEN ORDER
 *   ================================
 *   Order #: 42        Table: 5
 *   Waiter: Carlos     14:35
 *   --------------------------------
 *   2x Latte Grande
 *      > Almond Milk
 *      > Extra Shot
 *      NOTE: Extra hot
 *   ================================
 *
 * On a CORRECTION ticket the header reads "KITCHEN CORRECTION — Replaces
 * previous ticket" and a `[NEW]` marker tags items added since the last
 * comanda. Voided lines append a "*** REMOVED" block at the bottom.
 */
export function formatKitchenComanda(input: ComandaInput): string[] {
  const W = input.width;
  const lines: string[] = [];
  const sep = rule(W, '=');
  const dash = rule(W, '-');

  lines.push(sep);
  if (input.is_correction) {
    lines.push(center('KITCHEN CORRECTION', W));
    lines.push(center('Replaces previous ticket', W));
  } else {
    lines.push(center('KITCHEN ORDER', W));
  }
  lines.push(sep);
  const tableLabel = input.table_label ?? '';
  lines.push(leftRight(`Order #: ${input.order_number}`, tableLabel, W));
  lines.push(leftRight(`Waiter: ${input.waiter_name}`, formatTime(input.printed_at), W));
  lines.push(dash);

  if (input.items.length === 0 && input.voided_items.length === 0) {
    lines.push(center('(no items)', W));
  }

  for (const item of input.items) {
    const variant = item.variant_name ? ` ${item.variant_name}` : '';
    const newTag = item.is_new && input.is_correction ? ' [NEW]' : '';
    lines.push(`${item.quantity}x ${item.product_name}${variant}${newTag}`);
    for (const mod of item.modifiers) lines.push(`   > ${mod}`);
    if (item.notes) lines.push(`   NOTE: ${item.notes}`);
  }

  if (input.voided_items.length > 0) {
    lines.push(dash);
    lines.push(center('*** REMOVED ***', W));
    for (const v of input.voided_items) {
      const variant = v.variant_name ? ` ${v.variant_name}` : '';
      lines.push(`${v.quantity}x ${v.product_name}${variant}`);
      if (v.void_reason) lines.push(`   reason: ${v.void_reason}`);
    }
  }

  lines.push(sep);
  return lines;
}

/**
 * Format a customer receipt. Tax is shown as a separate line even though
 * prices are tax-inclusive — that's the legal expectation in MX/most LATAM
 * jurisdictions, and matches docs/TERMINAL-SPEC.md §"Receipt format".
 *
 * Discount appears only when > 0; payment block lists every tender (split
 * payments produce one row per Payment record). For CASH the change column
 * shows the change given.
 */
export function formatReceipt(input: ReceiptInput): string[] {
  const W = input.width;
  const lines: string[] = [];
  const sep = rule(W, '=');
  const dash = rule(W, '-');

  lines.push(sep);
  lines.push(center(input.business_name, W));
  if (input.business_address) {
    lines.push(center(input.business_address, W));
  }
  lines.push(sep);

  lines.push(`Order #: ${input.order_number}`);
  lines.push(`Date: ${formatDateTime(input.date)}`);
  const cashierLabel = `Cashier: ${input.cashier_name}`;
  if (input.table_label) {
    lines.push(leftRight(cashierLabel, input.table_label, W));
  } else {
    lines.push(cashierLabel);
  }
  lines.push(dash);

  for (const item of input.items) {
    const qty = String(item.quantity);
    const variant = item.variant_name ? ` ${item.variant_name}` : '';
    const left = `${qty}  ${item.product_name}${variant}`;
    lines.push(leftRight(left, formatMoney(item.line_total_centavos), W));
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
  lines.push(dash);

  lines.push(leftRight('Subtotal:', formatMoney(input.subtotal_centavos), W));
  if (input.tax_centavos > 0) {
    lines.push(leftRight(`${input.tax_label}:`, formatMoney(input.tax_centavos), W));
  }
  if (input.discount_centavos > 0) {
    lines.push(leftRight('Discount:', `-${formatMoney(input.discount_centavos)}`, W));
  }
  lines.push(leftRight('Total:', formatMoney(input.total_centavos), W));
  if (input.tip_centavos > 0) {
    lines.push(leftRight('Tip:', formatMoney(input.tip_centavos), W));
  }

  if (input.payments.length > 0) {
    lines.push(dash);
    for (const p of input.payments) {
      const label = p.method.charAt(0) + p.method.slice(1).toLowerCase() + ':';
      lines.push(leftRight(label, formatMoney(p.amount_centavos), W));
      if (p.tip_centavos > 0) {
        lines.push(`   incl. tip ${formatMoney(p.tip_centavos)}`);
      }
      if (p.method === 'CASH' && p.change_centavos > 0) {
        lines.push(leftRight('Change:', formatMoney(p.change_centavos), W));
      }
      if (p.reference && p.method !== 'CASH') {
        lines.push(`Ref: ${p.reference}`);
      }
    }
  }

  lines.push(sep);
  // Trailing courtesy line — fits on one line at 32 chars and reads natural at 48.
  lines.push(center('Thank you!', W));
  lines.push(sep);
  return lines;
}
