import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getDailySummary, type DailySummaryReport } from '../../api/reports';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { formatMoney } from '../../utils/format';
import { hubStyles } from './styles';
import { IconRefresh } from './HubIcons';

interface DailyReportModalProps {
  open: boolean;
  currentRegisterId: string | null;
  onClose: () => void;
}

type Scope = 'shift' | 'day';

const localStyles: Record<string, React.CSSProperties> = {
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
    marginBottom: 16,
  },
  scopeRow: {
    display: 'inline-flex',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: 3,
    gap: 2,
  },
  dateInput: {
    height: 36,
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '0 10px',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
    fontVariantNumeric: 'tabular-nums',
  },
  refreshBtn: {
    marginLeft: 'auto',
    padding: '8px 12px',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  metricsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 10,
    marginBottom: 16,
  },
  metric: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 14px',
  },
  metricLabel: {
    fontSize: 10,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  metricValue: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    marginTop: 4,
    fontVariantNumeric: 'tabular-nums',
  },
  sectionHd: {
    fontSize: 11,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginTop: 18,
    marginBottom: 8,
  },
  rowsList: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    overflow: 'hidden',
  },
  listRow: {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto',
    gap: 12,
    padding: '10px 14px',
    fontSize: 13,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
  listRowLast: { borderBottom: 'none' },
  amount: {
    fontVariantNumeric: 'tabular-nums',
    fontWeight: 600,
  },
  expectedRow: {
    marginTop: 12,
    padding: '14px 16px',
    background: 'rgba(201,164,92,0.10)',
    border: '1px solid rgba(201,164,92,0.4)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
};

function scopeBtnStyle(active: boolean): React.CSSProperties {
  return {
    padding: '8px 14px',
    borderRadius: 6,
    fontSize: 13,
    fontWeight: 600,
    color: active ? 'var(--text1)' : 'var(--text2)',
    background: active ? 'var(--bg2)' : 'transparent',
    border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
  };
}

function todayDateLocal(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

export function DailyReportModal({ open, currentRegisterId, onClose }: DailyReportModalProps) {
  const { t } = useTranslation();
  const [date, setDate] = useState<string>(todayDateLocal());
  const [scope, setScope] = useState<Scope>(currentRegisterId ? 'shift' : 'day');

  // When the hub opens, default to "My shift" if a register is open; "All today"
  // otherwise. Reset when the modal closes/opens so a stale scope doesn't
  // linger from a previous session.
  useEffect(() => {
    if (open) {
      setDate(todayDateLocal());
      setScope(currentRegisterId ? 'shift' : 'day');
    }
  }, [open, currentRegisterId]);

  const params = useMemo(() => {
    const p: { date: string; register_id?: string } = { date };
    if (scope === 'shift' && currentRegisterId) p.register_id = currentRegisterId;
    return p;
  }, [date, scope, currentRegisterId]);

  const reportQuery = useQuery<DailySummaryReport>({
    queryKey: ['daily-summary', params],
    queryFn: () => getDailySummary(params),
    enabled: open,
    staleTime: 10_000,
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const data = reportQuery.data;
  const empty = data && data.orders.count === 0 && data.cash_movements.items.length === 0;

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div
        style={hubStyles.wideChildModal}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
      >
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('dailyReport.title')}</h2>
          <div style={hubStyles.sub}>{t('dailyReport.subtitle')}</div>
        </div>

        <div style={hubStyles.body}>
          <div style={localStyles.toolbar}>
            <div style={localStyles.scopeRow}>
              <button
                type="button"
                style={scopeBtnStyle(scope === 'shift')}
                onClick={() => setScope('shift')}
                disabled={!currentRegisterId}
                title={!currentRegisterId ? t('hub.disabled.noShift') : undefined}
              >
                {t('dailyReport.scope.shift')}
              </button>
              <button
                type="button"
                style={scopeBtnStyle(scope === 'day')}
                onClick={() => setScope('day')}
              >
                {t('dailyReport.scope.day')}
              </button>
            </div>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              style={localStyles.dateInput}
              aria-label={t('dailyReport.dateLabel')}
            />
            <button
              type="button"
              style={localStyles.refreshBtn}
              onClick={() => reportQuery.refetch()}
              disabled={reportQuery.isFetching}
            >
              {reportQuery.isFetching ? <Spinner size={12} /> : <IconRefresh />}
              <span>{t('dailyReport.refresh')}</span>
            </button>
          </div>

          {reportQuery.isLoading ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> {t('common.loading')}
            </div>
          ) : reportQuery.isError ? (
            <div style={hubStyles.errBanner}>{t('dailyReport.failed')}</div>
          ) : data && empty ? (
            <div style={{ color: 'var(--text2)', fontSize: 13, padding: '16px 0' }}>
              {t('dailyReport.empty')}
            </div>
          ) : data ? (
            <>
              <div style={localStyles.metricsGrid}>
                <Metric
                  label={t('dailyReport.orders')}
                  value={String(data.orders.count)}
                />
                <Metric
                  label={t('dailyReport.gross')}
                  value={formatMoney(data.orders.gross_revenue)}
                />
                <Metric
                  label={t('dailyReport.avgTicket')}
                  value={formatMoney(data.orders.avg_ticket)}
                />
                <Metric
                  label={t('dailyReport.net')}
                  value={formatMoney(data.orders.net_revenue)}
                />
                <Metric
                  label={t('dailyReport.tax')}
                  value={formatMoney(data.orders.tax_total)}
                />
                <Metric
                  label={t('dailyReport.discount')}
                  value={formatMoney(data.orders.discount_total)}
                />
              </div>

              {data.payment_methods.length > 0 && (
                <>
                  <div style={localStyles.sectionHd}>{t('dailyReport.byMethod')}</div>
                  <div style={localStyles.rowsList}>
                    {data.payment_methods.map((row, i) => (
                      <div
                        key={row.method}
                        style={{
                          ...localStyles.listRow,
                          ...(i === data.payment_methods.length - 1
                            ? localStyles.listRowLast
                            : null),
                        }}
                      >
                        <span>{row.method}</span>
                        <span style={{ color: 'var(--text2)' }}>{row.count}</span>
                        <span style={localStyles.amount}>{formatMoney(row.total)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}

              {(data.cash_movements.items.length > 0 ||
                data.cash_movements.cash_in_total !== '0' ||
                data.cash_movements.cash_out_total !== '0') && (
                <>
                  <div style={localStyles.sectionHd}>{t('dailyReport.movementsHeader')}</div>
                  <div style={localStyles.metricsGrid}>
                    <Metric
                      label={t('dailyReport.cashIn')}
                      value={formatMoney(data.cash_movements.cash_in_total)}
                      tone="green"
                    />
                    <Metric
                      label={t('dailyReport.cashOut')}
                      value={formatMoney(data.cash_movements.cash_out_total)}
                      tone="red"
                    />
                    <div />
                  </div>
                  {data.cash_movements.items.length > 0 && (
                    <div style={localStyles.rowsList}>
                      {data.cash_movements.items.map((m, i) => (
                        <div
                          key={m.id}
                          style={{
                            ...localStyles.listRow,
                            ...(i === data.cash_movements.items.length - 1
                              ? localStyles.listRowLast
                              : null),
                          }}
                        >
                          <span>{m.reason}</span>
                          <span style={{ color: 'var(--text3)' }}>
                            {new Date(m.created_at).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                          <span
                            style={{
                              ...localStyles.amount,
                              color: m.type === 'CASH_IN' ? 'var(--green)' : 'var(--red)',
                            }}
                          >
                            {m.type === 'CASH_IN' ? '+' : '−'}
                            {formatMoney(m.amount)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}

              {data.expected_cash !== null && (
                <div style={localStyles.expectedRow}>
                  <span style={localStyles.metricLabel}>{t('dailyReport.expected')}</span>
                  <span style={localStyles.metricValue}>{formatMoney(data.expected_cash)}</span>
                  <span style={hubStyles.hint}>{t('dailyReport.expectedHint')}</span>
                </div>
              )}
            </>
          ) : null}
        </div>

        <div style={hubStyles.actions}>
          <button type="button" style={hubStyles.primaryBtn} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  tone?: 'green' | 'red';
}

function Metric({ label, value, tone }: MetricProps) {
  return (
    <div style={localStyles.metric}>
      <div style={localStyles.metricLabel}>{label}</div>
      <div
        style={{
          ...localStyles.metricValue,
          ...(tone === 'green'
            ? { color: 'var(--green)' }
            : tone === 'red'
              ? { color: 'var(--red)' }
              : null),
        }}
      >
        {value}
      </div>
    </div>
  );
}
