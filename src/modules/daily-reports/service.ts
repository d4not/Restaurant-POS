import {
  AlertSeverity,
  AlertType,
  CashRegisterStatus,
  DailyReportStatus,
  Prisma,
  ShiftType,
} from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../../lib/errors.js';
import { buildCursorArgs, toPageResult } from '../../lib/pagination.js';
import { getDenominations, smallestBillCentavos } from '../../lib/denominations.js';
import { getSetting } from '../settings/service.js';
import {
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
  folioLabel,
  getReportLabels,
  longDate,
  renderToolbar,
  shortDate,
  signedFormatter,
  sortAlertsForPrint,
  timeUtc,
  varianceStatus,
  wrapHtmlPage,
  type ReportLabels,
} from '../print/report-html.js';
import type {
  CloseDailyReportInput,
  ListDailyReportQuery,
} from './schema.js';

type Tx = Prisma.TransactionClient;

const dailyReportInclude = {
  closed_by: { select: { id: true, name: true } },
  shifts: {
    orderBy: { closed_at: 'asc' },
    include: {
      user: { select: { id: true, name: true } },
      verified_by: { select: { id: true, name: true } },
      shift_report: {
        include: {
          alerts: { orderBy: { created_at: 'asc' } },
        },
      },
    },
  },
  alerts: { orderBy: { created_at: 'asc' } },
} satisfies Prisma.DailyReportInclude;

/**
 * Truncate a Date to midnight UTC. DailyReport.date is a DATE column with a
 * uniqueness constraint, and ShiftReport.closed_at is a DateTime that we slice
 * by day for aggregation. Two close attempts on the same civil day must
 * produce the same key — same pattern as todayUtc() in orders/service.ts.
 */
function todayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

interface CategoryRollup {
  category_id: string | null;
  category_name: string;
  item_count: number;
  total: number;
}

interface ProductRollup {
  product_id: string;
  product_name: string;
  quantity: number;
  total: number;
}

interface HourlyRollup {
  hour: number;
  tickets: number;
  total: number;
}

/**
 * Sum a JSON column across reports by the given key. ShiftReport.sales_by_category
 * and top_products are stored as JSON because their shape is report-specific;
 * the aggregation here mirrors the per-shift rollup but folds across multiple
 * reports.
 */
function mergeCategoryRollups(reports: Array<{ sales_by_category: unknown }>): CategoryRollup[] {
  const map = new Map<
    string,
    { category_id: string | null; category_name: string; item_count: number; total: number }
  >();
  for (const report of reports) {
    const rows = (report.sales_by_category ?? []) as CategoryRollup[];
    for (const row of rows) {
      const key = row.category_id ?? '__no_category__';
      const existing = map.get(key);
      if (existing) {
        existing.item_count += row.item_count;
        existing.total += row.total;
      } else {
        map.set(key, {
          category_id: row.category_id,
          category_name: row.category_name,
          item_count: row.item_count,
          total: row.total,
        });
      }
    }
  }
  return [...map.values()].sort((a, b) => b.total - a.total);
}

function mergeProductRollups(
  reports: Array<{ top_products: unknown }>,
): ProductRollup[] {
  const map = new Map<string, ProductRollup>();
  for (const report of reports) {
    const rows = (report.top_products ?? []) as ProductRollup[];
    for (const row of rows) {
      const existing = map.get(row.product_id);
      if (existing) {
        existing.quantity += row.quantity;
        existing.total += row.total;
      } else {
        map.set(row.product_id, { ...row });
      }
    }
  }
  return [...map.values()].sort(
    (a, b) => (b.quantity - a.quantity) || (b.total - a.total),
  );
}

interface HourBucket {
  hour: number;
  tickets: bigint | number | string;
  total: bigint | number | string;
}

/**
 * Per-hour ticket and revenue counts for a given UTC day. We query directly
 * because ShiftReports don't carry hourly buckets — that detail only matters
 * at the day-close roll-up. Excludes voided lines via the order's CANCELLED
 * status filter (the items themselves stay attached to a CANCELLED order, not
 * counted in totals).
 */
async function loadHourlyBuckets(
  tx: Tx,
  dayStart: Date,
  dayEnd: Date,
): Promise<HourlyRollup[]> {
  const rows = await tx.$queryRaw<HourBucket[]>`
    SELECT
      EXTRACT(HOUR FROM created_at AT TIME ZONE 'UTC')::int AS hour,
      COUNT(*)::bigint AS tickets,
      COALESCE(SUM(total), 0)::bigint AS total
    FROM orders
    WHERE status = 'PAID'
      AND created_at >= ${dayStart}
      AND created_at < ${dayEnd}
    GROUP BY hour
    ORDER BY hour ASC
  `;
  return rows.map((r) => ({
    hour: Number(r.hour),
    tickets: Number(r.tickets),
    total: Number(r.total),
  }));
}

/**
 * Generate alerts for a closing day. Currently only one rule lands here:
 * UNVERIFIED_PROVISIONAL — any provisional shift that closed without a
 * manager+ signing off is a CRITICAL audit gap. Shift-level alerts (cash
 * shortage, voids, etc.) live on ShiftReport, not DailyReport.
 */
async function generateDailyAlerts(
  tx: Tx,
  dailyReportId: string,
  shifts: Array<{ id: string; type: ShiftType; verified_at: Date | null; user_id: string; user: { name: string } }>,
): Promise<void> {
  const unverified = shifts.filter(
    (s) => s.type === ShiftType.PROVISIONAL && s.verified_at === null,
  );
  if (unverified.length === 0) return;

  await tx.alert.createMany({
    data: unverified.map((s) => ({
      type: AlertType.UNVERIFIED_PROVISIONAL,
      severity: AlertSeverity.CRITICAL,
      message: `Provisional shift opened by ${s.user.name} closed without manager verification`,
      data: { shift_id: s.id, opener_user_id: s.user_id } as Prisma.InputJsonValue,
      user_id: s.user_id,
      daily_report_id: dailyReportId,
    })),
  });
}

/**
 * Close today's day and produce the consolidated DailyReport. Per
 * REPORTS-SPEC §4.2:
 *   1. No OPEN shifts may exist for today.
 *   2. Aggregate all ShiftReports closed today into one row.
 *   3. Merge JSON snapshots (categories, top products) and add bottom_products.
 *   4. Compute sales_by_hour from raw order data.
 *   5. Tally provisional shift counts.
 *   6. Link every contributing shift to this DailyReport.
 *   7. Surface UNVERIFIED_PROVISIONAL alerts.
 *
 * The unique constraint on date is the idempotency guard: closing the same
 * day twice fails at the DB level. Returns the freshly-closed report with
 * shift_reports and alerts included.
 */
export async function closeDailyReport(
  userId: string,
  input: CloseDailyReportInput,
) {
  const dayStart = todayUtc();
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

  // Snapshot currency + language from settings before opening the transaction
  // so a setting change mid-close doesn't race the inserted row. Falls back
  // to the spec defaults when missing or when the stored value isn't one of
  // the supported codes.
  const [currencyRaw, languageRaw] = await Promise.all([
    getSetting(SETTING_KEYS.CURRENCY),
    getSetting(SETTING_KEYS.LANGUAGE),
  ]);
  const currency: CurrencyCode = (CURRENCY_VALUES as readonly string[]).includes(currencyRaw ?? '')
    ? (currencyRaw as CurrencyCode)
    : CURRENCY_DEFAULT;
  const language: LanguageCode = (LANGUAGE_VALUES as readonly string[]).includes(languageRaw ?? '')
    ? (languageRaw as LanguageCode)
    : LANGUAGE_DEFAULT;

  // Validate the optional bills/coins breakdown up-front (cheap, no I/O).
  // Keys must be valid denominations for the active currency, and the sum
  // of (denom × count) must match input.actual_cash when both are provided.
  if (input.denomination_breakdown) {
    const allowed = new Set(getDenominations(currency).map((d) => String(d)));
    for (const key of Object.keys(input.denomination_breakdown)) {
      if (!allowed.has(key)) {
        throw new BadRequestError(
          `Invalid denomination "${key}" for currency ${currency}`,
        );
      }
    }
    if (input.actual_cash !== undefined) {
      const denomSum = Object.entries(input.denomination_breakdown).reduce(
        (acc, [denom, count]) => acc + Number(denom) * count,
        0,
      );
      if (denomSum !== input.actual_cash) {
        throw new BadRequestError(
          'Denomination total does not match counted cash',
        );
      }
    }
  }

  return prisma.$transaction(async (tx) => {
    // Singleton-shift invariant aside, multiple shifts could theoretically
    // span a day. Refuse if any one is still OPEN — the report would be
    // incomplete and would need re-running.
    const openShifts = await tx.cashRegister.count({
      where: {
        status: CashRegisterStatus.OPEN,
        opened_at: { gte: dayStart, lt: dayEnd },
      },
    });
    if (openShifts > 0) {
      throw new ConflictError(
        `Cannot close daily report — ${openShifts} shift(s) are still open today`,
      );
    }

    // ShiftReports closed inside today's window. closed_at is the moment the
    // shift was closed (not the day it opened) — a graveyard shift that opens
    // 23:30 and closes 03:00 next day rolls into the *next* day's report,
    // which matches operator intuition.
    const shiftReports = await tx.shiftReport.findMany({
      where: {
        closed_at: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { closed_at: 'asc' },
    });
    if (shiftReports.length === 0) {
      throw new BadRequestError('No shifts closed today');
    }

    // Pull the underlying registers in one shot so we can both link them and
    // compute provisional/unverified counts without re-fetching.
    const cashRegisters = await tx.cashRegister.findMany({
      where: {
        id: { in: shiftReports.map((r) => r.cash_register_id) },
      },
      select: {
        id: true,
        type: true,
        verified_at: true,
        user_id: true,
        user: { select: { name: true } },
      },
    });

    // ---- Aggregate numeric totals -------------------------------------------
    let gross_sales = 0;
    let discounts = 0;
    let comps = 0;
    let void_total = 0;
    let void_count = 0;
    let net_sales = 0;
    let tax_collected = 0;
    let total_tickets = 0;
    let cash_sales = 0;
    let card_sales = 0;
    let transfer_sales = 0;
    let other_sales = 0;
    let total_opening_amount = 0;
    let total_cash_in = 0;
    let total_cash_out = 0;
    let total_expected_cash = 0;
    let actualCashKnown = false;
    let total_actual_cash = 0;
    let varianceKnown = false;
    let total_cash_variance = 0;

    for (const r of shiftReports) {
      gross_sales += r.gross_sales;
      discounts += r.discounts;
      comps += r.comps;
      void_total += r.void_total;
      void_count += r.void_count;
      net_sales += r.net_sales;
      tax_collected += r.tax_collected;
      total_tickets += r.total_tickets;
      cash_sales += r.cash_sales;
      card_sales += r.card_sales;
      transfer_sales += r.transfer_sales;
      other_sales += r.other_sales;
      total_opening_amount += r.opening_amount;
      total_cash_in += r.cash_in;
      total_cash_out += r.cash_out;
      total_expected_cash += r.expected_cash;
      if (r.actual_cash !== null) {
        actualCashKnown = true;
        total_actual_cash += r.actual_cash;
      }
      if (r.cash_variance !== null) {
        varianceKnown = true;
        total_cash_variance += r.cash_variance;
      }
    }

    // avg_ticket is gross / tickets, integer-rounded down to keep it within
    // the Int column. Matches ShiftReport.avg_ticket semantics.
    const avg_ticket = total_tickets > 0 ? Math.round(gross_sales / total_tickets) : 0;

    // ---- Merge JSON snapshots -----------------------------------------------
    const mergedCategories = mergeCategoryRollups(shiftReports);
    const mergedProducts = mergeProductRollups(shiftReports);
    const top_products = mergedProducts.slice(0, 10);
    // Bottom 5 by quantity ascending — slowest-moving items. Computed off the
    // merged product list so a product that sold poorly in two shifts is
    // ranked correctly. Tiebreaker is total ascending so the genuinely lowest
    // revenue surfaces first.
    const bottom_products = [...mergedProducts]
      .sort((a, b) => (a.quantity - b.quantity) || (a.total - b.total))
      .slice(0, 5);

    // ---- Hourly buckets -----------------------------------------------------
    const sales_by_hour = await loadHourlyBuckets(tx, dayStart, dayEnd);
    let peak_hour: number | null = null;
    let slowest_hour: number | null = null;
    if (sales_by_hour.length > 0) {
      let peak = sales_by_hour[0]!;
      let slow = sales_by_hour[0]!;
      for (const h of sales_by_hour) {
        if (h.total > peak.total) peak = h;
        if (h.total < slow.total) slow = h;
      }
      peak_hour = peak.hour;
      slowest_hour = slow.hour;
    }

    // ---- Shift summary counts ----------------------------------------------
    const total_shifts = shiftReports.length;
    const provisionalRegisters = cashRegisters.filter((r) => r.type === ShiftType.PROVISIONAL);
    const provisional_shifts = provisionalRegisters.length;
    const unverified_provisionals = provisionalRegisters.filter((r) => r.verified_at === null).length;

    // ---- Manager-counted cash override --------------------------------------
    // When the manager submits an actual_cash value at close time, it
    // overrides the sum of per-shift counts and the variance is recomputed
    // against total_expected_cash. Otherwise we fall back to the per-shift
    // aggregate (the legacy behaviour from before §5 landed).
    const finalActualCash = input.actual_cash !== undefined
      ? input.actual_cash
      : (actualCashKnown ? total_actual_cash : null);
    const finalVariance = finalActualCash !== null
      ? finalActualCash - total_expected_cash
      : (varianceKnown ? total_cash_variance : null);

    // ---- Persist ------------------------------------------------------------
    // The unique constraint on date is what enforces "one per day" — a second
    // close attempt for the same date raises a P2002 from Prisma which the
    // global error handler maps to 409.
    const dailyReport = await tx.dailyReport.create({
      data: {
        date: dayStart,
        status: DailyReportStatus.CLOSED,
        gross_sales,
        discounts,
        comps,
        void_total,
        void_count,
        net_sales,
        tax_collected,
        total_tickets,
        avg_ticket,
        cash_sales,
        card_sales,
        transfer_sales,
        other_sales,
        total_opening_amount,
        total_cash_in,
        total_cash_out,
        total_expected_cash,
        total_actual_cash: finalActualCash,
        total_cash_variance: finalVariance,
        sales_by_category: mergedCategories as unknown as Prisma.InputJsonValue,
        top_products: top_products as unknown as Prisma.InputJsonValue,
        bottom_products: bottom_products as unknown as Prisma.InputJsonValue,
        sales_by_hour: sales_by_hour as unknown as Prisma.InputJsonValue,
        total_shifts,
        provisional_shifts,
        unverified_provisionals,
        peak_hour,
        slowest_hour,
        currency,
        language,
        denomination_breakdown:
          (input.denomination_breakdown as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
        closed_by_id: userId,
        closed_at: new Date(),
        notes: input.notes,
        resolution: input.resolution,
      },
    });

    // Link every contributing shift to this report. Done after create so the
    // FK target exists. updateMany is fine — order doesn't matter and we don't
    // need per-row results.
    await tx.cashRegister.updateMany({
      where: { id: { in: cashRegisters.map((r) => r.id) } },
      data: { daily_report_id: dailyReport.id },
    });

    await generateDailyAlerts(tx, dailyReport.id, cashRegisters);

    return tx.dailyReport.findUniqueOrThrow({
      where: { id: dailyReport.id },
      include: dailyReportInclude,
    });
  });
}

export async function listDailyReports(query: ListDailyReportQuery) {
  const where: Prisma.DailyReportWhereInput = {
    ...(query.status ? { status: query.status } : {}),
    ...(query.from || query.to
      ? {
          date: {
            ...(query.from ? { gte: query.from } : {}),
            ...(query.to ? { lte: query.to } : {}),
          },
        }
      : {}),
  };
  const rows = await prisma.dailyReport.findMany({
    where,
    orderBy: [{ date: 'desc' }, { id: 'asc' }],
    include: dailyReportInclude,
    ...buildCursorArgs(query),
  });
  return toPageResult(rows, query.limit);
}

export async function getDailyReport(id: string) {
  const row = await prisma.dailyReport.findUnique({
    where: { id },
    include: dailyReportInclude,
  });
  if (!row) throw new NotFoundError('DailyReport');
  return row;
}

// ─── Printable HTML (REPORTS-SPEC §5.2) ──────────────────────────────────

interface CategoryRow { category_id: string | null; category_name: string; item_count: number; total: number }
interface ProductRow { product_id: string; product_name: string; quantity: number; total: number }

function readJsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  return [];
}

/**
 * Coerce the JSON denomination_breakdown column into a typed map. Filters
 * counts <= 0 because the printout suppresses zero rows. The keys come back
 * as string keys per the JSON contract; we keep them stringly until the
 * caller decides whether to render them as numbers or look up subtotals.
 */
function readDenomBreakdown(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) out[k] = n;
  }
  return out;
}

/**
 * Build the cash-in-drawer section. Two render modes:
 *
 *  1. Denomination breakdown provided — render bills then coins with a [ ]
 *     checkbox per row. The grouping threshold (smallestBillCentavos) is per
 *     currency: $20+ MXN goes under "Bills"; under that under "Coins".
 *  2. No breakdown — render the reconciliation formula
 *     (opening + cash sales + cash in − cash out = expected) with the same
 *     [ ] checklist treatment.
 *
 * Both modes terminate in the same TOTAL CONTADO / DEBE HABER / DIFERENCIA
 * trio so the parent counting cash always sees the same verdict line.
 */
function renderCashSection(
  report: { total_opening_amount: number; cash_sales: number; total_cash_in: number;
            total_cash_out: number; total_expected_cash: number;
            total_actual_cash: number | null; total_cash_variance: number | null;
            denomination_breakdown: unknown; currency: string },
  labels: ReportLabels,
  fmt: (n: number | null | undefined) => string,
  fmtSigned: (n: number | null | undefined) => string,
): string {
  const breakdown = readDenomBreakdown(report.denomination_breakdown);
  const hasBreakdown = Object.keys(breakdown).length > 0;
  const status = varianceStatus(report.total_cash_variance, labels);
  const lines: string[] = [];

  if (hasBreakdown) {
    const denoms = getDenominations(report.currency);
    const billThreshold = smallestBillCentavos(report.currency);
    const billDenoms = denoms.filter((d) => d >= billThreshold && breakdown[String(d)]);
    const coinDenoms = denoms.filter((d) => d < billThreshold && breakdown[String(d)]);

    const renderRow = (denom: number, count: number) => {
      const subtotal = denom * count;
      return `<div class="denom-row">
        <span class="denom-checkbox">[ ]</span>
        <span class="num">${count}</span>
        <span>×</span>
        <span class="num">${escapeHtml(fmt(denom))}</span>
        <span class="dots"></span>
        <span class="num">${escapeHtml(fmt(subtotal))}</span>
      </div>`;
    };

    if (billDenoms.length > 0) {
      lines.push(`<div class="denom-group">${escapeHtml(labels.bills)}:</div>`);
      for (const d of billDenoms) lines.push(renderRow(d, breakdown[String(d)]!));
    }
    if (coinDenoms.length > 0) {
      lines.push(`<div class="denom-group">${escapeHtml(labels.coins)}:</div>`);
      for (const d of coinDenoms) lines.push(renderRow(d, breakdown[String(d)]!));
    }
  } else {
    // Reconciliation formula. Suppress zero cash_in / cash_out lines so the
    // checklist stays focused on what actually moved.
    lines.push(`<div class="check-row">
      <span class="check">[ ]</span>
      <span>${escapeHtml(labels.fund)}</span>
      <span class="num">${escapeHtml(fmt(report.total_opening_amount))}</span>
    </div>`);
    if (report.cash_sales > 0) {
      lines.push(`<div class="check-row">
        <span class="check">[ ]</span>
        <span>+ ${escapeHtml(labels.cashSalesLine)}</span>
        <span class="num">${escapeHtml(fmt(report.cash_sales))}</span>
      </div>`);
    }
    if (report.total_cash_in > 0) {
      lines.push(`<div class="check-row">
        <span class="check">[ ]</span>
        <span>+ ${escapeHtml(labels.cashIn)}</span>
        <span class="num">${escapeHtml(fmt(report.total_cash_in))}</span>
      </div>`);
    }
    if (report.total_cash_out > 0) {
      lines.push(`<div class="check-row">
        <span class="check">[ ]</span>
        <span>− ${escapeHtml(labels.cashOut)}</span>
        <span class="num">${escapeHtml(fmt(-report.total_cash_out))}</span>
      </div>`);
    }
  }

  // Verdict trio — total counted, expected, difference + status arrow.
  lines.push(`<div class="check-row total-line">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.totalCounted.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmt(report.total_actual_cash))}</span>
  </div>`);
  lines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.expected.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmt(report.total_expected_cash))}</span>
  </div>`);
  lines.push(`<div class="check-row">
    <span></span>
    <span>${escapeHtml(labels.difference.toUpperCase())}</span>
    <span class="num">${escapeHtml(fmtSigned(report.total_cash_variance))}</span>
  </div>`);
  lines.push(`<div class="diff-status ${status.cls}">${escapeHtml(status.label)}</div>`);

  return `<section><h2>${escapeHtml(labels.cashInDrawer)}</h2>${lines.join('\n')}</section>`;
}

/**
 * Sales section — gross/net/tax with a tickets summary line. Discounts
 * appear only when > 0 (suppress-zero rule from §5.3). Each load-bearing
 * line gets a checkbox so the parent can confirm against printed totals.
 */
function renderSalesSection(
  report: { gross_sales: number; discounts: number; net_sales: number;
            tax_collected: number; total_tickets: number; avg_ticket: number },
  labels: ReportLabels,
  fmt: (n: number | null | undefined) => string,
): string {
  const lines: string[] = [];
  lines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.grossSales)}</span>
    <span class="num">${escapeHtml(fmt(report.gross_sales))}</span>
  </div>`);
  if (report.discounts > 0) {
    lines.push(`<div class="check-row">
      <span></span>
      <span>${escapeHtml(labels.discounts)}</span>
      <span class="num">${escapeHtml(fmt(-report.discounts))}</span>
    </div>`);
  }
  lines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.netSales)}</span>
    <span class="num">${escapeHtml(fmt(report.net_sales))}</span>
  </div>`);
  lines.push(`<div class="check-row">
    <span class="check">[ ]</span>
    <span>${escapeHtml(labels.tax)}</span>
    <span class="num">${escapeHtml(fmt(report.tax_collected))}</span>
  </div>`);
  lines.push(`<div class="check-row">
    <span></span>
    <span>${escapeHtml(report.total_tickets)} ${escapeHtml(labels.tickets)} · ${escapeHtml(labels.avg)} ${escapeHtml(fmt(report.avg_ticket))}</span>
    <span></span>
  </div>`);
  return `<section><h2>${escapeHtml(labels.sales)}</h2>${lines.join('\n')}</section>`;
}

/**
 * Payment methods — one line per method that recorded sales > 0. Methods
 * with no activity are suppressed so the section doesn't read like a list
 * of zeros (§5.3).
 */
function renderPaymentsSection(
  report: { cash_sales: number; card_sales: number; transfer_sales: number },
  labels: ReportLabels,
  fmt: (n: number | null | undefined) => string,
): string {
  const rows: Array<[string, number]> = [
    [labels.cash, report.cash_sales],
    [labels.card, report.card_sales],
    [labels.transfer, report.transfer_sales],
  ];
  const lines = rows
    .filter(([, amount]) => amount > 0)
    .map(([label, amount]) => `<div class="check-row">
      <span class="check">[ ]</span>
      <span>${escapeHtml(label)}</span>
      <span class="num">${escapeHtml(fmt(amount))}</span>
    </div>`);
  if (lines.length === 0) return '';
  return `<section><h2>${escapeHtml(labels.paymentMethods)}</h2>${lines.join('\n')}</section>`;
}

interface ShiftRow {
  type: ShiftType;
  verified_at: Date | null;
  opened_at: Date;
  closed_at: Date | null;
  user: { id: string; name: string } | null;
  shift_report: {
    gross_sales: number;
    total_tickets: number;
    actual_cash: number | null;
    cash_variance: number | null;
  } | null;
}

/**
 * Compact per-shift block. One block per shift, each block:
 *
 *   Carlos M.        09:00–17:00     $1,425    47 tickets
 *     Contó $1,380 · Diferencia -$30.00 FALTANTE
 *     ↳ PROVISIONAL · SIN VERIFICAR        ← only when applicable
 *
 * The provisional sub-line is rendered for type=PROVISIONAL shifts. When
 * verified_at is null, "Sin verificar" is appended so the manager sees at a
 * glance which slots still need a sign-off.
 */
function renderShiftsSection(
  shifts: ShiftRow[],
  labels: ReportLabels,
  fmt: (n: number | null | undefined) => string,
  fmtSigned: (n: number | null | undefined) => string,
): string {
  if (shifts.length === 0) return '';
  const blocks = shifts.map((s) => {
    const sr = s.shift_report;
    const opened = timeUtc(s.opened_at);
    const closed = s.closed_at ? timeUtc(s.closed_at) : '—';
    const variance = sr?.cash_variance ?? null;
    const status = varianceStatus(variance, labels);
    const isProv = s.type === ShiftType.PROVISIONAL;
    const unverified = isProv && s.verified_at === null;
    const provLine = isProv
      ? `<div class="shift-prov">↳ ${escapeHtml(labels.provisional.toUpperCase())}${unverified ? ` · ${escapeHtml(labels.unverified.toUpperCase())}` : ''}</div>`
      : '';
    return `<div class="shift-block">
      <span>${escapeHtml(s.user?.name ?? '—')}</span>
      <span>${escapeHtml(opened)}–${escapeHtml(closed)}</span>
      <span class="num">${escapeHtml(fmt(sr?.gross_sales ?? null))}</span>
      <span class="num">${escapeHtml(sr?.total_tickets ?? 0)} ${escapeHtml(labels.tickets)}</span>
      <div class="shift-detail">
        ${escapeHtml(labels.countedShort)} ${escapeHtml(fmt(sr?.actual_cash ?? null))} · ${escapeHtml(labels.diffShort)} ${escapeHtml(fmtSigned(variance))} ${escapeHtml(status.label)}
      </div>
      ${provLine}
    </div>`;
  });
  return `<section><h2>${escapeHtml(labels.shifts)}</h2>${blocks.join('\n')}</section>`;
}

/**
 * Side-by-side products + categories block. Top 5 products on the left,
 * categories on the right (only those with > 0 sales). No bottom-products
 * column — the new layout drops it (§5 explicitly removes it).
 */
function renderProductsSection(
  products: ProductRow[],
  categories: CategoryRow[],
  labels: ReportLabels,
  fmt: (n: number | null | undefined) => string,
): string {
  const top = products.slice(0, 5);
  const cats = categories.filter((c) => c.total > 0);
  if (top.length === 0 && cats.length === 0) return '';

  const prodRows = top.map((p) => `<div class="prod-row">
    <span>${escapeHtml(p.product_name)}</span>
    <span class="num">${escapeHtml(p.quantity)}</span>
    <span class="num">${escapeHtml(fmt(p.total))}</span>
  </div>`).join('');
  const catRows = cats.map((c) => `<div class="cat-row">
    <span>${escapeHtml(c.category_name)}</span>
    <span class="num">${escapeHtml(c.item_count)}</span>
    <span class="num">${escapeHtml(fmt(c.total))}</span>
  </div>`).join('');

  return `<section><h2>${escapeHtml(labels.products)}</h2>
    <div class="products-grid">
      <div>
        <div class="col-title">${escapeHtml(labels.topProducts)}</div>
        ${prodRows}
      </div>
      <div>
        <div class="col-title">${escapeHtml(labels.categories)}</div>
        ${catRows}
      </div>
    </div>
  </section>`;
}

interface AlertRow {
  message: string;
  resolved: boolean;
  resolution: string | null;
  severity: AlertSeverity;
}

/**
 * Alerts section. Suppressed entirely when there are no alerts (the spec is
 * explicit: only render the heading if at least one alert exists). Resolved
 * alerts append "— Resuelto: {note}". Ordering: unresolved by severity desc,
 * resolved last.
 */
function renderAlertsSection(
  dayAlerts: AlertRow[],
  shiftAlerts: AlertRow[],
  labels: ReportLabels,
): string {
  const all = sortAlertsForPrint([...dayAlerts, ...shiftAlerts]);
  if (all.length === 0) return '';
  const rows = all.map((a) => {
    const resolved = a.resolved
      ? `<span class="alert-resolved"> — ${escapeHtml(labels.resolved)}${a.resolution ? `: ${escapeHtml(a.resolution)}` : ''}</span>`
      : '';
    return `<div class="alert-row">${escapeHtml(a.message)}${resolved}</div>`;
  });
  return `<section><h2>${escapeHtml(labels.alerts)}</h2>${rows.join('\n')}</section>`;
}

/**
 * Verification block — always printed. Holds the manager's resolution text
 * (the verdict written at close) and a pair of blank signature lines for
 * the parent to sign off after counting. Notes appear only when present.
 */
function renderVerificationSection(
  report: { resolution: string | null; notes: string | null },
  labels: ReportLabels,
): string {
  const resolution = report.resolution?.trim() ?? '';
  const notes = report.notes?.trim() ?? '';
  return `<section><h2>${escapeHtml(labels.verification)}</h2>
    <div class="verify-box">
      <div class="verify-line"><strong>${escapeHtml(labels.resolution)}:</strong> ${escapeHtml(resolution || '—')}</div>
      ${notes ? `<div class="verify-line"><strong>${escapeHtml(labels.notes)}:</strong> ${escapeHtml(notes)}</div>` : ''}
      <div class="sig-row">
        <span><strong>${escapeHtml(labels.verifiedBy)}:</strong><span class="sig-line"></span></span>
        <span><strong>${escapeHtml(labels.signature)}:</strong><span class="sig-line"></span></span>
      </div>
    </div>
  </section>`;
}

/**
 * Render the printable daily-report HTML (REPORTS-SPEC §5). Self-contained:
 * embedded CSS, no external assets, designed to fit one US-letter page when
 * the parents print it. Reads language and currency snapshots off the
 * DailyReport row so an old report keeps its labels even if settings drift.
 */
export async function renderDailyReportHtml(id: string): Promise<string> {
  const report = await getDailyReport(id);

  const language = (LANGUAGE_VALUES as readonly string[]).includes(report.language)
    ? (report.language as LanguageCode)
    : LANGUAGE_DEFAULT;
  const currency = (CURRENCY_VALUES as readonly string[]).includes(report.currency)
    ? (report.currency as CurrencyCode)
    : CURRENCY_DEFAULT;

  const [businessName, businessAddress] = await Promise.all([
    getSetting(SETTING_KEYS.BUSINESS_NAME),
    getSetting(SETTING_KEYS.BUSINESS_ADDRESS),
  ]);

  const labels = getReportLabels(language);
  const fmt = currencyFormatter(language, currency);
  const fmtSigned = signedFormatter((n) => fmt(n));

  const bizName = (businessName ?? '').trim() || 'Cafe POS';
  const bizAddr = (businessAddress ?? '').trim();

  const categories = readJsonArray<CategoryRow>(report.sales_by_category);
  const topProducts = readJsonArray<ProductRow>(report.top_products);

  const headerHtml = `<header class="hdr">
    <div class="hdr-left">
      <div class="biz">${escapeHtml(bizName)}</div>
      ${bizAddr ? `<div class="biz-sub">${escapeHtml(bizAddr)}</div>` : ''}
    </div>
    <div class="hdr-right">
      <div class="folio">${escapeHtml(labels.reportTitle)} ${escapeHtml(folioLabel(report.folio))}</div>
      <div class="date">${escapeHtml(longDate(report.date, language))}</div>
    </div>
  </header>`;

  const cashHtml = renderCashSection(
    {
      total_opening_amount: report.total_opening_amount,
      cash_sales: report.cash_sales,
      total_cash_in: report.total_cash_in,
      total_cash_out: report.total_cash_out,
      total_expected_cash: report.total_expected_cash,
      total_actual_cash: report.total_actual_cash,
      total_cash_variance: report.total_cash_variance,
      denomination_breakdown: report.denomination_breakdown,
      currency,
    },
    labels,
    fmt,
    fmtSigned,
  );
  const salesHtml = renderSalesSection(report, labels, fmt);
  const paymentsHtml = renderPaymentsSection(report, labels, fmt);
  const shiftsHtml = renderShiftsSection(report.shifts as unknown as ShiftRow[], labels, fmt, fmtSigned);
  const productsHtml = renderProductsSection(topProducts, categories, labels, fmt);

  // Combine day-level and per-shift alerts for the print roll-up.
  const dayAlerts = report.alerts.map((a) => ({
    message: a.message,
    resolved: a.resolved,
    resolution: a.resolution,
    severity: a.severity,
  }));
  const shiftAlerts = report.shifts.flatMap((s) =>
    (s.shift_report?.alerts ?? []).map((a) => ({
      message: a.message,
      resolved: a.resolved,
      resolution: a.resolution,
      severity: a.severity,
    })),
  );
  const alertsHtml = renderAlertsSection(dayAlerts, shiftAlerts, labels);
  const verifyHtml = renderVerificationSection(report, labels);

  const closedBy = report.closed_by?.name ?? '—';
  const closedDate = report.closed_at
    ? `${shortDate(report.closed_at, language)} ${timeUtc(report.closed_at)}`
    : '—';
  const footerHtml = `<footer class="ftr">${escapeHtml(labels.closedBy)} ${escapeHtml(closedBy)} · ${escapeHtml(closedDate)}</footer>`;

  const body = [
    renderToolbar(labels),
    headerHtml,
    cashHtml,
    salesHtml,
    paymentsHtml,
    shiftsHtml,
    productsHtml,
    alertsHtml,
    verifyHtml,
    footerHtml,
  ].filter(Boolean).join('\n');

  return wrapHtmlPage(body, language);
}
