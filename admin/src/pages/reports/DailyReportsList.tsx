import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Button, Card, EmptyState, KPICard } from '../../components/ui';
import { useDailyReports } from '../../hooks/useDailyReports';
import type {
  DailyReport,
  DailyReportShift,
} from '../../api/daily-reports';
import { formatDate, formatDateTime, formatMoney } from '../../utils/format';
import { useTranslation } from '../../i18n';

function folioLabel(folio: number): string {
  return `Z-${String(folio).padStart(4, '0')}`;
}

const PARENT_GRID =
  '120px 140px 110px 110px 90px 120px 120px 120px';
const CHILD_GRID =
  '24px 1.4fr 170px 170px 90px 120px 120px';

export function DailyReportsList() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const query = useDailyReports();
  const rows = useMemo<DailyReport[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  /* ── Summary across visible reports ───────────────────── */

  const summary = useMemo(() => {
    let gross = 0, net = 0, tickets = 0, varSum = 0, varCount = 0;
    let maxNet = -Infinity, bestFolio = 0;
    for (const r of rows) {
      gross += r.gross_sales;
      net += r.net_sales;
      tickets += r.total_tickets;
      if (r.total_cash_variance != null) {
        varSum += r.total_cash_variance;
        varCount += 1;
      }
      if (r.net_sales > maxNet) {
        maxNet = r.net_sales;
        bestFolio = r.folio;
      }
    }
    return {
      gross,
      net,
      tickets,
      avgVariance: varCount > 0 ? varSum / varCount : null,
      bestFolio: bestFolio || null,
      bestNet: bestFolio ? maxNet : 0,
      reportCount: rows.length,
    };
  }, [rows]);

  /* ── Trend chart: chronological order, oldest → newest ── */

  const trend = useMemo(() => {
    return [...rows]
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map((r) => ({
        ymd: r.date,
        label: formatDate(r.date, 'MMM d'),
        net: r.net_sales,
        gross: r.gross_sales,
        tickets: r.total_tickets,
      }));
  }, [rows]);

  if (query.error) {
    return (
      <Card title="Daily reports">
        <div className="table-wrap">
          <EmptyState
            icon="⚠"
            message="Failed to load reports"
            sub={(query.error as Error).message}
          />
        </div>
      </Card>
    );
  }

  if (query.isLoading) {
    return (
      <Card title="Daily reports">
        <div className="table-wrap">
          <div className="loading-block">
            <span className="spinner" />
            Loading…
          </div>
        </div>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card title="Daily reports">
        <div className="table-wrap">
          <EmptyState
            message="No daily reports yet"
            sub="Close a shift and run the day-close action from the terminal"
          />
        </div>
      </Card>
    );
  }

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label={t('reports.totalsInView')}
          value={formatMoney(summary.gross)}
          sub={`${summary.reportCount} folio${summary.reportCount === 1 ? '' : 's'} · gross`}
        />
        <KPICard
          label="Net"
          value={formatMoney(summary.net)}
          sub={`${summary.tickets} tickets`}
        />
        <KPICard
          label={t('reports.bestDay')}
          value={summary.bestFolio ? `Z-${String(summary.bestFolio).padStart(4, '0')}` : '—'}
          sub={summary.bestFolio ? formatMoney(summary.bestNet) : ''}
        />
        <KPICard
          label="Avg variance"
          value={
            summary.avgVariance == null
              ? '—'
              : `${summary.avgVariance > 0 ? '+' : ''}${formatMoney(summary.avgVariance)}`
          }
          valueColor={
            summary.avgVariance == null
              ? 'default'
              : summary.avgVariance === 0
                ? 'default'
                : summary.avgVariance > 0
                  ? 'green'
                  : 'red'
          }
          sub="cash drawer"
        />
      </div>

      {trend.length > 1 && (
        <Card title={t('reports.dailyTrend')} className="mb-16">
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={trend} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="label"
                stroke="var(--text3)"
                tick={{ fontSize: 11, fill: 'var(--text2)' }}
                axisLine={{ stroke: 'var(--border)' }}
                tickLine={false}
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
                cursor={{ stroke: 'var(--gold)', strokeOpacity: 0.4 }}
                contentStyle={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border2)',
                  borderRadius: 6,
                  fontSize: 12,
                  color: 'var(--text)',
                }}
                formatter={(v, name) => [
                  formatMoney(Number(v)),
                  name === 'net' ? 'Net' : 'Gross',
                ]}
              />
              <Line
                type="monotone"
                dataKey="gross"
                stroke="var(--border2)"
                strokeWidth={1.5}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="net"
                stroke="var(--gold)"
                strokeWidth={2}
                dot={{ r: 3, stroke: 'var(--gold)', strokeWidth: 2, fill: 'var(--surface)' }}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="Daily reports">
      <div className="table-wrap">
        <div
          className="table-head"
          style={{ gridTemplateColumns: PARENT_GRID }}
        >
          <div>Folio</div>
          <div>Date</div>
          <div>Status</div>
          <div>Shifts</div>
          <div>Tickets</div>
          <div>Gross</div>
          <div>Net</div>
          <div>Variance</div>
        </div>

        {rows.map((r, idx) => (
          <ReportGroup
            key={r.id}
            report={r}
            even={idx % 2 === 0}
            onOpenReport={() => navigate(`/cash/daily/${r.id}`)}
            onOpenShift={(s) => navigate(`/cash/shifts/${s.id}`)}
          />
        ))}

        {query.hasNextPage && (
          <div style={{ padding: 14, display: 'flex', justifyContent: 'center' }}>
            <Button
              variant="secondary"
              size="sm"
              loading={query.isFetchingNextPage}
              onClick={() => query.fetchNextPage()}
            >
              Load more
            </Button>
          </div>
        )}
      </div>
    </Card>
    </>
  );
}

interface ReportGroupProps {
  report: DailyReport;
  even: boolean;
  onOpenReport: () => void;
  onOpenShift: (shift: DailyReportShift) => void;
}

function ReportGroup({
  report,
  even,
  onOpenReport,
  onOpenShift,
}: ReportGroupProps) {
  return (
    <>
      <div
        className={`table-row ${even ? 'even' : 'odd'}`}
        style={{ gridTemplateColumns: PARENT_GRID }}
        onClick={onOpenReport}
      >
        <div className="fw-600 fs-13">{folioLabel(report.folio)}</div>
        <div className="fs-13">{formatDate(report.date)}</div>
        <div>
          <Badge tone={report.status === 'CLOSED' ? 'green' : 'gold'}>
            {report.status}
          </Badge>
        </div>
        <div className="fs-13">{report.total_shifts}</div>
        <div className="fs-13">{report.total_tickets}</div>
        <div className="fw-600 fs-13">{formatMoney(report.gross_sales)}</div>
        <div className="fs-13">{formatMoney(report.net_sales)}</div>
        <div>
          <Variance value={report.total_cash_variance} />
        </div>
      </div>

      {report.shifts.length === 0 ? (
        <div
          style={{
            padding: '8px 16px 8px 56px',
            background: '#ede8df',
            borderTop: '1px solid var(--border)',
            color: 'var(--text3)',
            fontSize: 12,
            fontStyle: 'italic',
          }}
        >
          No shifts attached to this report
        </div>
      ) : (
        report.shifts.map((s) => (
          <ShiftChildRow key={s.id} shift={s} onClick={() => onOpenShift(s)} />
        ))
      )}
    </>
  );
}

interface ShiftChildRowProps {
  shift: DailyReportShift;
  onClick: () => void;
}

function ShiftChildRow({ shift, onClick }: ShiftChildRowProps) {
  const variance = shift.shift_report?.cash_variance ?? null;
  return (
    <div
      className="table-row"
      style={{
        gridTemplateColumns: CHILD_GRID,
        background: '#ede8df',
        borderTop: '1px solid var(--border)',
        padding: '9px 16px',
        fontSize: 12.5,
      }}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      <div
        style={{
          color: 'var(--text3)',
          fontSize: 14,
          textAlign: 'center',
        }}
        aria-hidden
      >
        ↳
      </div>
      <div>
        <span className="fw-600">{shift.user?.name ?? '—'}</span>
      </div>
      <div className="text-muted">{formatDateTime(shift.opened_at)}</div>
      <div className="text-muted">
        {shift.closed_at ? formatDateTime(shift.closed_at) : '—'}
      </div>
      <div>{shift.shift_report?.total_tickets ?? 0}</div>
      <div className="fw-600">
        {formatMoney(shift.shift_report?.gross_sales ?? 0)}
      </div>
      <div>
        <Variance value={variance} />
      </div>
    </div>
  );
}

function Variance({ value }: { value: number | null }) {
  if (value == null) return <span className="fs-12 text-muted">—</span>;
  if (value === 0) return <span className="text-muted">{formatMoney(0)}</span>;
  const cls = value > 0 ? 'text-green' : 'text-red';
  const sign = value > 0 ? '+' : '';
  return (
    <span className={`fw-600 ${cls}`}>
      {sign}
      {formatMoney(value)}
    </span>
  );
}
