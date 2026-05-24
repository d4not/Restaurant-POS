import type { ReactNode } from 'react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Button, Card, EmptyState, KPICard, Table } from '../../components/ui';
import type { BadgeTone, TableColumn } from '../../components/ui';
import { useDailyReport } from '../../hooks/useDailyReports';
import {
  fetchDailyReportPrintHtml,
  type Alert,
  type AlertSeverity,
  type DailyReportShift,
} from '../../api/daily-reports';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';

interface CategoryRow {
  category_id: string | null;
  category_name: string;
  item_count: number;
  total: number;
}
interface ProductRow {
  product_id: string;
  product_name: string;
  quantity: number;
  total: number;
}
interface HourRow {
  hour: number;
  tickets: number;
  total: number;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

function severityTone(severity: AlertSeverity): BadgeTone {
  switch (severity) {
    case 'CRITICAL': return 'red';
    case 'HIGH':     return 'red';
    case 'MEDIUM':   return 'gold';
    case 'LOW':      return 'gray';
  }
}

function alertTypeLabel(type: string): string {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function DailyReportDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const reportQ = useDailyReport(id);
  const report = reportQ.data;

  const [printing, setPrinting] = useState(false);
  const [printError, setPrintError] = useState<string | null>(null);
  const [hourlyView, setHourlyView] = useState<'chart' | 'table'>('chart');
  const [categoriesView, setCategoriesView] = useState<'chart' | 'table'>('chart');

  const handlePrint = async () => {
    if (!id) return;
    setPrinting(true);
    setPrintError(null);
    try {
      // Open the popup BEFORE the await — browsers only permit window.open()
      // synchronously inside a user gesture (the click). Opening it after the
      // fetch resolves trips the pop-up blocker.
      //
      // No `noopener` here on purpose: that flag returns null (or strips the
      // window reference) so we can't write into the new document. We're
      // writing trusted HTML from our own backend into a same-origin blank
      // window, so the standard concern doesn't apply.
      const w = window.open('', '_blank');
      if (!w) {
        setPrinting(false);
        setPrintError('Pop-up blocked. Allow pop-ups for this site to print the report.');
        return;
      }
      try {
        const html = await fetchDailyReportPrintHtml(id);
        w.document.open();
        w.document.write(html);
        w.document.close();
      } catch (err) {
        w.close();
        throw err;
      }
    } catch (err) {
      setPrintError((err as Error).message ?? 'Failed to load report');
    } finally {
      setPrinting(false);
    }
  };

  if (reportQ.isLoading) {
    return (
      <Card>
        <div className="loading-block">
          <span className="spinner" />
          Loading report…
        </div>
      </Card>
    );
  }
  if (!report) {
    return (
      <Card>
        <div className="empty-state">
          <div className="icon">⚠</div>
          <div className="msg">Daily report not found</div>
          {reportQ.error && (
            <div className="sub">{(reportQ.error as Error).message}</div>
          )}
        </div>
      </Card>
    );
  }

  const categories = readArray<CategoryRow>(report.sales_by_category);
  const topProducts = readArray<ProductRow>(report.top_products).slice(0, 5);
  const bottomProducts = readArray<ProductRow>(report.bottom_products).slice(0, 5);
  const hourly = readArray<HourRow>(report.sales_by_hour);

  const variance = report.total_cash_variance;
  const varianceColor: 'green' | 'red' | 'default' =
    variance == null || variance === 0 ? 'default' : variance > 0 ? 'green' : 'red';

  const shiftAlerts = report.shifts.flatMap((s) =>
    (s.shift_report?.alerts ?? []).map((a) => ({ scope: s.user?.name ?? '—', alert: a })),
  );
  const allAlerts = [
    ...report.alerts.map((a) => ({ scope: 'Day', alert: a })),
    ...shiftAlerts,
  ];

  /* ── Tables ───────────────────────────────────────────── */

  const shiftColumns: TableColumn<DailyReportShift>[] = [
    {
      key: 'user',
      header: 'User',
      width: '1.4fr',
      render: (s) => {
        const sr = s.shift_report;
        const wasProvisional = sr?.was_provisional;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span className="fw-600 fs-13">{s.user?.name ?? '—'}</span>
              {wasProvisional && <Badge tone="gold">Provisional</Badge>}
            </span>
            {wasProvisional && sr?.provisional_verified_by_name && (
              <span className="fs-11 text-muted">
                Verified by {sr.provisional_verified_by_name}
                {sr.provisional_verified_at
                  ? ` · ${formatDateTime(sr.provisional_verified_at)}`
                  : ''}
              </span>
            )}
          </div>
        );
      },
    },
    {
      key: 'opened',
      header: 'Opened',
      width: '170px',
      render: (s) => (
        <span className="fs-12 text-muted">{formatDateTime(s.opened_at)}</span>
      ),
    },
    {
      key: 'closed',
      header: 'Closed',
      width: '170px',
      render: (s) =>
        s.closed_at ? (
          <span className="fs-12 text-muted">{formatDateTime(s.closed_at)}</span>
        ) : (
          <span className="fs-12 text-muted">—</span>
        ),
    },
    {
      key: 'gross',
      header: 'Gross',
      width: '120px',
      render: (s) => (
        <span className="fs-13 fw-600">
          {formatMoney(s.shift_report?.gross_sales ?? 0)}
        </span>
      ),
    },
    {
      key: 'tickets',
      header: 'Tickets',
      width: '90px',
      render: (s) => <span className="fs-13">{s.shift_report?.total_tickets ?? 0}</span>,
    },
    {
      key: 'variance',
      header: 'Variance',
      width: '120px',
      render: (s) => {
        const v = s.shift_report?.cash_variance ?? null;
        if (v == null) return <span className="fs-12 text-muted">—</span>;
        if (v === 0) return <span className="fs-13 text-muted">{formatMoney(0)}</span>;
        const cls = v > 0 ? 'text-green' : 'text-red';
        const sign = v > 0 ? '+' : '';
        return (
          <span className={`fw-600 fs-13 ${cls}`}>
            {sign}
            {formatMoney(v)}
          </span>
        );
      },
    },
  ];

  const categoryColumns: TableColumn<CategoryRow>[] = [
    {
      key: 'name',
      header: 'Category',
      width: '1fr',
      render: (c) => <span className="fs-13">{c.category_name}</span>,
    },
    {
      key: 'items',
      header: 'Items',
      width: '90px',
      render: (c) => <span className="fs-13">{c.item_count}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '120px',
      render: (c) => (
        <span className="fw-600 fs-13">{formatMoney(c.total)}</span>
      ),
    },
  ];

  const productColumns: TableColumn<ProductRow>[] = [
    {
      key: 'name',
      header: 'Product',
      width: '1fr',
      render: (p) => <span className="fs-13">{p.product_name}</span>,
    },
    {
      key: 'qty',
      header: 'Qty',
      width: '70px',
      render: (p) => <span className="fs-13">{p.quantity}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '110px',
      render: (p) => (
        <span className="fw-600 fs-13">{formatMoney(p.total)}</span>
      ),
    },
  ];

  const hourColumns: TableColumn<HourRow>[] = [
    {
      key: 'hour',
      header: 'Hour (UTC)',
      width: '130px',
      render: (h) => {
        const peak = h.hour === report.peak_hour;
        const slow = h.hour === report.slowest_hour;
        return (
          <span className="fs-13">
            {String(h.hour).padStart(2, '0')}:00
            {peak && <Badge tone="green" style={{ marginLeft: 8 }}>PEAK</Badge>}
            {slow && <Badge tone="gray" style={{ marginLeft: 8 }}>SLOW</Badge>}
          </span>
        );
      },
    },
    {
      key: 'tickets',
      header: 'Tickets',
      width: '100px',
      render: (h) => <span className="fs-13">{h.tickets}</span>,
    },
    {
      key: 'total',
      header: 'Total',
      width: '130px',
      render: (h) => (
        <span className="fw-600 fs-13">{formatMoney(h.total)}</span>
      ),
    },
  ];

  type AlertRow = { scope: string; alert: Alert };
  const alertColumns: TableColumn<AlertRow>[] = [
    {
      key: 'severity',
      header: 'Severity',
      width: '110px',
      render: (r) => (
        <Badge tone={severityTone(r.alert.severity)}>{r.alert.severity}</Badge>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '180px',
      render: (r) => <span className="fs-13">{alertTypeLabel(r.alert.type)}</span>,
    },
    {
      key: 'scope',
      header: 'Scope',
      width: '160px',
      render: (r) => <span className="fs-12 text-muted">{r.scope}</span>,
    },
    {
      key: 'message',
      header: 'Message',
      width: '1fr',
      render: (r) => <span className="fs-13">{r.alert.message}</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (r) =>
        r.alert.resolved ? (
          <Badge tone="green">Resolved</Badge>
        ) : (
          <Badge tone="gold">Open</Badge>
        ),
    },
  ];

  return (
    <>
      <div className="flex-between mb-12">
        <Button variant="ghost" onClick={() => navigate('/cash/daily')}>
          ← Back to daily reports
        </Button>
        <div style={{ display: 'flex', gap: 8 }}>
          <Badge tone={report.status === 'CLOSED' ? 'green' : 'gold'}>
            {report.status}
          </Badge>
          <Button variant="primary" onClick={handlePrint} loading={printing}>
            Print Report
          </Button>
        </div>
      </div>

      {printError && (
        <Card className="mb-16">
          <div className="text-red fs-13">{printError}</div>
        </Card>
      )}

      <div className="kpi-grid">
        <KPICard
          accent
          label="Folio"
          value={folioLabel(report.folio)}
          sub={formatDate(report.date)}
        />
        <KPICard
          label="Gross sales"
          value={formatMoney(report.gross_sales)}
          sub={`${report.total_tickets} tickets · avg ${formatMoney(report.avg_ticket)}`}
        />
        <KPICard
          label="Net sales"
          value={formatMoney(report.net_sales)}
          sub={`Tax ${formatMoney(report.tax_collected)}`}
        />
        <KPICard
          label="Variance"
          value={
            variance == null
              ? '—'
              : `${variance > 0 ? '+' : ''}${formatMoney(variance)}`
          }
          valueColor={varianceColor === 'default' ? 'default' : varianceColor}
          sub={`${report.total_shifts} shifts`}
        />
      </div>

      <div className="section-grid-2">
        <Card title="Payment methods">
          <table className="fs-13" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <KvRow label="Cash"     value={formatMoney(report.cash_sales)} />
              <KvRow label="Card"     value={formatMoney(report.card_sales)} />
              <KvRow label="Transfer" value={formatMoney(report.transfer_sales)} />
              {report.other_sales > 0 && (
                <KvRow label="Other" value={formatMoney(report.other_sales)} />
              )}
            </tbody>
          </table>
        </Card>
        <Card title="Cash reconciliation">
          <table className="fs-13" style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              <KvRow label="Opening"    value={formatMoney(report.total_opening_amount)} />
              <KvRow label="Cash sales" value={formatMoney(report.cash_sales)} />
              <KvRow label="Cash in"    value={formatMoney(report.total_cash_in)} />
              <KvRow label="Cash out"   value={`−${formatMoney(report.total_cash_out)}`} />
              <KvRow label="Expected"   value={<span className="fw-600">{formatMoney(report.total_expected_cash)}</span>} />
              <KvRow label="Counted"    value={report.total_actual_cash == null ? '—' : formatMoney(report.total_actual_cash)} />
            </tbody>
          </table>
        </Card>
      </div>

      <Card title="Shifts" className="mt-16">
        <Table
          columns={shiftColumns}
          rows={report.shifts}
          getRowKey={(s) => s.id}
          onRowClick={(s) => navigate(`/cash/shifts/${s.id}`)}
          emptyMessage="No shifts attached to this report"
        />
      </Card>

      {report.shifts.some((s) => s.shift_report?.was_provisional) && (
        <Card
          title={
            <>
              Provisional shift cuts
              <div className="fs-12 text-muted" style={{ fontWeight: 400, marginTop: 2 }}>
                Mid-shift counts done by the cashier when the shift was opened by floor staff
              </div>
            </>
          }
          className="mt-16"
        >
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {report.shifts
              .filter((s) => s.shift_report?.was_provisional)
              .map((s) => {
                const sr = s.shift_report!;
                const diff = sr.provisional_difference ?? 0;
                const diffClass =
                  diff === 0 ? 'text-muted' : diff > 0 ? 'text-green' : 'text-red';
                const diffSign = diff > 0 ? '+' : '';
                return (
                  <div
                    key={s.id}
                    style={{
                      padding: '14px 16px',
                      borderRadius: 10,
                      border: '1px solid rgba(201,164,92,0.4)',
                      background: 'rgba(201,164,92,0.06)',
                    }}
                  >
                    <div className="flex-between" style={{ marginBottom: 8 }}>
                      <div>
                        <span className="fw-600 fs-13">
                          {s.user?.name ?? sr.user_name}
                        </span>
                        <span className="fs-11 text-muted" style={{ marginLeft: 8 }}>
                          {sr.provisional_opened_by_role ?? sr.user_role}
                        </span>
                      </div>
                      <Badge tone="gold">Provisional</Badge>
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(4, 1fr)',
                        gap: 16,
                        fontSize: 13,
                      }}
                    >
                      <div>
                        <div className="fs-11 text-muted" style={{ marginBottom: 2 }}>
                          Expected
                        </div>
                        <div className="fw-600">
                          {formatMoney(sr.provisional_expected_amount ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="fs-11 text-muted" style={{ marginBottom: 2 }}>
                          Counted
                        </div>
                        <div className="fw-600">
                          {formatMoney(sr.provisional_actual_amount ?? 0)}
                        </div>
                      </div>
                      <div>
                        <div className="fs-11 text-muted" style={{ marginBottom: 2 }}>
                          Difference
                        </div>
                        <div className={`fw-600 ${diffClass}`}>
                          {diff === 0
                            ? formatMoney(0)
                            : diffSign + formatMoney(diff)}
                        </div>
                      </div>
                      <div>
                        <div className="fs-11 text-muted" style={{ marginBottom: 2 }}>
                          Verified by
                        </div>
                        <div className="fs-12">
                          {sr.provisional_verified_by_name ?? '—'}
                          {sr.provisional_verified_at && (
                            <div className="fs-11 text-muted">
                              {formatDateTime(sr.provisional_verified_at)}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
          </div>
        </Card>
      )}

      <Card
        title="Sales by category"
        className="mt-16"
        actions={
          <ViewToggle value={categoriesView} onChange={setCategoriesView} />
        }
      >
        {categories.length === 0 ? (
          <EmptyState message="No category data" />
        ) : categoriesView === 'chart' ? (
          <ResponsiveContainer
            width="100%"
            height={Math.max(180, categories.length * 32)}
          >
            <BarChart
              data={[...categories].sort((a, b) => b.total - a.total)}
              layout="vertical"
              margin={{ top: 8, right: 16, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
              <XAxis
                type="number"
                stroke="var(--text3)"
                tick={{ fontSize: 11, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(v) => formatMoney(Number(v))}
              />
              <YAxis
                type="category"
                dataKey="category_name"
                stroke="var(--text3)"
                tick={{ fontSize: 12, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                width={150}
              />
              <Tooltip
                cursor={{ fill: 'var(--gold-bg)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(v, _n, item) => {
                  const items = (item?.payload as CategoryRow | undefined)?.item_count ?? 0;
                  return [`${formatMoney(Number(v))} · ${items} items`, ''];
                }}
              />
              <Bar dataKey="total" fill="var(--gold)" radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Table
            columns={categoryColumns}
            rows={categories}
            getRowKey={(c) => c.category_id ?? '__none__'}
            emptyMessage="No category data"
          />
        )}
      </Card>

      <div className="section-grid-2 mt-16">
        <Card title="Top 5 products">
          <Table
            columns={productColumns}
            rows={topProducts}
            getRowKey={(p) => `top-${p.product_id}`}
            emptyMessage="No data"
          />
        </Card>
        <Card title="Bottom 5 products">
          <Table
            columns={productColumns}
            rows={bottomProducts}
            getRowKey={(p) => `bot-${p.product_id}`}
            emptyMessage="No data"
          />
        </Card>
      </div>

      <Card
        title="Hourly breakdown"
        className="mt-16"
        actions={<ViewToggle value={hourlyView} onChange={setHourlyView} />}
      >
        {hourly.length === 0 ? (
          <EmptyState message="No hourly data" />
        ) : hourlyView === 'chart' ? (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={hourly} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="hour"
                stroke="var(--text3)"
                tick={{ fontSize: 10, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(h) => `${String(h).padStart(2, '0')}h`}
                interval={1}
              />
              <YAxis
                stroke="var(--text3)"
                tick={{ fontSize: 11, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
                tickFormatter={(v) => formatMoney(Number(v))}
                width={80}
              />
              <Tooltip
                cursor={{ fill: 'var(--gold-bg)' }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(v, _n, item) => {
                  const tickets = (item?.payload as HourRow | undefined)?.tickets ?? 0;
                  return [`${formatMoney(Number(v))} · ${tickets} tickets`, ''];
                }}
                labelFormatter={(h) => `${String(h).padStart(2, '0')}:00`}
              />
              <Bar dataKey="total" radius={[3, 3, 0, 0]}>
                {hourly.map((h) => {
                  const fill =
                    h.hour === report.peak_hour
                      ? 'var(--green)'
                      : h.hour === report.slowest_hour
                        ? 'var(--red)'
                        : 'var(--border2)';
                  return <Cell key={h.hour} fill={fill} />;
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        ) : (
          <Table
            columns={hourColumns}
            rows={hourly}
            getRowKey={(h) => `h-${h.hour}`}
            emptyMessage="No hourly data"
          />
        )}
      </Card>

      <Card title={`Alerts (${allAlerts.length})`} className="mt-16">
        <Table
          columns={alertColumns}
          rows={allAlerts}
          getRowKey={(r) => r.alert.id}
          emptyMessage="No alerts"
        />
      </Card>

      {report.notes && (
        <Card title="Manager notes" className="mt-16">
          <p className="fs-13" style={{ whiteSpace: 'pre-wrap' }}>{report.notes}</p>
        </Card>
      )}

      <p className="fs-12 text-muted mt-16">
        {report.closed_at
          ? `Closed at ${formatDateTime(report.closed_at)} by ${report.closed_by?.name ?? '—'}`
          : 'Not yet closed'}
      </p>
    </>
  );
}

interface KvRowProps {
  label: string;
  value: ReactNode;
}

function KvRow({ label, value }: KvRowProps) {
  return (
    <tr>
      <th
        style={{
          textAlign: 'left',
          fontWeight: 500,
          color: 'var(--text2)',
          padding: '6px 0',
          width: '60%',
        }}
      >
        {label}
      </th>
      <td style={{ textAlign: 'right', padding: '6px 0', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </td>
    </tr>
  );
}

interface ViewToggleProps {
  value: 'chart' | 'table';
  onChange: (next: 'chart' | 'table') => void;
}

function ViewToggle({ value, onChange }: ViewToggleProps) {
  return (
    <div style={{ display: 'inline-flex', gap: 4 }}>
      <button
        type="button"
        className={`filter-pill${value === 'chart' ? ' active' : ''}`}
        onClick={() => onChange('chart')}
      >
        Chart
      </button>
      <button
        type="button"
        className={`filter-pill${value === 'table' ? ' active' : ''}`}
        onClick={() => onChange('table')}
      >
        Table
      </button>
    </div>
  );
}
