// Payroll periods — list + generate + approve/pay rail.
//
// Layout
//   AdminViewShell (Back · "Payroll" · subtitle · [Generate week])
//   ├─ Filter row (status pill)
//   ├─ Periods table grouped most-recent-first
//   └─ Detail drawer (attendance breakdown, bonuses, approve/pay actions)

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  generatePayroll,
  getPayroll,
  listPayroll,
  updatePayroll,
  type PayrollPeriodDetail,
  type PayrollStatus,
} from '../../../api/payroll';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';

interface PayrollViewProps {
  onBack: () => void;
}

type StatusFilter = 'ALL' | PayrollStatus;

const COLS = '1.4fr 160px 80px 80px 100px 100px 100px 110px 90px';

export function PayrollView({ onBack }: PayrollViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t0 = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(t0);
  }, [toast]);

  const query = useQuery({
    queryKey: ['admin', 'payroll', 'list', status],
    queryFn: () =>
      listPayroll({
        status: status === 'ALL' ? undefined : status,
        limit: 50,
      }),
    staleTime: 30_000,
  });

  const rows = query.data?.items ?? [];

  const headerActions = (
    <button type="button" style={btnPrimary} onClick={() => setGenerateOpen(true)}>
      {t('payroll.generate')}
    </button>
  );

  return (
    <AdminViewShell
      titleKey="payroll.title"
      subtitleKey="payroll.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      <div style={adminStyles.filterRow as CSSProperties}>
        <div style={adminStyles.filterField as CSSProperties}>
          <span style={adminStyles.filterLabel as CSSProperties}>
            {t('payroll.filter.status')}
          </span>
          <div style={adminStyles.pillRow as CSSProperties}>
            {(['ALL', 'DRAFT', 'APPROVED', 'PAID'] as StatusFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                style={{
                  ...(adminStyles.pillBtn as CSSProperties),
                  ...(status === s ? (adminStyles.pillBtnActive as CSSProperties) : {}),
                }}
              >
                {s === 'ALL'
                  ? t('payroll.filter.statusAll')
                  : t(`payroll.status.${s}` as any)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={tableWrap}>
        <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
          <span>{t('payroll.col.employee')}</span>
          <span>{t('payroll.col.week')}</span>
          <span style={cellNumHead}>{t('payroll.col.worked')}</span>
          <span style={cellNumHead}>{t('payroll.col.unpaid')}</span>
          <span style={cellNumHead}>{t('payroll.col.gross')}</span>
          <span style={cellNumHead}>{t('payroll.col.deductions')}</span>
          <span style={cellNumHead}>{t('payroll.col.bonus')}</span>
          <span style={cellNumHead}>{t('payroll.col.net')}</span>
          <span>{t('payroll.col.status')}</span>
        </div>
        {query.isLoading && (
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        )}
        {!query.isLoading && rows.length === 0 && (
          <div style={emptyState}>{t('payroll.empty')}</div>
        )}
        {rows.map((row) => (
          <button
            type="button"
            key={row.id}
            onClick={() => setSelectedId(row.id)}
            style={{
              ...tableRow,
              gridTemplateColumns: COLS,
              ...(selectedId === row.id ? selectedRow : {}),
            }}
          >
            <span style={nameCell}>
              <span style={nameMain}>{row.user.name}</span>
              <span style={nameSub}>{row.user.position || row.user.email}</span>
            </span>
            <span style={cellMuted}>
              {fmtShortDate(row.week_start)} – {fmtShortDate(row.week_end)}
            </span>
            <span style={cellNum}>
              {row.days_worked}/{row.days_expected}
            </span>
            <span style={cellNum}>{row.unpaid_absences}</span>
            <span style={cellNum}>{formatMoneyPlain(row.gross_pay)}</span>
            <span style={cellNum}>{formatMoneyPlain(row.deductions)}</span>
            <span style={cellNum}>{formatMoneyPlain(row.bonuses)}</span>
            <span style={{ ...cellNum, fontWeight: 700 }}>
              {formatMoneyPlain(row.net_pay)}
            </span>
            <span>
              <span style={{ ...statusBadge, ...statusBadgeFor(row.status) }}>
                {t(`payroll.status.${row.status}` as any)}
              </span>
            </span>
          </button>
        ))}
      </div>

      {selectedId && (
        <PayrollDetailDrawer
          payrollId={selectedId}
          onClose={() => setSelectedId(null)}
          onSaved={(text) => {
            setToast({ kind: 'ok', text });
            queryClient.invalidateQueries({ queryKey: ['admin', 'payroll'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {generateOpen && (
        <GenerateModal
          onClose={() => setGenerateOpen(false)}
          onSaved={(text) => {
            setToast({ kind: 'ok', text });
            setGenerateOpen(false);
            queryClient.invalidateQueries({ queryKey: ['admin', 'payroll'] });
          }}
          onError={(text) => setToast({ kind: 'err', text })}
        />
      )}

      {toast && (
        <div
          style={{
            ...toastStyle,
            background: toast.kind === 'ok' ? 'var(--green)' : 'var(--red)',
          }}
          role="status"
        >
          {toast.text}
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Detail drawer ───────────────────────────────────────────────────────

interface DrawerProps {
  payrollId: string;
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}

function PayrollDetailDrawer({ payrollId, onClose, onSaved, onError }: DrawerProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['admin', 'payroll', 'detail', payrollId],
    queryFn: () => getPayroll(payrollId),
    staleTime: 15_000,
  });

  const detail: PayrollPeriodDetail | undefined = query.data;
  const [bonus, setBonus] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  useEffect(() => {
    if (detail) {
      setBonus((Number(detail.bonuses) / 100).toFixed(2));
      setNotes(detail.notes ?? '');
    }
  }, [detail]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const updateMut = useMutation({
    mutationFn: (input: { bonuses?: number; status?: PayrollStatus; notes?: string | null }) =>
      updatePayroll(payrollId, input),
    onSuccess: (_, vars) => {
      const text = vars.status === 'APPROVED'
        ? t('payroll.approved')
        : vars.status === 'PAID'
          ? t('payroll.markedPaid')
          : t('payroll.bonusSaved');
      onSaved(text);
      queryClient.invalidateQueries({ queryKey: ['admin', 'payroll'] });
    },
    onError: () => onError(t('payroll.updateFailed')),
  });

  if (query.isLoading || !detail) {
    return (
      <div style={drawerScrim} onClick={onClose}>
        <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
          <div style={spinnerWrap}>
            <Spinner />
          </div>
        </div>
      </div>
    );
  }

  function saveBonus() {
    const n = Number(bonus);
    if (!Number.isFinite(n) || n < 0) return;
    updateMut.mutate({ bonuses: Math.round(n * 100), notes: notes || null });
  }

  function approve() {
    updateMut.mutate({ status: 'APPROVED' });
  }

  function markPaid() {
    updateMut.mutate({ status: 'PAID' });
  }

  return (
    <div style={drawerScrim} onClick={onClose}>
      <div style={drawerPanel} onClick={(e) => e.stopPropagation()}>
        <div style={drawerHead}>
          <div>
            <h3 style={drawerTitle}>{detail.user.name}</h3>
            <p style={drawerSub}>
              {fmtShortDate(detail.week_start)} – {fmtShortDate(detail.week_end)}
              {' · '}
              {t(`payroll.status.${detail.status}` as any)}
              {detail.approver && (
                <>
                  {' · '}
                  {t('payroll.detail.approverLabel')}: {detail.approver.name}
                </>
              )}
            </p>
          </div>
          <button type="button" onClick={onClose} style={drawerClose}>
            ×
          </button>
        </div>

        <div style={drawerBody}>
          <div style={adminStyles.kpiRow as CSSProperties}>
            <Kpi label={t('payroll.col.worked')} value={`${detail.days_worked}/${detail.days_expected}`} />
            <Kpi label={t('payroll.col.unpaid')} value={String(detail.unpaid_absences)} />
            <Kpi label={t('payroll.col.gross')} value={formatMoneyPlain(detail.gross_pay)} />
            <Kpi label={t('payroll.col.deductions')} value={formatMoneyPlain(detail.deductions)} />
            <Kpi label={t('payroll.col.bonus')} value={formatMoneyPlain(detail.bonuses)} />
            <Kpi label={t('payroll.col.net')} value={formatMoneyPlain(detail.net_pay)} accent />
          </div>

          <h4 style={sectionHead}>{t('payroll.detail.bonuses')}</h4>
          <div style={inlineRow}>
            <input
              type="number"
              step="0.01"
              min={0}
              value={bonus}
              disabled={detail.status !== 'DRAFT'}
              onChange={(e) => setBonus(e.target.value)}
              style={{ ...textInputStyle, flex: 1, maxWidth: 200 }}
            />
            <button
              type="button"
              style={btnSecondary}
              onClick={saveBonus}
              disabled={updateMut.isPending || detail.status !== 'DRAFT'}
            >
              {t('payroll.detail.saveBonus')}
            </button>
          </div>

          <h4 style={sectionHead}>{t('payroll.detail.notes')}</h4>
          <textarea
            value={notes}
            disabled={detail.status === 'PAID'}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...textInputStyle, minHeight: 60, padding: '8px 10px', width: '100%' }}
          />

          <h4 style={sectionHead}>{t('payroll.detail.attendance')}</h4>
          <div style={attendanceList}>
            {detail.attendance.length === 0 && (
              <div style={emptyState}>{t('payroll.empty')}</div>
            )}
            {detail.attendance.map((a) => (
              <div key={a.id} style={attendanceLine}>
                <span style={attDate}>{fmtShortDate(a.date)}</span>
                <span style={{ ...statusBadge, ...attendanceBadge(a.status) }}>
                  {t(`attendance.status.${a.status}` as any)}
                  {a.status === 'ABSENT' && !a.is_paid && ' · ' + t('attendance.unpaid')}
                </span>
                <span style={attReason}>{a.reason || ''}</span>
              </div>
            ))}
          </div>

          <div style={footerRow}>
            <span style={{ flex: 1 }} />
            {detail.status === 'DRAFT' && (
              <button
                type="button"
                style={btnPrimary}
                onClick={approve}
                disabled={updateMut.isPending}
              >
                {t('payroll.detail.approve')}
              </button>
            )}
            {detail.status === 'APPROVED' && (
              <button
                type="button"
                style={{ ...btnPrimary, background: 'var(--green)', borderColor: 'var(--green)' }}
                onClick={markPaid}
                disabled={updateMut.isPending}
              >
                {t('payroll.detail.markPaid')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Generate modal ──────────────────────────────────────────────────────

function GenerateModal({
  onClose,
  onSaved,
  onError,
}: {
  onClose: () => void;
  onSaved: (text: string) => void;
  onError: (text: string) => void;
}) {
  const { t } = useTranslation();

  // Default to the current week's Monday.
  const defaultMonday = useMemo(() => {
    const d = new Date();
    const dow = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - dow);
    return d.toISOString().slice(0, 10);
  }, []);

  const [weekStart, setWeekStart] = useState<string>(defaultMonday);
  const [daysExpected, setDaysExpected] = useState<number>(6);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [onClose]);

  const generateMut = useMutation({
    mutationFn: () => generatePayroll({ week_start: weekStart, days_expected: daysExpected }),
    onSuccess: (res) => {
      onSaved(
        t('payroll.generated')
          .replace('{n}', String(res.generated))
          .replace('{s}', String(res.skipped)),
      );
    },
    onError: () => onError(t('payroll.generateFailed')),
  });

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={modalTitle}>{t('payroll.generateTitle')}</h3>
          <button type="button" onClick={onClose} style={drawerClose}>
            ×
          </button>
        </div>
        <div style={{ padding: '20px 22px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <label style={fieldStyle}>
            <span style={fieldLabel}>{t('payroll.weekStart')}</span>
            <input
              type="date"
              value={weekStart}
              onChange={(e) => setWeekStart(e.target.value)}
              style={textInputStyle}
            />
          </label>
          <label style={fieldStyle}>
            <span style={fieldLabel}>{t('payroll.daysExpected')}</span>
            <input
              type="number"
              min={1}
              max={7}
              value={daysExpected}
              onChange={(e) => setDaysExpected(Number(e.target.value) || 6)}
              style={textInputStyle}
            />
          </label>
          <div style={footerRow}>
            <button type="button" style={btnSecondary} onClick={onClose}>
              {t('common.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={btnPrimary}
              disabled={generateMut.isPending}
              onClick={() => generateMut.mutate()}
            >
              {t('payroll.confirmGenerate')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      style={{
        ...(adminStyles.kpiCard as CSSProperties),
        ...(accent ? { background: 'rgba(74,140,92,0.08)', borderColor: 'var(--green)' } : {}),
      }}
    >
      <span style={adminStyles.kpiLabel as CSSProperties}>{label}</span>
      <span style={adminStyles.kpiValue as CSSProperties}>{value}</span>
    </div>
  );
}

function statusBadgeFor(status: PayrollStatus): CSSProperties {
  switch (status) {
    case 'PAID':
      return { background: 'rgba(74,140,92,0.12)', color: 'var(--green)' };
    case 'APPROVED':
      return { background: 'rgba(201,164,92,0.16)', color: '#8a6d2a' };
    case 'DRAFT':
      return { background: 'rgba(168,152,136,0.18)', color: 'var(--text2)' };
  }
}

function attendanceBadge(status: PayrollPeriodDetail['attendance'][number]['status']): CSSProperties {
  switch (status) {
    case 'PRESENT':
      return { background: 'rgba(74,140,92,0.12)', color: 'var(--green)' };
    case 'LATE':
      return { background: 'rgba(201,164,92,0.16)', color: '#8a6d2a' };
    case 'ABSENT':
      return { background: 'rgba(196,80,64,0.12)', color: 'var(--red)' };
    case 'DAY_OFF':
      return { background: 'rgba(168,152,136,0.18)', color: 'var(--text2)' };
  }
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ─── Local styles ────────────────────────────────────────────────────────

const tableWrap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  marginTop: 8,
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 18px',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  gap: 10,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '14px 18px',
  borderTop: '1px solid var(--border)',
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  fontSize: 13,
  color: 'var(--text1)',
  width: '100%',
  gap: 10,
};

const selectedRow: CSSProperties = { background: 'rgba(201,164,92,0.08)' };
const cellMuted: CSSProperties = { color: 'var(--text2)' };
const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text1)',
};
const cellNumHead: CSSProperties = { textAlign: 'right' };
const nameCell: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 2 };
const nameMain: CSSProperties = { fontWeight: 600, color: 'var(--text1)' };
const nameSub: CSSProperties = { fontSize: 11, color: 'var(--text3)' };

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '3px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const drawerScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 200,
  display: 'flex',
  justifyContent: 'flex-end',
};

const drawerPanel: CSSProperties = {
  width: 'min(620px, 92vw)',
  background: 'var(--bg2)',
  borderLeft: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.18)',
  height: '100%',
};

const drawerHead: CSSProperties = {
  padding: '20px 24px 14px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
};

const drawerTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const drawerSub: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  marginTop: 4,
};

const drawerClose: CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text2)',
  fontSize: 18,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const drawerBody: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: 'auto',
  padding: '20px 24px 24px',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionHead: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  margin: '8px 0 0',
};

const inlineRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
};

const attendanceList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
};

const attendanceLine: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '110px auto 1fr',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  fontSize: 12,
};

const attDate: CSSProperties = { color: 'var(--text2)', fontWeight: 600 };
const attReason: CSSProperties = { color: 'var(--text3)', fontStyle: 'italic' };

const footerRow: CSSProperties = {
  display: 'flex',
  gap: 10,
  alignItems: 'center',
  paddingTop: 8,
};

const fieldStyle: CSSProperties = { display: 'flex', flexDirection: 'column', gap: 4 };
const fieldLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const textInputStyle: CSSProperties = {
  height: 38,
  border: '1px solid var(--border)',
  borderRadius: 8,
  background: 'var(--bg2)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
};

const btnPrimary: CSSProperties = {
  padding: '10px 18px',
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const btnSecondary: CSSProperties = {
  padding: '10px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 250,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const modalCard: CSSProperties = {
  width: 'min(480px, 92vw)',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
};

const modalHead: CSSProperties = {
  padding: '18px 22px 12px',
  borderBottom: '1px solid var(--border)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const modalTitle: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 20,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
};

const spinnerWrap: CSSProperties = {
  padding: 28,
  display: 'flex',
  justifyContent: 'center',
};

const emptyState: CSSProperties = {
  padding: '36px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: 24,
  left: '50%',
  transform: 'translateX(-50%)',
  padding: '10px 18px',
  borderRadius: 999,
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  zIndex: 300,
  boxShadow: '0 12px 32px rgba(0,0,0,0.24)',
};
