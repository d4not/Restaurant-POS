import {
  AlertSeverity,
  AlertType,
  CashMovementType,
  OrderStatus,
  PaymentMethod,
  Prisma,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { Decimal } from '../../lib/decimal.js';
import { NotFoundError } from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { formatMoney } from '../print/formatter.js';
import { getSetting } from '../settings/service.js';
import {
  ALERT_THRESHOLD_DEFAULTS,
  CURRENCY_DEFAULT,
  CURRENCY_VALUES,
  LANGUAGE_DEFAULT,
  LANGUAGE_VALUES,
  SETTING_KEYS,
  type CurrencyCode,
  type LanguageCode,
} from '../settings/schema.js';
import {
  currencyFormatter,
  escapeHtml,
  getReportLabels,
  longDate,
  renderToolbar,
  resolveReportOverrides,
  shortDate,
  signedFormatter,
  sortAlertsForPrint,
  timeUtc,
  varianceStatus,
  wrapHtmlPage,
} from '../print/report-html.js';
import type { ListShiftReportQuery } from './schema.js';

type Tx = Prisma.TransactionClient;

const shiftReportInclude = {
  cash_register: {
    select: {
      id: true,
      status: true,
      opened_at: true,
      closed_at: true,
      opening_amount: true,
      expected_amount: true,
      actual_amount: true,
      difference: true,
    },
  },
  alerts: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.ShiftReportInclude;

function toInt(value: Decimal): number {
  // ShiftReport columns are Int (centavos) — Decimal computations need to
  // collapse down before insert. Round half-up so a 0.5 split goes to the
  // larger side, matching the receipt rounding used elsewhere.
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

interface CategorySalesRow {
  category_id: string | null;
  category_name: string;
  item_count: number;
  total: number;
}

interface TopProductRow {
  product_id: string;
  product_name: string;
  quantity: number;
  total: number;
}

/**
 * Build the per-category and top-product JSON snapshots from the orderItem
 * rows of a single shift. Voided lines are excluded — they never reached the
 * customer and shouldn't show up in revenue. Items without a category roll up
 * into a single "Uncategorized" bucket so the JSON is always exhaustive.
 */
function summarizeItemRollups(
  items: Array<{
    product_id: string;
    quantity: number;
    line_total: Prisma.Decimal;
    product: {
      name: string;
      category_id: string | null;
      category: { id: string; name: string } | null;
    };
  }>,
): { sales_by_category: CategorySalesRow[]; top_products: TopProductRow[] } {
  const categoryMap = new Map<
    string,
    { category_id: string | null; category_name: string; item_count: number; total: Decimal }
  >();
  const productMap = new Map<
    string,
    { product_id: string; product_name: string; quantity: number; total: Decimal }
  >();

  for (const item of items) {
    const categoryKey = item.product.category_id ?? '__no_category__';
    const categoryName = item.product.category?.name ?? 'Uncategorized';
    const lineTotal = new Decimal(item.line_total);

    const cat = categoryMap.get(categoryKey);
    if (cat) {
      cat.item_count += item.quantity;
      cat.total = cat.total.add(lineTotal);
    } else {
      categoryMap.set(categoryKey, {
        category_id: item.product.category_id,
        category_name: categoryName,
        item_count: item.quantity,
        total: lineTotal,
      });
    }

    const prod = productMap.get(item.product_id);
    if (prod) {
      prod.quantity += item.quantity;
      prod.total = prod.total.add(lineTotal);
    } else {
      productMap.set(item.product_id, {
        product_id: item.product_id,
        product_name: item.product.name,
        quantity: item.quantity,
        total: lineTotal,
      });
    }
  }

  const sales_by_category: CategorySalesRow[] = [...categoryMap.values()]
    .map((c) => ({
      category_id: c.category_id,
      category_name: c.category_name,
      item_count: c.item_count,
      total: toInt(c.total),
    }))
    .sort((a, b) => b.total - a.total);

  // Top 10 by quantity, with line_total used as tiebreaker so the same-quantity
  // higher-revenue product surfaces first.
  const top_products: TopProductRow[] = [...productMap.values()]
    .map((p) => ({
      product_id: p.product_id,
      product_name: p.product_name,
      quantity: p.quantity,
      total: toInt(p.total),
    }))
    .sort((a, b) => (b.quantity - a.quantity) || (b.total - a.total))
    .slice(0, 10);

  return { sales_by_category, top_products };
}

/**
 * Generate a ShiftReport snapshot for a closing register. MUST be called
 * inside the same transaction as closeRegister() — every aggregate it reads
 * must see the post-close state (status flip + actual_amount). Returns the
 * created ShiftReport.
 *
 * Implements REPORTS-SPEC §4.1:
 *  - Sales aggregation from PAID orders on this register.
 *  - Void totals from CANCELLED orders on this register.
 *  - Payment breakdown — cash_sales is net of change_amount so the column
 *    represents what stayed in the drawer.
 *  - Cash reconciliation: opening + cash_sales + cash_in − cash_out =
 *    expected_cash, then variance = actual − expected.
 *  - JSON snapshots for category and top-product rollups.
 *
 * Denormalises user / role / shift_type so later edits to those don't rewrite
 * historical reports.
 */
export async function generateShiftReport(
  tx: Tx,
  cashRegisterId: string,
  actualAmount: Decimal | number | string,
) {
  const register = await tx.cashRegister.findUniqueOrThrow({
    where: { id: cashRegisterId },
    select: {
      id: true,
      opening_amount: true,
      opened_at: true,
      closed_at: true,
      user: { select: { id: true, name: true, role: true } },
      // Provisional snapshot — denormalised onto the ShiftReport so the admin
      // panel can render the partial-cut data even after the verifier user
      // row changes. provisional_verified_by_id is NOT set here when
      // verifyProvisional was never run, in which case all provisional_*
      // fields are null and was_provisional=false on the snapshot.
      provisional_verified_by_id: true,
      provisional_verified_at: true,
      provisional_expected_amount: true,
      provisional_actual_amount: true,
      provisional_difference: true,
      provisional_verified_by: { select: { id: true, name: true } },
    },
  });

  // Active (non-voided) line items from PAID orders, with category context for
  // the rollups. Cancelled orders contribute to void totals only.
  const paidItems = await tx.orderItem.findMany({
    where: {
      voided_at: null,
      order: {
        register_id: cashRegisterId,
        status: OrderStatus.PAID,
      },
    },
    select: {
      product_id: true,
      quantity: true,
      line_total: true,
      product: {
        select: {
          id: true,
          name: true,
          category_id: true,
          category: { select: { id: true, name: true } },
        },
      },
    },
  });

  const paidOrders = await tx.order.findMany({
    where: { register_id: cashRegisterId, status: OrderStatus.PAID },
    select: {
      total: true,
      tax_amount: true,
      discount_amount: true,
    },
  });

  const cancelledOrders = await tx.order.findMany({
    where: { register_id: cashRegisterId, status: OrderStatus.CANCELLED },
    select: { total: true },
  });

  const payments = await tx.payment.findMany({
    where: { order: { register_id: cashRegisterId, status: OrderStatus.PAID } },
    select: { method: true, amount: true, change_amount: true, tip_amount: true },
  });

  const cashMovements = await tx.cashMovement.findMany({
    where: { register_id: cashRegisterId },
    select: { type: true, amount: true },
  });

  // ---- Sales totals ---------------------------------------------------------
  let grossSales = new Decimal(0);
  let taxCollected = new Decimal(0);
  let discounts = new Decimal(0);
  for (const o of paidOrders) {
    grossSales = grossSales.add(new Decimal(o.total));
    taxCollected = taxCollected.add(new Decimal(o.tax_amount));
    discounts = discounts.add(new Decimal(o.discount_amount));
  }
  const totalTickets = paidOrders.length;
  const netSales = grossSales.sub(discounts);
  const avgTicket = totalTickets > 0 ? grossSales.div(totalTickets) : new Decimal(0);

  // ---- Voids ----------------------------------------------------------------
  let voidTotal = new Decimal(0);
  for (const o of cancelledOrders) voidTotal = voidTotal.add(new Decimal(o.total));
  const voidCount = cancelledOrders.length;

  // ---- Payment breakdown ----------------------------------------------------
  // Each payment's `amount` is the gross tender (sale + tip + change). To get
  // the order-side contribution we subtract change_amount AND tip_amount —
  // tips live in the jar, not the drawer (Phase 11).
  let cashSales = new Decimal(0);
  let cardSales = new Decimal(0);
  let transferSales = new Decimal(0);
  let otherSales = new Decimal(0);
  let tipsCollected = new Decimal(0);
  for (const p of payments) {
    const amount = new Decimal(p.amount);
    const change = new Decimal(p.change_amount);
    const tip = new Decimal(p.tip_amount);
    tipsCollected = tipsCollected.add(tip);
    const orderPortion = amount.sub(tip);
    switch (p.method) {
      case PaymentMethod.CASH:
        cashSales = cashSales.add(orderPortion).sub(change);
        break;
      case PaymentMethod.CARD:
        cardSales = cardSales.add(orderPortion);
        break;
      case PaymentMethod.TRANSFER:
        transferSales = transferSales.add(orderPortion);
        break;
      default:
        otherSales = otherSales.add(orderPortion);
    }
  }

  // ---- Cash reconciliation --------------------------------------------------
  const opening = new Decimal(register.opening_amount);
  let cashIn = new Decimal(0);
  let cashOut = new Decimal(0);
  for (const m of cashMovements) {
    const amount = new Decimal(m.amount);
    if (m.type === CashMovementType.CASH_IN) cashIn = cashIn.add(amount);
    else cashOut = cashOut.add(amount);
  }
  const expectedCash = opening.add(cashSales).add(cashIn).sub(cashOut);
  const actualCash = new Decimal(actualAmount);
  const cashVariance = actualCash.sub(expectedCash);

  const { sales_by_category, top_products } = summarizeItemRollups(paidItems);

  // Provisional history denormalisation. was_provisional=true means the
  // register was opened by floor staff and a cashier+ ran verifyProvisional
  // before close. The snapshot fields capture the partial-cut numbers so
  // the admin panel can render them alongside the final close.
  const wasProvisional = register.provisional_verified_at != null;
  const provisionalSnapshot = wasProvisional
    ? {
        provisional_opened_by_role: register.user.role as string,
        provisional_verified_by_id: register.provisional_verified_by_id ?? null,
        provisional_verified_by_name:
          register.provisional_verified_by?.name ?? null,
        provisional_verified_at: register.provisional_verified_at,
        provisional_expected_amount: register.provisional_expected_amount
          ? toInt(new Decimal(register.provisional_expected_amount))
          : null,
        provisional_actual_amount: register.provisional_actual_amount
          ? toInt(new Decimal(register.provisional_actual_amount))
          : null,
        provisional_difference: register.provisional_difference
          ? toInt(new Decimal(register.provisional_difference))
          : null,
      }
    : {};

  const created = await tx.shiftReport.create({
    data: {
      cash_register_id: register.id,
      user_id: register.user.id,
      user_name: register.user.name,
      user_role: register.user.role,
      opened_at: register.opened_at,
      // closed_at is stamped by closeRegister() before this runs; falling back
      // to "now" keeps the column non-null even in unusual call orders.
      closed_at: register.closed_at ?? new Date(),

      gross_sales: toInt(grossSales),
      discounts: toInt(discounts),
      // Comps are not yet a first-class concept in the ordering domain — leave
      // at 0 until the spec lands a comp flow. void_total covers the audit
      // surface that "comps" would otherwise share.
      comps: 0,
      void_total: toInt(voidTotal),
      void_count: voidCount,
      net_sales: toInt(netSales),
      tax_collected: toInt(taxCollected),

      total_tickets: totalTickets,
      avg_ticket: toInt(avgTicket),

      cash_sales: toInt(cashSales),
      card_sales: toInt(cardSales),
      transfer_sales: toInt(transferSales),
      other_sales: toInt(otherSales),

      opening_amount: toInt(opening),
      cash_in: toInt(cashIn),
      cash_out: toInt(cashOut),
      expected_cash: toInt(expectedCash),
      actual_cash: toInt(actualCash),
      cash_variance: toInt(cashVariance),
      tips_collected: toInt(tipsCollected),

      was_provisional: wasProvisional,
      ...provisionalSnapshot,

      sales_by_category: sales_by_category as unknown as Prisma.InputJsonValue,
      top_products: top_products as unknown as Prisma.InputJsonValue,
    },
    include: shiftReportInclude,
  });

  await generateShiftAlerts(tx, created.id, register.user.id, register.user.name, {
    grossSales: toInt(grossSales),
    discounts: toInt(discounts),
    voidCount,
    cashVariance: toInt(cashVariance),
  });

  // Re-fetch with the freshly-inserted alerts so callers see the full payload.
  return tx.shiftReport.findUniqueOrThrow({
    where: { id: created.id },
    include: shiftReportInclude,
  });
}

/**
 * Read a numeric setting with a fallback default. Settings are stored as
 * strings; we coerce here. Falls back when the row was missing or its value
 * doesn't parse — keeps tests that truncate the settings table working
 * against the spec defaults instead of silently emitting 0-threshold alerts.
 */
async function readNumericSetting(
  client: Tx,
  key: string,
  fallback: number,
): Promise<number> {
  const raw = await getSetting(key, client);
  if (raw == null) return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Generate the shift-level Alert rows attached to a freshly-created
 * ShiftReport, per REPORTS-SPEC §4.3:
 *
 *   - cash_variance < -shortage_threshold → CASH_SHORTAGE
 *       severity HIGH; CRITICAL when |variance| > 5000 centavos
 *   - cash_variance > +surplus_threshold → CASH_SURPLUS  (MEDIUM)
 *   - void_count > max_voids_per_shift   → EXCESSIVE_VOIDS (HIGH)
 *   - discounts / gross_sales > max_pct  → EXCESSIVE_DISCOUNTS (MEDIUM)
 *
 * RECURRING_SHORTAGE (3-shift streak) is intentionally unimplemented
 * here — surfacing it requires a streak query across the user's prior shifts
 * and the current spec asks only for the standalone CASH_SHORTAGE on this
 * shift to land in the report.
 */
async function generateShiftAlerts(
  tx: Tx,
  shiftReportId: string,
  userId: string,
  userName: string,
  totals: {
    grossSales: number;
    discounts: number;
    voidCount: number;
    cashVariance: number;
  },
): Promise<void> {
  const [
    shortageThreshold,
    surplusThreshold,
    maxVoidsPerShift,
    maxDiscountPct,
  ] = await Promise.all([
    readNumericSetting(
      tx,
      SETTING_KEYS.ALERT_CASH_SHORTAGE_THRESHOLD,
      ALERT_THRESHOLD_DEFAULTS.CASH_SHORTAGE,
    ),
    readNumericSetting(
      tx,
      SETTING_KEYS.ALERT_CASH_SURPLUS_THRESHOLD,
      ALERT_THRESHOLD_DEFAULTS.CASH_SURPLUS,
    ),
    readNumericSetting(
      tx,
      SETTING_KEYS.ALERT_MAX_VOIDS_PER_SHIFT,
      ALERT_THRESHOLD_DEFAULTS.MAX_VOIDS_PER_SHIFT,
    ),
    readNumericSetting(
      tx,
      SETTING_KEYS.ALERT_MAX_DISCOUNT_PCT,
      ALERT_THRESHOLD_DEFAULTS.MAX_DISCOUNT_PCT,
    ),
  ]);

  const rows: Prisma.AlertCreateManyInput[] = [];

  // Cash shortage (variance is negative when actual < expected).
  if (totals.cashVariance < 0 && Math.abs(totals.cashVariance) > shortageThreshold) {
    const severity =
      Math.abs(totals.cashVariance) > 5000 ? AlertSeverity.CRITICAL : AlertSeverity.HIGH;
    rows.push({
      type: AlertType.CASH_SHORTAGE,
      severity,
      message: `Cash shortage of ${formatMoney(Math.abs(totals.cashVariance))} in ${userName}'s shift`,
      data: {
        variance: totals.cashVariance,
        threshold: shortageThreshold,
      } as Prisma.InputJsonValue,
      user_id: userId,
      shift_report_id: shiftReportId,
    });
  }

  // Cash surplus (variance is positive when actual > expected).
  if (totals.cashVariance > 0 && totals.cashVariance > surplusThreshold) {
    rows.push({
      type: AlertType.CASH_SURPLUS,
      severity: AlertSeverity.MEDIUM,
      message: `Cash surplus of ${formatMoney(totals.cashVariance)} in ${userName}'s shift`,
      data: {
        variance: totals.cashVariance,
        threshold: surplusThreshold,
      } as Prisma.InputJsonValue,
      user_id: userId,
      shift_report_id: shiftReportId,
    });
  }

  // Excessive voids — strict inequality matches the spec's "> threshold".
  if (totals.voidCount > maxVoidsPerShift) {
    rows.push({
      type: AlertType.EXCESSIVE_VOIDS,
      severity: AlertSeverity.HIGH,
      message: `${totals.voidCount} voided orders in ${userName}'s shift (limit: ${maxVoidsPerShift})`,
      data: {
        void_count: totals.voidCount,
        threshold: maxVoidsPerShift,
      } as Prisma.InputJsonValue,
      user_id: userId,
      shift_report_id: shiftReportId,
    });
  }

  // Excessive discounts — percent of gross. Skip when gross is 0 to avoid a
  // divide-by-zero and a noise alert on a shift that processed zero sales.
  if (totals.grossSales > 0) {
    const discountPct = (totals.discounts / totals.grossSales) * 100;
    if (discountPct > maxDiscountPct) {
      rows.push({
        type: AlertType.EXCESSIVE_DISCOUNTS,
        severity: AlertSeverity.MEDIUM,
        message: `Discounts at ${discountPct.toFixed(1)}% of gross in ${userName}'s shift (limit: ${maxDiscountPct}%)`,
        data: {
          discount_pct: discountPct,
          discounts: totals.discounts,
          gross_sales: totals.grossSales,
          threshold: maxDiscountPct,
        } as Prisma.InputJsonValue,
        user_id: userId,
        shift_report_id: shiftReportId,
      });
    }
  }

  if (rows.length > 0) {
    await tx.alert.createMany({ data: rows });
  }
}

export async function listShiftReports(query: ListShiftReportQuery) {
  const where: Prisma.ShiftReportWhereInput = {
    ...(query.user_id ? { user_id: query.user_id } : {}),
    ...(query.from || query.to
      ? {
          closed_at: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.shiftReport.findMany({
    where,
    orderBy: [{ closed_at: 'desc' }, { id: 'asc' }],
    include: shiftReportInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getShiftReport(id: string) {
  const row = await prisma.shiftReport.findUnique({
    where: { id },
    include: shiftReportInclude,
  });
  if (!row) throw new NotFoundError('ShiftReport');
  return row;
}

// ─── Printable HTML (REPORTS-SPEC §5.5) ──────────────────────────────────

interface ShiftProductRow {
  product_id: string;
  product_name: string;
  quantity: number;
  total: number;
}

function readShiftProducts(value: unknown): ShiftProductRow[] {
  if (!Array.isArray(value)) return [];
  return value as ShiftProductRow[];
}

/**
 * Mid-shift handoff report (REPORTS-SPEC §5.5). Replaces the WhatsApp
 * message a cashier used to send at shift change. Simpler than the daily
 * report: cash formula + sales + payments + top 5 + alerts. No
 * denomination breakdown — that's a day-close-only
 * concern. No verification/signature box — the manager doesn't sign per
 * shift, only at end of day.
 *
 * Reads language and currency from current Settings rather than a snapshot
 * because shift reports get printed seconds after the shift closes; there's
 * no risk of language drift in that window.
 */
export async function renderShiftReportHtml(id: string): Promise<string> {
  const report = await getShiftReport(id);

  // Same setting bundle as renderDailyReportHtml: language/currency live in
  // current settings (no per-shift snapshot — shift reports are printed
  // seconds after close), plus the four template-override knobs and section-
  // visibility flags from the admin's Report-template editor. The "shifts"
  // flag is omitted because per-shift reports don't render a shifts roll-up.
  const [
    businessName,
    businessAddress,
    languageRaw,
    currencyRaw,
    customCss,
    customHeaderHtml,
    customFooterHtml,
    showCash,
    showSales,
    showPayments,
    showProducts,
    showAlerts,
    showVerification,
  ] = await Promise.all([
    getSetting(SETTING_KEYS.BUSINESS_NAME),
    getSetting(SETTING_KEYS.BUSINESS_ADDRESS),
    getSetting(SETTING_KEYS.LANGUAGE),
    getSetting(SETTING_KEYS.CURRENCY),
    getSetting(SETTING_KEYS.REPORT_CUSTOM_CSS),
    getSetting(SETTING_KEYS.REPORT_CUSTOM_HEADER_HTML),
    getSetting(SETTING_KEYS.REPORT_CUSTOM_FOOTER_HTML),
    getSetting(SETTING_KEYS.REPORT_SHOW_CASH),
    getSetting(SETTING_KEYS.REPORT_SHOW_SALES),
    getSetting(SETTING_KEYS.REPORT_SHOW_PAYMENTS),
    getSetting(SETTING_KEYS.REPORT_SHOW_PRODUCTS),
    getSetting(SETTING_KEYS.REPORT_SHOW_ALERTS),
    getSetting(SETTING_KEYS.REPORT_SHOW_VERIFICATION),
  ]);

  const overrides = resolveReportOverrides((key) => {
    switch (key) {
      case 'report_custom_css': return customCss;
      case 'report_custom_header_html': return customHeaderHtml;
      case 'report_custom_footer_html': return customFooterHtml;
      case 'report_show_cash': return showCash;
      case 'report_show_sales': return showSales;
      case 'report_show_payments': return showPayments;
      case 'report_show_products': return showProducts;
      case 'report_show_alerts': return showAlerts;
      case 'report_show_verification': return showVerification;
      // The shifts flag doesn't apply to the per-shift report — there's no
      // shifts roll-up section to hide.
      default: return null;
    }
  });

  const language: LanguageCode = (LANGUAGE_VALUES as readonly string[]).includes(languageRaw ?? '')
    ? (languageRaw as LanguageCode)
    : LANGUAGE_DEFAULT;
  const currency: CurrencyCode = (CURRENCY_VALUES as readonly string[]).includes(currencyRaw ?? '')
    ? (currencyRaw as CurrencyCode)
    : CURRENCY_DEFAULT;

  const labels = getReportLabels(language);
  const fmt = currencyFormatter(language, currency);
  const fmtSigned = signedFormatter((n) => fmt(n));

  const bizName = (businessName ?? '').trim() || 'Cafe POS';
  const bizAddr = (businessAddress ?? '').trim();
  const status = varianceStatus(report.cash_variance, labels);

  // Custom header replaces the default outright when provided. Same trust
  // model as the daily renderer — only ADMINs can write `report_*` keys.
  const headerHtml = overrides.customHeaderHtml ?? `<header class="hdr">
    <div class="hdr-left">
      <div class="biz">${escapeHtml(bizName)}</div>
      ${bizAddr ? `<div class="biz-sub">${escapeHtml(bizAddr)}</div>` : ''}
    </div>
    <div class="hdr-right">
      <div class="folio">${escapeHtml(labels.shiftReportTitle)}</div>
      <div class="date">${escapeHtml(longDate(report.closed_at, language))}</div>
    </div>
  </header>`;

  // Cashier identity + open/close times — single banner line above the cash
  // formula.
  const subHeader = `<div class="sub-header">
    <span><strong>${escapeHtml(report.user_name)}</strong></span>
    <span>${escapeHtml(labels.opened)} ${escapeHtml(timeUtc(report.opened_at))} · ${escapeHtml(labels.closed)} ${escapeHtml(timeUtc(report.closed_at))}</span>
  </div>`;

  // Cash reconciliation formula. Same suppress-zeroes treatment as the
  // daily report. Always finishes with the variance + status arrow trio.
  const cashLines: string[] = [];
  cashLines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.fund)}</span>
    <span class="num">${escapeHtml(fmt(report.opening_amount))}</span>
  </div>`);
  if (report.cash_sales > 0) {
    cashLines.push(`<div class="check-row">
      <span class="check">[ ]</span>
      <span>+ ${escapeHtml(labels.cashSalesLine)}</span>
      <span class="num">${escapeHtml(fmt(report.cash_sales))}</span>
    </div>`);
  }
  if (report.cash_in > 0) {
    cashLines.push(`<div class="check-row">
      <span class="check">[ ]</span>
      <span>+ ${escapeHtml(labels.cashIn)}</span>
      <span class="num">${escapeHtml(fmt(report.cash_in))}</span>
    </div>`);
  }
  if (report.cash_out > 0) {
    cashLines.push(`<div class="check-row">
      <span class="check">[ ]</span>
      <span>− ${escapeHtml(labels.cashOut)}</span>
      <span class="num">${escapeHtml(fmt(-report.cash_out))}</span>
    </div>`);
  }
  cashLines.push(`<div class="check-row total-line">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.totalCounted.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmt(report.actual_cash))}</span>
  </div>`);
  cashLines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.expected.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmt(report.expected_cash))}</span>
  </div>`);
  cashLines.push(`<div class="check-row">
    <span></span>
    <span>${escapeHtml(labels.difference.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmtSigned(report.cash_variance))}</span>
  </div>`);
  cashLines.push(`<div class="diff-status ${status.cls}">${escapeHtml(status.label)}</div>`);
  const cashHtml = overrides.visibility.cash
    ? `<section><h2>${escapeHtml(labels.cashInDrawer)}</h2>${cashLines.join('\n')}</section>`
    : '';

  // Sales (gross/net/tax + tickets) — discounts only when present.
  const salesLines: string[] = [];
  salesLines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.grossSales)}</span>
    <span class="num">${escapeHtml(fmt(report.gross_sales))}</span>
  </div>`);
  if (report.discounts > 0) {
    salesLines.push(`<div class="check-row">
      <span></span>
      <span>${escapeHtml(labels.discounts)}</span>
      <span class="num">${escapeHtml(fmt(-report.discounts))}</span>
    </div>`);
  }
  salesLines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.netSales)}</span>
    <span class="num">${escapeHtml(fmt(report.net_sales))}</span>
  </div>`);
  salesLines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.tax)}</span>
    <span class="num">${escapeHtml(fmt(report.tax_collected))}</span>
  </div>`);
  salesLines.push(`<div class="check-row">
    <span></span>
    <span>${escapeHtml(report.total_tickets)} ${escapeHtml(labels.tickets)} · ${escapeHtml(labels.avg)} ${escapeHtml(fmt(report.avg_ticket))}</span>
    <span></span>
  </div>`);
  const salesHtml = overrides.visibility.sales
    ? `<section><h2>${escapeHtml(labels.sales)}</h2>${salesLines.join('\n')}</section>`
    : '';

  // Payments — only render the section when at least one method has > 0
  // and the operator hasn't hidden it from the editor.
  const payRows: Array<[string, number]> = [
    [labels.cash, report.cash_sales],
    [labels.card, report.card_sales],
    [labels.transfer, report.transfer_sales],
  ];
  const payLines = payRows
    .filter(([, amount]) => amount > 0)
    .map(([label, amount]) => `<div class="check-row">
      <span class="check">[ ]</span>
      <span>${escapeHtml(label)}</span>
      <span class="num">${escapeHtml(fmt(amount))}</span>
    </div>`);
  const paymentsHtml = overrides.visibility.payments && payLines.length > 0
    ? `<section><h2>${escapeHtml(labels.paymentMethods)}</h2>${payLines.join('\n')}</section>`
    : '';

  // Top 5 products. No bottom products, no categories — keeps the report
  // short enough to fit half a page after a busy shift.
  const topProducts = readShiftProducts(report.top_products).slice(0, 5);
  const topRows = topProducts.map((p) => `<div class="prod-row">
    <span>${escapeHtml(p.product_name)}</span>
    <span class="num">${escapeHtml(p.quantity)}</span>
    <span class="num">${escapeHtml(fmt(p.total))}</span>
  </div>`).join('');
  const productsHtml = overrides.visibility.products && topProducts.length > 0
    ? `<section><h2>${escapeHtml(labels.topProducts)}</h2>${topRows}</section>`
    : '';

  // Alerts attached to this shift. Suppress the section entirely when none.
  const alertRows = sortAlertsForPrint(report.alerts);
  const alertsHtml = overrides.visibility.alerts && alertRows.length > 0
    ? `<section><h2>${escapeHtml(labels.alerts)}</h2>${alertRows.map((a) => {
        const resolved = a.resolved
          ? `<span class="alert-resolved"> — ${escapeHtml(labels.resolved)}${a.resolution ? `: ${escapeHtml(a.resolution)}` : ''}</span>`
          : '';
        return `<div class="alert-row">${escapeHtml(a.message)}${resolved}</div>`;
      }).join('\n')}</section>`
    : '';

  const closedDate = `${shortDate(report.closed_at, language)} ${timeUtc(report.closed_at)}`;
  const footerHtml = overrides.customFooterHtml ?? `<footer class="ftr">
    <div>${escapeHtml(labels.closedBy)} ${escapeHtml(report.user_name)} · ${escapeHtml(closedDate)}</div>
  </footer>`;

  const body = [
    renderToolbar(labels),
    headerHtml,
    subHeader,
    cashHtml,
    salesHtml,
    paymentsHtml,
    productsHtml,
    alertsHtml,
    footerHtml,
  ].filter(Boolean).join('\n');

  return wrapHtmlPage(body, language, overrides.customCss);
}
