/**
 * Shared rendering helpers for the daily-report and shift-report printable
 * HTML pages (REPORTS-SPEC §5). Pure functions: no DB access, no settings
 * lookups — callers pass in the language + currency they want and we hand
 * back labels, formatters, and the common CSS.
 *
 * The page is a verification checklist designed to be printed B&W on letter
 * portrait, single page, then physically marked up with a pen by whoever
 * counts the cash.
 */

import type {
  AlertSeverity,
  AlertType,
  ShiftType,
} from '@prisma/client';
import type {
  CurrencyCode,
  LanguageCode,
} from '../settings/schema.js';

const HTML_ENTITIES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"']/g, (ch) => HTML_ENTITIES[ch] ?? ch);
}

export function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

export interface ReportLabels {
  // Cash section
  cashInDrawer: string;
  bills: string;
  coins: string;
  totalCounted: string;
  expected: string;
  difference: string;
  shortage: string;
  surplus: string;
  ok: string;
  // Reconciliation formula
  fund: string;
  cashSalesLine: string;
  cashIn: string;
  cashOut: string;
  // Sales
  sales: string;
  grossSales: string;
  discounts: string;
  netSales: string;
  tax: string;
  tickets: string;
  avg: string;
  // Payments
  paymentMethods: string;
  cash: string;
  card: string;
  transfer: string;
  // Shifts
  shifts: string;
  provisional: string;
  unverified: string;
  countedShort: string;
  diffShort: string;
  // Products
  products: string;
  topProducts: string;
  categories: string;
  // Alerts
  alerts: string;
  resolved: string;
  // Verification
  verification: string;
  resolution: string;
  notes: string;
  verifiedBy: string;
  signature: string;
  closedBy: string;
  // UI / titles
  reportTitle: string;
  printButton: string;
  closeButton: string;
  shiftReportTitle: string;
  opened: string;
  closed: string;
  /** On-screen hint explaining the URL header in browser print previews. */
  printTip: string;
}

export function getReportLabels(lang: LanguageCode): ReportLabels {
  if (lang === 'es') {
    return {
      cashInDrawer: 'Efectivo en caja',
      bills: 'Billetes',
      coins: 'Monedas',
      totalCounted: 'Total contado',
      expected: 'Debe haber',
      difference: 'Diferencia',
      shortage: 'Faltante',
      surplus: 'Sobrante',
      ok: 'Cuadrado',
      fund: 'Fondo inicial',
      cashSalesLine: 'Ventas efectivo',
      cashIn: 'Ingresos',
      cashOut: 'Gastos',
      sales: 'Ventas',
      grossSales: 'Venta bruta',
      discounts: 'Descuentos',
      netSales: 'Venta neta',
      tax: 'Impuesto',
      tickets: 'tickets',
      avg: 'promedio',
      paymentMethods: 'Formas de pago',
      cash: 'Efectivo',
      card: 'Tarjeta',
      transfer: 'Transferencia',
      shifts: 'Turnos',
      provisional: 'Provisional',
      unverified: 'Sin verificar',
      countedShort: 'Contó',
      diffShort: 'Dif.',
      products: 'Productos',
      topProducts: 'Más vendidos',
      categories: 'Categorías',
      alerts: 'Alertas',
      resolved: 'Resuelto',
      verification: 'Verificación',
      resolution: 'Resolución',
      notes: 'Notas',
      verifiedBy: 'Verificado por',
      signature: 'Firma',
      closedBy: 'Cerrado por',
      reportTitle: 'Corte',
      printButton: 'Imprimir',
      closeButton: 'Cerrar',
      shiftReportTitle: 'Reporte de turno',
      opened: 'Abierto',
      closed: 'Cerrado',
      printTip: 'Sugerencia: en el cuadro de impresión, desactive “Encabezados y pies de página” para ocultar la URL.',
    };
  }
  return {
    cashInDrawer: 'Cash in drawer',
    bills: 'Bills',
    coins: 'Coins',
    totalCounted: 'Total counted',
    expected: 'Expected',
    difference: 'Difference',
    shortage: 'Shortage',
    surplus: 'Surplus',
    ok: 'OK',
    fund: 'Opening fund',
    cashSalesLine: 'Cash sales',
    cashIn: 'Cash in',
    cashOut: 'Cash out',
    sales: 'Sales',
    grossSales: 'Gross sales',
    discounts: 'Discounts',
    netSales: 'Net sales',
    tax: 'Tax',
    tickets: 'tickets',
    avg: 'avg',
    paymentMethods: 'Payment methods',
    cash: 'Cash',
    card: 'Card',
    transfer: 'Transfer',
    shifts: 'Shifts',
    provisional: 'Provisional',
    unverified: 'Unverified',
    countedShort: 'Counted',
    diffShort: 'Diff.',
    products: 'Products',
    topProducts: 'Top products',
    categories: 'Categories',
    alerts: 'Alerts',
    resolved: 'Resolved',
    verification: 'Verification',
    resolution: 'Resolution',
    notes: 'Notes',
    verifiedBy: 'Verified by',
    signature: 'Signature',
    closedBy: 'Closed by',
    reportTitle: 'Daily Close',
    printButton: 'Print',
    closeButton: 'Close',
    shiftReportTitle: 'Shift Report',
    opened: 'Opened',
    closed: 'Closed',
    printTip: 'Tip: in the print dialog, turn off “Headers and footers” to hide the URL.',
  };
}

/**
 * Build a currency formatter that turns centavos into a localised currency
 * string. Uses Intl.NumberFormat — the runtime decides the symbol/grouping
 * rather than hard-coding "$" — so the same MXN code prints "$1,234.50" in
 * en-US and "$1,234.50" in es-MX (locale uses the same symbol but distinct
 * grouping/decimal characters in some currencies).
 */
export function currencyFormatter(
  language: LanguageCode,
  currency: CurrencyCode,
): (centavos: number | null | undefined) => string {
  const locale = language === 'es' ? 'es-MX' : 'en-US';
  const fmt = new Intl.NumberFormat(locale, { style: 'currency', currency });
  return (centavos) => {
    if (centavos === null || centavos === undefined) return '—';
    return fmt.format(centavos / 100);
  };
}

/** Wrap a currency formatter to prefix positives with "+". */
export function signedFormatter(format: (n: number) => string) {
  return (n: number | null | undefined): string => {
    if (n === null || n === undefined) return '—';
    if (n > 0) return `+${format(n)}`;
    return format(n);
  };
}

/**
 * Long-form date used in the printout header ("27 de abril de 2026" /
 * "April 27, 2026"). UTC because DailyReport.date is a DATE column stored at
 * midnight UTC — local-zone formatting can shift the day.
 */
export function longDate(date: Date, language: LanguageCode): string {
  const locale = language === 'es' ? 'es-MX' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}

/** Compact dd/mm/yyyy or mm/dd/yyyy form for the footer. */
export function shortDate(date: Date, language: LanguageCode): string {
  const locale = language === 'es' ? 'es-MX' : 'en-US';
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: 'UTC',
  }).format(date);
}

export function timeUtc(date: Date): string {
  const h = String(date.getUTCHours()).padStart(2, '0');
  const m = String(date.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

/**
 * Decide which status arrow + word goes next to the cash difference.
 * Negative variance = SHORTAGE (▲), positive = SURPLUS (▼), zero = OK (✓).
 * The arrows are intentionally Unicode (not images) so they print on any
 * thermal-or-laser printer that handles UTF-8.
 */
export function varianceStatus(
  variance: number | null | undefined,
  labels: ReportLabels,
): { label: string; cls: string } {
  if (variance === null || variance === undefined || variance === 0) {
    return { label: `✓ ${labels.ok.toUpperCase()}`, cls: 'ok' };
  }
  if (variance < 0) {
    return { label: `▲ ${labels.shortage.toUpperCase()}`, cls: 'shortage' };
  }
  return { label: `▼ ${labels.surplus.toUpperCase()}`, cls: 'surplus' };
}

/**
 * Localised label for an alert type. Used when rendering individual alert
 * lines if the message itself doesn't already cover the type — most alert
 * messages bake the type into the prose, so this is a fallback.
 */
export function alertTypeLabel(type: AlertType, lang: LanguageCode): string {
  const map: Record<LanguageCode, Record<AlertType, string>> = {
    es: {
      CASH_SHORTAGE: 'Faltante de efectivo',
      CASH_SURPLUS: 'Sobrante de efectivo',
      RECURRING_SHORTAGE: 'Faltante recurrente',
      EXCESSIVE_VOIDS: 'Cancelaciones excesivas',
      EXCESSIVE_DISCOUNTS: 'Descuentos excesivos',
      UNVERIFIED_PROVISIONAL: 'Turno provisional sin verificar',
      LATE_VOID: 'Cancelación tardía',
    },
    en: {
      CASH_SHORTAGE: 'Cash shortage',
      CASH_SURPLUS: 'Cash surplus',
      RECURRING_SHORTAGE: 'Recurring shortage',
      EXCESSIVE_VOIDS: 'Excessive voids',
      EXCESSIVE_DISCOUNTS: 'Excessive discounts',
      UNVERIFIED_PROVISIONAL: 'Unverified provisional',
      LATE_VOID: 'Late void',
    },
  };
  return map[lang][type];
}

/** Sort alerts: unresolved first (severity desc), then resolved at the bottom. */
const SEVERITY_ORDER: Record<AlertSeverity, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function sortAlertsForPrint<T extends { resolved: boolean; severity: AlertSeverity }>(
  alerts: T[],
): T[] {
  return [...alerts].sort((a, b) => {
    if (a.resolved !== b.resolved) return a.resolved ? 1 : -1;
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
  });
}

export function provisionalTag(type: ShiftType): boolean {
  return type === 'PROVISIONAL';
}

/**
 * Embedded stylesheet shared by both report HTMLs. The base theme is light
 * cream-on-paper for screen viewing; @media print collapses it to pure
 * black-on-white, hides the toolbar, and snaps to letter portrait with
 * tight margins so the page fits on one sheet.
 *
 * Section blocks use CSS Grid with explicit columns to keep the [ ] checkbox
 * column aligned across denomination, total, and formula lines.
 */
export const PRINT_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    color: #000;
    background: #f4f1ec;
    font-size: 10pt;
    line-height: 1.25;
  }
  .page {
    max-width: 760px;
    margin: 0 auto;
    padding: 14px 22px 18px;
    background: #fff;
    box-shadow: 0 2px 8px rgba(0,0,0,0.08);
  }
  .toolbar {
    display: flex; justify-content: flex-end; align-items: center; gap: 8px;
    margin-bottom: 10px;
  }
  .toolbar-tip {
    flex: 1; font-size: 11pt; color: #6b5040;
  }
  button.print-btn, button.close-btn {
    font: inherit; font-size: 11pt;
    padding: 8px 16px; border-radius: 6px;
    cursor: pointer;
  }
  button.print-btn { background: #2c1a0e; color: #f0e0c0; border: 1px solid #2c1a0e; }
  button.close-btn { background: #fff; color: #6b5040; border: 1px solid #d8cdb8; }

  .hdr {
    display: flex; justify-content: space-between; align-items: flex-start;
    gap: 16px; padding-bottom: 4px; margin-bottom: 4px;
    border-bottom: 2px solid #000;
  }
  .hdr-left .biz {
    font-size: 13pt; font-weight: 700;
    letter-spacing: 0.3px;
  }
  .hdr-left .biz-sub {
    font-size: 9pt; margin-top: 1px;
  }
  .hdr-right { text-align: right; }
  .hdr-right .folio {
    font-size: 12pt; font-weight: 700;
    letter-spacing: 0.5px;
  }
  .hdr-right .date {
    font-size: 9.5pt; margin-top: 1px;
  }

  h2 {
    font-family: inherit;
    font-size: 10pt; font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    border-bottom: 1.5px solid #000;
    padding-bottom: 1px;
    margin: 5px 0 2px;
  }

  section { break-inside: avoid; page-break-inside: avoid; margin-bottom: 2px; }

  .sub-header {
    display: grid;
    grid-template-columns: 1fr auto;
    column-gap: 12px;
    line-height: 1.3;
    margin: 2px 0 4px;
  }

  .denom-group {
    font-size: 9pt;
    font-weight: 600;
    margin: 2px 0 1px;
  }

  /* Six-column denomination row: [ ] count × denom dots subtotal */
  .denom-row {
    display: grid;
    grid-template-columns: 26px 32px 16px 64px 1fr 96px;
    align-items: baseline;
    column-gap: 5px;
    line-height: 1.2;
  }
  /* Three-column rows used for formula lines, totals, payment lines, etc. */
  .check-row {
    display: grid;
    grid-template-columns: 26px 1fr 110px;
    align-items: baseline;
    column-gap: 6px;
    line-height: 1.2;
  }
  .check-row.indent { padding-left: 26px; grid-template-columns: 1fr 110px; column-gap: 6px; }

  /* Keep the literal "[ ]" checkbox text on one line. Without nowrap the
     space between the brackets is a valid break opportunity and on narrow
     grid columns the renderer will wrap "[" and "]" onto separate lines. */
  .check, .denom-checkbox {
    font-family: 'Courier New', Courier, monospace;
    font-weight: 700;
    white-space: nowrap;
  }
  .num { font-variant-numeric: tabular-nums; text-align: right; }
  .dots {
    border-bottom: 1px dotted #555;
    height: 0.55em;
    margin: 0 4px 2px;
  }

  .total-line {
    border-top: 1px solid #000;
    padding-top: 2px; margin-top: 2px;
    font-weight: 700;
  }
  .diff-status {
    text-align: right;
    font-weight: 700;
    margin-top: 1px;
    letter-spacing: 0.4px;
  }

  /* Compact shift summary block */
  .shift-block {
    display: grid;
    grid-template-columns: 1.6fr auto auto auto;
    column-gap: 14px;
    align-items: baseline;
    padding: 2px 0;
    border-bottom: 1px dotted #bbb;
  }
  .shift-block:last-child { border-bottom: none; }
  .shift-detail {
    grid-column: 1 / -1;
    font-size: 9pt;
    padding-left: 10px;
    margin-top: 0;
  }
  .shift-prov {
    grid-column: 1 / -1;
    font-size: 8.5pt;
    font-weight: 700;
    letter-spacing: 0.4px;
    padding-left: 10px;
    margin-top: 0;
  }

  /* Two-column products + categories layout */
  .products-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 24px;
  }
  .prod-row, .cat-row {
    display: grid;
    grid-template-columns: 1fr auto auto;
    column-gap: 10px;
    line-height: 1.35;
    font-size: 9pt;
  }
  .col-title {
    font-size: 9pt;
    font-weight: 700;
    letter-spacing: 0.4px;
    text-transform: uppercase;
    margin-bottom: 1px;
  }

  .alert-row { padding: 0; line-height: 1.3; }
  .alert-row::before { content: '▪ '; font-weight: 700; }
  .alert-resolved { color: #555; }

  .verify-box {
    border: 1.5px solid #000;
    padding: 4px 10px;
    margin: 3px 0 2px;
  }
  .verify-line { margin: 1px 0; }
  .sig-row {
    display: flex; gap: 14px; margin-top: 6px;
    font-size: 9.5pt;
    align-items: baseline;
  }
  .sig-line {
    display: inline-block;
    border-bottom: 1px solid #000;
    width: 170px;
    height: 1em;
    margin: 0 6px;
  }

  .ftr {
    margin-top: 4px;
    padding-top: 3px;
    border-top: 1px solid #000;
    font-size: 8.5pt;
    text-align: center;
  }

  @page { margin: 9mm 8mm; size: letter portrait; }

  @media print {
    /* Suppress any browser-injected URL/title in the page header by pulling
       the @page margins in tight; the user must also disable "Headers and
       footers" in their browser's print dialog for a fully clean sheet
       (we surface that hint in the on-screen toolbar). */
    @page { margin: 9mm 8mm; size: letter portrait; }
    html, body { background: #fff !important; font-size: 9.5pt; }
    .page { max-width: none; padding: 0; background: #fff !important; box-shadow: none !important; }
    .no-print, .toolbar, .toolbar-tip, .print-btn, .close-btn { display: none !important; }
    * {
      color: #000 !important;
      background: transparent !important;
      box-shadow: none !important;
      text-shadow: none !important;
    }
    section { break-inside: avoid; page-break-inside: avoid; }
  }
`;

/**
 * Wrap the rendered sections in the standard <html> shell. Title is left
 * empty on purpose: most browsers print the document.title in the header
 * margin, which would leak "Daily Report Z-0001" onto the page. Empty title
 * suppresses it. The blob: URL leak is a separate browser-print-settings
 * concern — caller mitigates it client-side.
 */
export function wrapHtmlPage(content: string, lang: LanguageCode): string {
  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
<meta charset="utf-8">
<title></title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>${PRINT_STYLES}</style>
</head>
<body>
<div class="page">
${content}
</div>
</body>
</html>`;
}

/**
 * Toolbar shown above the print area on screen, hidden on print. Buttons
 * call window.print() and window.close() — the second is a no-op when the
 * page wasn't opened in a popup, which matches the admin's blob-URL flow
 * (the user dismisses the new tab manually instead).
 */
export function renderToolbar(labels: ReportLabels): string {
  return `<div class="toolbar no-print">
    <span class="toolbar-tip">${escapeHtml(labels.printTip)}</span>
    <button type="button" class="close-btn" onclick="window.close()">${escapeHtml(labels.closeButton)}</button>
    <button type="button" class="print-btn" onclick="window.print()">${escapeHtml(labels.printButton)}</button>
  </div>`;
}
