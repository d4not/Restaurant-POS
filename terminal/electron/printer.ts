import { createRequire } from 'node:module';
import Store from 'electron-store';

// node-thermal-printer ships CJS; we pull it in via createRequire so the ESM
// main process can use it without a separate build pipeline.
const require = createRequire(import.meta.url);
const ntp = require('node-thermal-printer') as typeof import('node-thermal-printer');
const { printer: ThermalPrinter, types: PrinterTypes, characterSet: CharacterSet } = ntp;

// ── Config ────────────────────────────────────────────────────────────

export type PrinterBrand = 'EPSON' | 'STAR' | 'TANCA' | 'DARUMA' | 'BROTHER' | 'CUSTOM';
export type InterfaceType = 'USB' | 'NETWORK';

export interface PrinterConfig {
  /** Brand driver — affects ESC/POS command dialect */
  type: PrinterBrand;
  /** Connection kind. USB needs a raw device path / printer name; NETWORK a tcp:// URL. */
  interface_type: InterfaceType;
  /** Actual interface string passed to node-thermal-printer (e.g. "tcp://192.168.1.10:9100" or "/dev/usb/lp0"). */
  interface: string;
  /** Characters per line: 32 for 58mm paper, 42–48 for 80mm. */
  width: number;
  /** When false, print calls no-op and return a descriptive error — useful for single-printer setups. */
  enabled: boolean;
}

export interface PrinterStore {
  receipt: PrinterConfig;
  kitchen: PrinterConfig;
}

/**
 * Sensible defaults — both printers disabled until the user configures them.
 * An 80mm Epson on a LAN is the most common café setup, so that's what we
 * pre-fill as a hint, but nothing will print until `enabled: true`.
 */
const DEFAULT_CONFIG: PrinterStore = {
  receipt: {
    type: 'EPSON',
    interface_type: 'NETWORK',
    interface: 'tcp://192.168.1.100:9100',
    width: 48,
    enabled: false,
  },
  kitchen: {
    type: 'EPSON',
    interface_type: 'NETWORK',
    interface: 'tcp://192.168.1.101:9100',
    width: 48,
    enabled: false,
  },
};

// electron-store persists to userData/config.json and survives updates.
const store = new Store<PrinterStore>({
  name: 'printer-config',
  defaults: DEFAULT_CONFIG,
});

export function getConfig(): PrinterStore {
  return {
    receipt: store.get('receipt'),
    kitchen: store.get('kitchen'),
  };
}

export function setConfig(kind: 'receipt' | 'kitchen', patch: Partial<PrinterConfig>): PrinterConfig {
  const current = store.get(kind);
  const next = { ...current, ...patch };
  store.set(kind, next);
  return next;
}

// ── Low-level printing ───────────────────────────────────────────────

/** Map our brand enum to the library's enum. */
function brandToDriver(brand: PrinterBrand) {
  switch (brand) {
    case 'EPSON':   return PrinterTypes.EPSON;
    case 'STAR':    return PrinterTypes.STAR;
    case 'TANCA':   return PrinterTypes.TANCA;
    case 'DARUMA':  return PrinterTypes.DARUMA;
    case 'BROTHER': return PrinterTypes.BROTHER;
    case 'CUSTOM':  return PrinterTypes.CUSTOM;
  }
}

/**
 * Build a fresh printer instance on every print. Cheap — these are mostly
 * state objects, the actual socket is opened inside `execute()`. Rebuilding
 * means config changes apply without restarting the app.
 */
function build(config: PrinterConfig) {
  return new ThermalPrinter({
    type: brandToDriver(config.type),
    interface: config.interface,
    width: config.width,
    characterSet: CharacterSet.PC850_MULTILINGUAL,
    removeSpecialCharacters: false,
    options: { timeout: 5000 },
  });
}

export interface PrintResult {
  ok: boolean;
  message?: string;
}

/** Try connecting to the configured printer — for the settings page status dot. */
export async function probe(kind: 'receipt' | 'kitchen'): Promise<PrintResult> {
  const config = store.get(kind);
  if (!config.enabled) return { ok: false, message: 'Printer disabled' };
  try {
    const p = build(config);
    const connected = await p.isPrinterConnected();
    if (!connected) return { ok: false, message: 'Printer did not respond' };
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Probe failed' };
  }
}

/** Send a single-line test page to the selected printer. */
export async function printTestPage(kind: 'receipt' | 'kitchen'): Promise<PrintResult> {
  const config = store.get(kind);
  if (!config.enabled) return { ok: false, message: `${kind} printer disabled` };
  try {
    const p = build(config);
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println('PRINTER TEST');
    p.setTextNormal();
    p.bold(false);
    p.drawLine();
    p.alignLeft();
    p.println(`Role:      ${kind}`);
    p.println(`Driver:    ${config.type}`);
    p.println(`Interface: ${config.interface}`);
    p.println(`Width:     ${config.width} chars`);
    p.println(`Time:      ${new Date().toLocaleString()}`);
    p.drawLine();
    p.alignCenter();
    p.println('If you can read this, the printer is wired up correctly.');
    p.newLine();
    p.cut();
    await p.execute();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Print failed' };
  }
}

// ── Business prints ──────────────────────────────────────────────────

export interface KitchenTicketItem {
  quantity: number;
  product: string;
  variant: string | null;
  notes: string | null;
  modifiers: string[];
}

export interface KitchenTicket {
  order_number: number;
  printed_at: string;
  waiter: string;
  table: { zone: string; number: number } | null;
  order_type: 'DINE_IN' | 'TAKEOUT';
  items: KitchenTicketItem[];
  is_addition: boolean;
}

/** HH:MM from an ISO timestamp — the kitchen doesn't need seconds. */
function timeOnly(iso: string): string {
  try {
    const d = new Date(iso);
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${hh}:${mm}`;
  } catch {
    return iso;
  }
}

export async function printKitchen(ticket: KitchenTicket): Promise<PrintResult> {
  const config = store.get('kitchen');
  if (!config.enabled) return { ok: false, message: 'Kitchen printer disabled' };
  try {
    const p = build(config);
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println('KITCHEN ORDER');
    p.setTextNormal();
    p.bold(false);
    p.drawLine();
    p.alignLeft();

    const tableLabel = ticket.table
      ? `Table ${ticket.table.number} (${ticket.table.zone})`
      : ticket.order_type === 'TAKEOUT'
        ? 'TAKEOUT'
        : 'No table';
    p.leftRight(`Order #${ticket.order_number}`, tableLabel);
    p.leftRight(`Waiter: ${ticket.waiter}`, timeOnly(ticket.printed_at));
    p.drawLine();

    for (const item of ticket.items) {
      p.bold(true);
      p.setTextDoubleHeight();
      const nameLine = item.variant
        ? `${item.quantity}x ${item.product} — ${item.variant}`
        : `${item.quantity}x ${item.product}`;
      p.println(nameLine);
      p.setTextNormal();
      p.bold(false);

      for (const m of item.modifiers) {
        p.println(`   > ${m}`);
      }
      if (item.notes) {
        p.invert(true);
        p.println(`   NOTE: ${item.notes}`);
        p.invert(false);
      }
      p.newLine();
    }

    p.drawLine();
    if (ticket.is_addition) {
      p.alignCenter();
      p.bold(true);
      p.println('** ADDED ITEMS **');
      p.bold(false);
      p.alignLeft();
    }
    p.newLine();
    p.cut();
    await p.execute();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Kitchen print failed' };
  }
}

export interface ReceiptTicket {
  business: { name: string; address?: string };
  order_number: number;
  date: string;
  cashier: string;
  table: { zone: string; number: number } | null;
  items: Array<{
    quantity: number;
    name: string;
    variant: string | null;
    line_total: string;
    modifiers: Array<{ name: string; extra_price: string }>;
  }>;
  subtotal: string;
  tax_amount: string;
  total: string;
  payments: Array<{ method: string; amount: string; change_amount: string }>;
}

export async function printReceipt(ticket: ReceiptTicket): Promise<PrintResult> {
  const config = store.get('receipt');
  if (!config.enabled) return { ok: false, message: 'Receipt printer disabled' };
  try {
    const p = build(config);
    p.alignCenter();
    p.bold(true);
    p.setTextDoubleHeight();
    p.println(ticket.business.name);
    p.setTextNormal();
    p.bold(false);
    if (ticket.business.address) p.println(ticket.business.address);
    p.drawLine();

    p.alignLeft();
    p.leftRight(`Order #${ticket.order_number}`, ticket.date);
    p.leftRight(`Cashier: ${ticket.cashier}`, ticket.table ? `Table ${ticket.table.number}` : 'Takeout');
    p.drawLine();

    for (const it of ticket.items) {
      const name = it.variant ? `${it.quantity} ${it.name} ${it.variant}` : `${it.quantity} ${it.name}`;
      p.leftRight(name, formatCentavos(it.line_total));
      for (const m of it.modifiers) {
        if (Number(m.extra_price) > 0) {
          p.leftRight(`   ${m.name}`, `+${formatCentavos(m.extra_price)}`);
        } else {
          p.println(`   ${m.name}`);
        }
      }
    }
    p.drawLine();
    p.leftRight('Subtotal', formatCentavos(ticket.subtotal));
    p.leftRight('Tax', formatCentavos(ticket.tax_amount));
    p.bold(true);
    p.leftRight('Total', formatCentavos(ticket.total));
    p.bold(false);
    p.drawLine();

    for (const pay of ticket.payments) {
      p.leftRight(pay.method, formatCentavos(pay.amount));
      if (Number(pay.change_amount) > 0) {
        p.leftRight('   Change', formatCentavos(pay.change_amount));
      }
    }
    p.drawLine();
    p.alignCenter();
    p.println('Thank you for your visit!');
    p.newLine();
    p.cut();
    await p.execute();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : 'Receipt print failed' };
  }
}

// Centavos → "$xx.xx". Duplicated from the renderer's format.ts because the
// main process can't import from src/.
function formatCentavos(centavos: string | number): string {
  const n = typeof centavos === 'string' ? Number(centavos) : centavos;
  if (!Number.isFinite(n)) return '$0.00';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${(Math.abs(n) / 100).toFixed(2)}`;
}
