// Thermal printer service — wraps node-thermal-printer and persists the
// receipt / kitchen printer config in the user data folder. The renderer
// reaches this through the IPC bridge in main.cjs / preload.cjs.
//
// Two roles are supported:
//   • receipt  — customer receipt, printed on Complete Payment
//   • kitchen  — kitchen order ticket (comanda), printed on Send to Kitchen
//
// Two interface flavours are supported per role:
//   • usb     — a Linux device path (/dev/usb/lp0), Windows COM/serial path,
//               or a macOS character device. Anything node-thermal-printer
//               doesn't recognise as tcp:// or printer: gets treated as a
//               file/device path internally — exactly what we need.
//   • network — host[:port], turned into tcp://host:port
//
// We construct a fresh ThermalPrinter per print job. The library doesn't keep
// a connection open between prints, so caching the instance buys nothing —
// and a fresh instance picks up config changes immediately.

const fs = require('node:fs');
const path = require('node:path');
const { app, BrowserWindow } = require('electron');
const { ThermalPrinter, PrinterTypes, CharacterSet } = require('node-thermal-printer');
const usbDiscovery = require('./usb-discovery.cjs');
const resolver = require('./printer-resolver.cjs');

// Lazy native printer driver. Used only when the printer's interface URI is
// "printer:NAME" (OS spooler). Most terminals talk to ESC/POS hardware over
// TCP and never load this; the require is deferred so a missing/broken native
// binary doesn't stop the app from booting — buildPrinter surfaces a clean
// error instead. Cached after the first successful load so repeated prints
// don't pay the require cost.
let cachedSpoolDriver = null;
let spoolDriverChecked = false;
function loadSpoolDriver() {
  if (spoolDriverChecked) return cachedSpoolDriver;
  spoolDriverChecked = true;
  try {
    // eslint-disable-next-line global-require
    cachedSpoolDriver = require('@thiagoelg/node-printer');
  } catch (err) {
    // Logged once. The renderer turns the error message into a friendly
    // "install the OS print driver" hint when Test print fails.
    console.warn('[printer] spool driver unavailable:', err?.message ?? err);
    cachedSpoolDriver = null;
  }
  return cachedSpoolDriver;
}

const CONFIG_FILE = 'printers.json';

// Default config covers a typical 80mm Epson-compatible setup over network.
// The user can change everything from the Settings modal; defaults exist so
// the first launch doesn't blow up if no config has been saved yet.
const DEFAULT_CONFIG = Object.freeze({
  business: {
    name: 'Restaurant POS',
    tax_id: '',
    address: '',
  },
  receipt: {
    enabled: false,
    type: 'epson',
    connection: 'network',
    address: '192.168.1.100:9100',
    width: 48,
    characterSet: 'PC850_MULTILINGUAL',
  },
  kitchen: {
    enabled: false,
    type: 'epson',
    connection: 'network',
    address: '192.168.1.101:9100',
    width: 32,
    characterSet: 'PC850_MULTILINGUAL',
  },
});

const KNOWN_TYPES = new Set(Object.values(PrinterTypes));
const KNOWN_CHARSETS = new Set(Object.values(CharacterSet));

let cachedConfig = null;

function configPath() {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

// Deep-merge defaults into whatever was on disk so a partial file (e.g. one
// the user hand-edited) still produces a complete config. Per-role objects
// are spread over their defaults, then validated for known enum values.
function normalize(raw) {
  const base = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  if (!raw || typeof raw !== 'object') return base;
  const out = {
    business: { ...base.business, ...(raw.business ?? {}) },
    receipt: { ...base.receipt, ...(raw.receipt ?? {}) },
    kitchen: { ...base.kitchen, ...(raw.kitchen ?? {}) },
  };
  for (const role of ['receipt', 'kitchen']) {
    const cfg = out[role];
    if (!KNOWN_TYPES.has(cfg.type)) cfg.type = 'epson';
    if (!KNOWN_CHARSETS.has(cfg.characterSet)) cfg.characterSet = 'PC850_MULTILINGUAL';
    if (cfg.connection !== 'usb' && cfg.connection !== 'network') cfg.connection = 'network';
    cfg.width = Number.isFinite(cfg.width) ? Math.max(20, Math.min(64, Math.round(cfg.width))) : 48;
    cfg.enabled = Boolean(cfg.enabled);
    cfg.address = typeof cfg.address === 'string' ? cfg.address.trim() : '';
  }
  return out;
}

function loadConfig() {
  if (cachedConfig) return cachedConfig;
  try {
    const raw = fs.readFileSync(configPath(), 'utf8');
    cachedConfig = normalize(JSON.parse(raw));
  } catch {
    // Missing or unreadable file → fall back to defaults. We don't write the
    // defaults back; the file appears the first time the user saves from the
    // Settings modal, which keeps user-data clean for fresh installs.
    cachedConfig = normalize(null);
  }
  return cachedConfig;
}

function saveConfig(next) {
  const merged = normalize({ ...loadConfig(), ...next });
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(merged, null, 2), 'utf8');
  cachedConfig = merged;
  return merged;
}

// node-thermal-printer's interface URI:
//   • tcp://host:port  — network
//   • printer:NAME     — OS spooler (Windows/CUPS). Requires the native
//                        @thiagoelg/node-printer driver, passed as `driver`
//                        on the ThermalPrinter config.
//   • <path>           — raw device file (e.g. /dev/usb/lp0)
function buildInterfaceUri(roleConfig) {
  if (roleConfig.connection === 'network') {
    const addr = roleConfig.address.trim();
    if (!addr) return null;
    const hasPort = /:\d+$/.test(addr);
    return hasPort ? `tcp://${addr}` : `tcp://${addr}:9100`;
  }
  return roleConfig.address.trim() || null;
}

function buildPrinter(roleConfig) {
  const interfaceUri = buildInterfaceUri(roleConfig);
  if (!interfaceUri) {
    throw new Error('Printer address is not configured');
  }
  const config = {
    type: roleConfig.type,
    interface: interfaceUri,
    width: roleConfig.width,
    characterSet: roleConfig.characterSet,
    removeSpecialCharacters: false,
    options: { timeout: 4000 },
  };
  // Hand the spooler driver to node-thermal-printer only when the operator
  // actually picked an OS-printer target. For tcp:// or raw paths the driver
  // is unused, and we'd rather fail loud at print time on the spool path than
  // silently when the driver couldn't load.
  if (interfaceUri.startsWith('printer:')) {
    const driver = loadSpoolDriver();
    if (!driver) {
      throw new Error(
        'OS print driver not available — install @thiagoelg/node-printer or pick a /dev/usb/lpN device path / network address instead.',
      );
    }
    config.driver = driver;
  }
  return new ThermalPrinter(config);
}

async function probeStatus(roleConfig) {
  if (!roleConfig.enabled) return false;
  try {
    const printer = buildPrinter(roleConfig);
    return await printer.isPrinterConnected();
  } catch {
    return false;
  }
}

// In-memory map of the last address that produced a successful print for each
// role. Resets on app restart. Used by the auto-fix wrapper to give a sticky
// preference to whatever printer most recently worked, and by main.cjs's
// resolve handler to feed scoreCandidate. Exported via setLastWorking +
// getLastWorking so main.cjs can keep its own copy in sync.
const lastWorkingByRole = { receipt: null, kitchen: null };
function setLastWorking(role, address) {
  if ((role === 'receipt' || role === 'kitchen') && typeof address === 'string' && address) {
    lastWorkingByRole[role] = address;
  }
}
function getLastWorking(role) {
  return lastWorkingByRole[role] ?? null;
}

function pickBrowserWindow() {
  try {
    const windows = BrowserWindow.getAllWindows();
    return windows.find((w) => !w.isDestroyed()) ?? null;
  } catch {
    return null;
  }
}

// Run one print attempt against a given roleConfig. `render` mutates the
// ThermalPrinter instance to set up the content. Returns { ok, error?, raw? }.
// The "raw" field carries the underlying execute() result when the lib hands
// back a non-throwing failure (some transports return false instead of throwing).
async function runPrintAttempt(roleConfig, render) {
  try {
    const printer = buildPrinter(roleConfig);
    render(printer);
    const raw = await printer.execute();
    // node-thermal-printer's execute() returns truthy on success on most
    // transports; the OS spooler path returns the spool job id (string/number).
    // A literal `false` means the lib detected a failure without throwing —
    // surface that as an attempt failure so the fallback path can take over.
    if (raw === false) {
      return { ok: false, error: 'execute_returned_false', raw };
    }
    return { ok: true, raw };
  } catch (err) {
    return { ok: false, error: err?.message ?? String(err) };
  }
}

// Wrap a single print job with the auto-fix fallback path:
//   1. First attempt: use the saved roleConfig as-is.
//   2. On failure: ask the resolver for the best replacement.
//        • If recommendation === 'switch-primary' (saved address gone), retry
//          with primary AND persist it for next time.
//        • If recommendation === 'investigate-current' (saved found but
//          unhealthy), retry with primary for this print only — don't persist
//          because the operator may want to recover the original printer.
//        • Otherwise: don't retry, return the original failure.
//   3. On success: record lastWorking so subsequent resolves prefer it.
//
// Returns the rich object that the IPC handlers serialise to the renderer.
// `fallback_applied` is set when we successfully recovered via a different
// printer; the UI uses it to show a "we switched to printer X" toast.
async function tryPrintWithFallback(role, render) {
  const cfg = loadConfig();
  const roleCfg = cfg[role];
  if (!roleCfg.enabled) {
    return { ok: false, error: `${role}_printer_disabled`, attempts: [] };
  }

  const attempts = [];

  // ─── Attempt 1: saved config ────────────────────────────────────────────
  const first = await runPrintAttempt(roleCfg, render);
  attempts.push({ source: 'current', address: roleCfg.address, ok: first.ok, error: first.error });
  if (first.ok) {
    setLastWorking(role, roleCfg.address);
    return { ok: true, attempts };
  }

  // Auto-fix only applies when we have a window to query OS printers from.
  // Without one (e.g. early boot) we have no detection signal, so we surface
  // the original error verbatim.
  const window = pickBrowserWindow();
  if (!window) {
    return { ok: false, error: first.error, attempts };
  }

  let detected;
  try {
    detected = await usbDiscovery.listDetectedPrinters(window);
  } catch (err) {
    return { ok: false, error: first.error, attempts, detect_error: err?.message ?? String(err) };
  }

  const decision = resolver.planAutoFix({
    currentConfig: roleCfg,
    detected,
    lastWorking: getLastWorking(role),
  });

  if (decision.action !== 'try-fallback') {
    return {
      ok: false,
      error: first.error,
      attempts,
      plan_recommendation: decision.plan.recommendation,
      plan_reasoning: decision.plan.reasoning,
    };
  }

  // ─── Attempt 2: resolver primary ────────────────────────────────────────
  const fallbackCfg = decision.fallbackConfig;
  const second = await runPrintAttempt(fallbackCfg, render);
  attempts.push({ source: 'fallback', address: fallbackCfg.address, ok: second.ok, error: second.error });

  if (!second.ok) {
    return {
      ok: false,
      // The first error is the one the operator actually configured for, so
      // surface that. The attempts array still carries the fallback detail.
      error: first.error,
      attempts,
      plan_recommendation: decision.plan.recommendation,
      plan_reasoning: decision.plan.reasoning,
    };
  }

  // The fallback worked. Persist only when the resolver said it's safe to do
  // so — transient unhealthy states should let the operator recover the
  // original printer instead of being silently overwritten.
  let persisted = false;
  if (decision.persistOnSuccess) {
    try {
      saveConfig({ [role]: fallbackCfg });
      persisted = true;
    } catch {
      persisted = false;
    }
  }
  setLastWorking(role, fallbackCfg.address);
  return {
    ok: true,
    attempts,
    fallback_applied: {
      from: roleCfg.address,
      to: fallbackCfg.address,
      to_label: decision.plan.primary.label,
      persisted,
      reason: decision.plan.recommendation,
    },
  };
}

async function getStatus() {
  const cfg = loadConfig();
  const [receipt, kitchen] = await Promise.all([
    probeStatus(cfg.receipt),
    probeStatus(cfg.kitchen),
  ]);
  return { receipt, kitchen, checked_at: new Date().toISOString() };
}

// ─── Formatters ──────────────────────────────────────────────────────────
// Layouts mirror docs/TERMINAL-SPEC.md. The printer instance is mutated
// in-place — that's how node-thermal-printer expects to be driven.

function formatTimeShort(iso) {
  const d = iso ? new Date(iso) : new Date();
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
}

function formatDateLong(iso) {
  const d = iso ? new Date(iso) : new Date();
  const date = d.toISOString().slice(0, 10);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
  return `${date}  ${time}`;
}

function moneyFromCentavos(centavos) {
  const value = Number(centavos);
  if (!Number.isFinite(value)) return '$0.00';
  return `$${(value / 100).toFixed(2)}`;
}

// Render the comanda (kitchen ticket). `data` is the shape constructed in
// TableDetail.tsx after a successful sendOrderToKitchen.
//
// Two flavors of comanda are produced from the same renderer:
//   • First print  — header reads "KITCHEN ORDER", items list shows just the
//                    newly-added items.
//   • Correction   — header reads "KITCHEN CORRECTION" with a clear banner
//                    "REPLACES PREVIOUS TICKET". Body holds the full current
//                    snapshot of the order: every currently-active item plus
//                    every voided tombstone (struck through). Items added in
//                    THIS print batch are flagged with "[NEW]" so the cooks
//                    can see what's actually changed at a glance.
//
// ESC/POS doesn't support real strike-through, so voided lines get a clear
// visual treatment: a separator above and below, the "CANCELED" label in
// bold, and every line in the void block prefixed with "X " so it can't be
// mistaken for an active line even after a quick glance.
function renderKitchenComanda(printer, data) {
  const items = Array.isArray(data.items) ? data.items : [];
  const voided = Array.isArray(data.voided_items) ? data.voided_items : [];
  const isCorrection = data.is_correction === true;
  const printedAtMs = data.printed_at ? new Date(data.printed_at).getTime() : NaN;

  // ─── Header ────────────────────────────────────────────────────────────
  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(isCorrection ? 'KITCHEN CORRECTION' : 'KITCHEN ORDER');
  printer.setTextNormal();
  if (isCorrection) {
    // The all-caps banner is the most important text on the slip — the cooks
    // need to know to throw out the previous ticket and replace it with this
    // one, otherwise they'd end up working off two parallel tickets.
    printer.println('** REPLACES PREVIOUS TICKET **');
    printer.println('Discard the previous comanda');
  }
  printer.bold(false);
  printer.drawLine();

  // ─── Order metadata ────────────────────────────────────────────────────
  printer.alignLeft();
  const head = `Order #${data.order_number ?? '--'}`;
  const tail = data.table ?? '';
  printer.leftRight(head, tail);
  printer.leftRight(`Waiter: ${data.waiter ?? '—'}`, formatTimeShort(data.printed_at));
  printer.drawLine();

  // ─── Active items ──────────────────────────────────────────────────────
  for (const item of items) {
    const variant = item.variant?.name ? ` ${item.variant.name}` : '';
    // Flag items added in this print batch. Only meaningful in correction
    // mode (a first print is "all new" by definition).
    const itemSentMs = item.sent_at ? new Date(item.sent_at).getTime() : NaN;
    const isNewInBatch =
      isCorrection &&
      Number.isFinite(itemSentMs) &&
      Number.isFinite(printedAtMs) &&
      itemSentMs === printedAtMs;
    printer.bold(true);
    if (isNewInBatch) {
      printer.println(`+ ${item.quantity}x ${item.product?.name ?? 'Item'}${variant}  [NEW]`);
    } else {
      printer.println(`  ${item.quantity}x ${item.product?.name ?? 'Item'}${variant}`);
    }
    printer.bold(false);
    for (const mod of item.modifiers ?? []) {
      printer.println(`     > ${mod.name}`);
    }
    if (item.notes) {
      printer.println(`     NOTE: ${item.notes}`);
    }
  }

  // ─── Voided tombstones ─────────────────────────────────────────────────
  if (voided.length > 0) {
    if (items.length > 0) printer.drawLine();
    printer.alignCenter();
    printer.bold(true);
    printer.println('** CANCELED **');
    printer.bold(false);
    printer.alignLeft();
    for (const item of voided) {
      const variant = item.variant?.name ? ` ${item.variant.name}` : '';
      printer.bold(true);
      // Every line in the void block is prefixed with "X " so even a glance
      // at any single line tells the cook this isn't an active item.
      printer.println(`X ${item.quantity}x ${item.product?.name ?? 'Item'}${variant}`);
      printer.bold(false);
      for (const mod of item.modifiers ?? []) {
        printer.println(`X    > ${mod.name}`);
      }
      if (item.void_reason) {
        printer.println(`     REASON: ${item.void_reason}`);
      } else if (item.notes) {
        printer.println(`X    NOTE: ${item.notes}`);
      }
    }
  }

  printer.drawLine();
  printer.newLine();
  printer.cut();
}

// Render the customer receipt. Reads the full ActiveOrder shape: items,
// modifiers, payments and totals are all snapshotted on the order at this
// point so the slip matches what was charged even if the menu later changes.
//
// Layout choices worth knowing about:
// • Product line: "  Nx  Name…" left, price right (leftRight). The leading
//   space + 'x' suffix gives a stable visual anchor at the left margin.
// • Modifier line: 6-space indent + "> " prefix, price right-aligned. The
//   indent is deeper than the product's quantity column so the hierarchy is
//   obvious at a glance — that was the main complaint with the previous
//   3-space layout where modifiers blended into the product names.
// • Notes use "! " instead of "> " to distinguish "special instruction" from
//   "ingredient choice" — both are indented the same way.
// • TOTAL is its own line, right-aligned, bold, double-height — impossible
//   to miss when handing the slip to the customer.
function renderReceipt(printer, data, business) {
  const order = data.order;
  if (!order) throw new Error('printReceipt: missing order data');

  // ─── Header (business identity, centered) ──────────────────────────────
  printer.alignCenter();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(business?.name || 'Restaurant POS');
  printer.setTextNormal();
  printer.bold(false);
  if (business?.tax_id) printer.println(business.tax_id);
  if (business?.address) printer.println(business.address);
  printer.drawLine();

  // ─── Order metadata (order # / table on the same row to save paper) ────
  printer.alignLeft();
  const tableLabel =
    order.order_type === 'TAKEOUT'
      ? `Takeout #${order.order_number}`
      : order.table
        ? `Table ${order.table.number}`
        : 'Counter';
  printer.bold(true);
  printer.leftRight(`Order #${order.order_number}`, tableLabel);
  printer.bold(false);
  printer.println(`Date:    ${formatDateLong(order.created_at)}`);
  printer.println(`Cashier: ${order.user?.name ?? '—'}`);
  printer.drawLine();

  // ─── Items + modifiers + notes ─────────────────────────────────────────
  // Voided lines are tombstones on the order — totals already exclude them
  // (recalculateOrderTotals filters voided_at), so the customer receipt must
  // skip them too. Otherwise the line list and the TOTAL won't agree.
  const visibleItems = (order.items ?? []).filter((i) => !i.voided_at);
  for (const item of visibleItems) {
    const variant = item.variant?.name ? ` ${item.variant.name}` : '';
    // Quantity gets a 2-char zone so single- and double-digit qtys line up.
    const qty = String(item.quantity).padStart(2);
    const productLine = ` ${qty}x ${item.product?.name ?? 'Item'}${variant}`;
    printer.leftRight(productLine, moneyFromCentavos(item.line_total));

    for (const mod of item.modifiers ?? []) {
      const extra = Number(mod.extra_price);
      const label = `      > ${mod.name}`;
      if (Number.isFinite(extra) && extra > 0) {
        printer.leftRight(label, `+${moneyFromCentavos(extra)}`);
      } else {
        printer.println(label);
      }
    }
    if (item.notes) {
      // Same 6-space indent as modifiers so the hierarchy reads consistently.
      printer.println(`      ! ${item.notes}`);
    }
  }
  printer.drawLine();

  // ─── Totals (Subtotal / Tax / Discount, then a hero TOTAL line) ────────
  const subtotal = Number(order.subtotal);
  const tax = Number(order.tax_amount);
  const taxLabel =
    Number.isFinite(subtotal) && subtotal > 0 && Number.isFinite(tax) && tax > 0
      ? `Tax (${Math.round((tax / subtotal) * 100)}%)`
      : 'Tax';
  printer.leftRight('Subtotal', moneyFromCentavos(order.subtotal));
  printer.leftRight(taxLabel, moneyFromCentavos(order.tax_amount));
  if (Number(order.discount_amount) > 0) {
    printer.leftRight('Discount', `-${moneyFromCentavos(order.discount_amount)}`);
  }
  printer.newLine();

  // The grand total is the eye-catcher of the whole slip — give it its own
  // double-height bold line so it stands out even at a glance.
  printer.alignRight();
  printer.bold(true);
  printer.setTextDoubleHeight();
  printer.println(`TOTAL  ${moneyFromCentavos(order.total)}`);
  printer.setTextNormal();
  printer.bold(false);
  printer.alignLeft();
  printer.newLine();

  // ─── Payments (one row per tender, plus change/reference where relevant)
  for (const payment of order.payments ?? []) {
    const label = payment.method === 'CASH' ? 'Cash' : payment.method === 'CARD' ? 'Card' : 'Transfer';
    printer.leftRight(label, moneyFromCentavos(payment.amount));
    if (payment.method === 'CASH' && Number(payment.change_amount) > 0) {
      printer.leftRight('Change', moneyFromCentavos(payment.change_amount));
    }
    if (payment.reference) {
      printer.println(`   Ref: ${payment.reference}`);
    }
  }
  printer.drawLine();

  // ─── Footer ────────────────────────────────────────────────────────────
  printer.alignCenter();
  printer.bold(true);
  printer.println('Thank you!');
  printer.bold(false);
  printer.println(`Order #${order.order_number}`);
  printer.newLine();
  printer.cut();
}

// ─── Public IPC entry points ─────────────────────────────────────────────

async function printKitchen(data) {
  return tryPrintWithFallback('kitchen', (printer) => renderKitchenComanda(printer, data));
}

async function printReceipt(data) {
  // The renderer is closed over the business identity at call time so the
  // fallback path doesn't re-read the config between attempts.
  const business = loadConfig().business;
  return tryPrintWithFallback('receipt', (printer) => renderReceipt(printer, data, business));
}

// Test print: a small slip the cashier can use to confirm they wired the
// right device. Kept role-independent so the same logic runs from either
// side of the Settings modal. Goes through the same auto-fix wrapper so a
// test against a stale address quietly recovers and reports which printer
// it actually used.
async function testPrint(role) {
  const renderTest = (printer) => {
    const roleCfg = loadConfig()[role];
    printer.alignCenter();
    printer.bold(true);
    printer.setTextDoubleHeight();
    printer.println(role === 'kitchen' ? 'KITCHEN PRINTER' : 'RECEIPT PRINTER');
    printer.setTextNormal();
    printer.bold(false);
    printer.println('Test print');
    printer.drawLine();
    printer.alignLeft();
    printer.leftRight('Connection:', roleCfg.connection.toUpperCase());
    printer.leftRight('Address:', roleCfg.address || '—');
    printer.leftRight('Type:', roleCfg.type);
    printer.leftRight('Width:', String(roleCfg.width));
    printer.leftRight('Time:', formatDateLong());
    printer.drawLine();
    printer.alignCenter();
    printer.println('If you can read this,');
    printer.println('the printer is wired correctly.');
    printer.newLine();
    printer.cut();
  };
  return tryPrintWithFallback(role, renderTest);
}

async function printToAddress(config, lines) {
  const roleConfig = {
    enabled: true,
    type: config.printer_model || 'epson',
    connection: config.connection_type === 'USB' ? 'usb' : 'network',
    address: config.address || '',
    width: config.paper_width || 48,
    characterSet: config.character_set || 'PC850_MULTILINGUAL',
  };
  try {
    const printer = buildPrinter(roleConfig);
    for (const line of lines) {
      printer.println(line);
    }
    printer.cut();
    const result = await printer.execute();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

module.exports = {
  loadConfig,
  saveConfig,
  getStatus,
  printKitchen,
  printReceipt,
  printToAddress,
  testPrint,
  // Exposed so main.cjs's IPC layer can keep its lastWorking map in sync —
  // single source of truth lives here in the printer service.
  setLastWorking,
  getLastWorking,
};
