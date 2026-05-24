// Tip pool adjuster. Manager-only — toggles inclusion, sets manual
// overrides, distributes on close as PayrollAdjustment(BONUS, source_kind=
// 'TIPS') rows on each included user's DRAFT payroll period.
//
// Layout
//   AdminViewShell
//   ├─ Summary card (week heading + 3 KPIs + Refresh)
//   ├─ Allocations table (one row per employee)
//   ├─ Confirmation modal (close OR reopen)
//   └─ Bottom action bar (Close & distribute / Reopen pool)

import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  closePool,
  getCurrentPool,
  refreshPool,
  reopenPool,
  updateAllocation,
  type TipAllocation,
  type TipPool,
} from '../../../api/tips';
import { ApiError } from '../../../api/client';
import { useTranslation } from '../../../i18n';
import { useHaptics } from '../../../hooks/useHaptics';
import { useToast } from '../../Toast';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoney, formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';

interface TipsAdjustViewProps {
  onBack: () => void;
}

function fmtShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function fmtMonday(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// Parse a $ string ("12.50") to centavos (1250). Returns null when empty.
function dollarsToCentavos(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed.replace(/,/g, ''));
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

export function TipsAdjustView({ onBack }: TipsAdjustViewProps) {
  const { t } = useTranslation();
  const toast = useToast();
  const haptics = useHaptics();
  const queryClient = useQueryClient();

  const [confirmKind, setConfirmKind] = useState<'close' | 'reopen' | null>(null);

  const query = useQuery({
    queryKey: ['admin', 'tips', 'current'],
    queryFn: () => getCurrentPool(),
    staleTime: 15_000,
  });
  const pool: TipPool | undefined = query.data;

  const refreshMut = useMutation({
    mutationFn: (id: string) => refreshPool(id),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['admin', 'tips', 'current'], fresh);
      haptics.success();
      toast.success(t('admin.tips.refreshed'));
    },
    onError: (err) => {
      haptics.error();
      toast.error(
        err instanceof ApiError ? err.message : t('common.unknownError'),
      );
    },
  });

  const allocationMut = useMutation({
    mutationFn: (input: {
      poolId: string;
      userId: string;
      patch: { included?: boolean; override_amount?: number | null };
    }) => updateAllocation(input.poolId, input.userId, input.patch),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['admin', 'tips', 'current'], fresh);
    },
    onError: (err) => {
      haptics.error();
      toast.error(
        err instanceof ApiError ? err.message : t('common.unknownError'),
      );
    },
  });

  const closeMut = useMutation({
    mutationFn: (id: string) => closePool(id),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['admin', 'tips', 'current'], fresh);
      // Closing distributes as payroll adjustments — bust those caches too.
      queryClient.invalidateQueries({ queryKey: ['admin', 'payroll'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tips'] });
      haptics.success();
      toast.success(t('admin.tips.closedToast'));
      setConfirmKind(null);
    },
    onError: (err) => {
      haptics.error();
      toast.error(
        err instanceof ApiError ? err.message : t('common.unknownError'),
      );
    },
  });

  const reopenMut = useMutation({
    mutationFn: (id: string) => reopenPool(id),
    onSuccess: (fresh) => {
      queryClient.setQueryData(['admin', 'tips', 'current'], fresh);
      queryClient.invalidateQueries({ queryKey: ['admin', 'payroll'] });
      queryClient.invalidateQueries({ queryKey: ['admin', 'tips'] });
      haptics.success();
      toast.success(t('admin.tips.reopenedToast'));
      setConfirmKind(null);
    },
    onError: (err) => {
      haptics.error();
      toast.error(
        err instanceof ApiError ? err.message : t('common.unknownError'),
      );
    },
  });

  // Sort: included rows first, then alpha. Keeps the team that's getting paid
  // pinned to the top for a quick visual tally.
  const allocations = useMemo<TipAllocation[]>(() => {
    if (!pool) return [];
    return [...pool.allocations].sort((a, b) => {
      if (a.included !== b.included) return a.included ? -1 : 1;
      return (a.user?.name ?? '').localeCompare(b.user?.name ?? '');
    });
  }, [pool]);

  const includedCount = allocations.filter((a) => a.included).length;
  const totalCollectedCents = pool ? Number(pool.total_collected) : 0;
  const basePerPersonCents = includedCount > 0
    ? Math.floor(totalCollectedCents / includedCount)
    : 0;

  const isClosed = pool?.status === 'CLOSED';

  const headerActions = pool && (
    <button
      type="button"
      style={btnSecondary}
      onClick={() => refreshMut.mutate(pool.id)}
      disabled={refreshMut.isPending}
    >
      {refreshMut.isPending ? <Spinner size={12} /> : null}
      {t('admin.tips.refresh')}
    </button>
  );

  return (
    <AdminViewShell
      titleKey="admin.tips.title"
      subtitleKey="admin.tips.subtitle"
      onBack={onBack}
      headerActions={headerActions}
    >
      {query.isLoading || !pool ? (
        <div style={spinnerWrap}>
          <Spinner />
        </div>
      ) : (
        <>
          {/* ─── Summary card ───────────────────────────────────────────── */}
          <div style={summaryCard}>
            <div style={summaryHead}>
              <span style={summaryEyebrow}>{t('admin.tips.weekOf')}</span>
              <h3 style={summaryWeek}>{fmtMonday(pool.week_start)}</h3>
              {isClosed && (
                <span style={statusPill}>
                  {t('admin.tips.statusClosed')}
                </span>
              )}
            </div>
            <div style={kpiRow}>
              <Kpi
                label={t('admin.tips.totalCollected')}
                value={formatMoney(pool.total_collected)}
              />
              <Kpi
                label={t('admin.tips.included')}
                value={String(includedCount)}
              />
              <Kpi
                label={t('admin.tips.basePerPerson')}
                value={formatMoney(String(basePerPersonCents))}
              />
            </div>
          </div>

          {/* ─── Allocations table ──────────────────────────────────────── */}
          <div style={tableWrap}>
            <div style={{ ...tableHead, gridTemplateColumns: COLS }}>
              <span>{t('payroll.col.employee')}</span>
              <span style={cellNumHead}>{t('admin.tips.attendedShort')}</span>
              <span style={cellCenterHead}>{t('admin.tips.includedToggle')}</span>
              <span>{t('admin.tips.override')}</span>
              <span style={cellNumHead}>{t('admin.tips.finalAmount')}</span>
            </div>
            {allocations.length === 0 && (
              <div style={emptyState}>{t('admin.tips.emptyAllocations')}</div>
            )}
            {allocations.map((alloc) => (
              <AllocationRow
                key={alloc.id}
                alloc={alloc}
                poolId={pool.id}
                disabled={isClosed || allocationMut.isPending}
                onChange={(patch) =>
                  allocationMut.mutate({
                    poolId: pool.id,
                    userId: alloc.user_id,
                    patch,
                  })
                }
              />
            ))}
          </div>

          {/* ─── Bottom action bar ──────────────────────────────────────── */}
          <div style={actionBar}>
            {isClosed ? (
              <button
                type="button"
                style={reopenBtn}
                onClick={() => setConfirmKind('reopen')}
                disabled={reopenMut.isPending}
              >
                {t('admin.tips.reopen')}
              </button>
            ) : (
              <button
                type="button"
                style={{
                  ...closeBtn,
                  ...(includedCount === 0 ? closeBtnDisabled : {}),
                }}
                onClick={() => setConfirmKind('close')}
                disabled={includedCount === 0 || closeMut.isPending}
              >
                {closeMut.isPending ? <Spinner size={14} /> : null}
                {t('admin.tips.close')}
              </button>
            )}
          </div>
        </>
      )}

      {confirmKind && pool && (
        <ConfirmModal
          kind={confirmKind}
          pool={pool}
          allocations={allocations}
          busy={closeMut.isPending || reopenMut.isPending}
          onClose={() => setConfirmKind(null)}
          onConfirm={() => {
            if (confirmKind === 'close') closeMut.mutate(pool.id);
            else reopenMut.mutate(pool.id);
          }}
        />
      )}
    </AdminViewShell>
  );
}

// ─── Allocation row ────────────────────────────────────────────────────────

interface AllocationRowProps {
  alloc: TipAllocation;
  poolId: string;
  disabled: boolean;
  onChange: (patch: { included?: boolean; override_amount?: number | null }) => void;
}

function AllocationRow({ alloc, disabled, onChange }: AllocationRowProps) {
  const { t } = useTranslation();
  const [overrideInput, setOverrideInput] = useState<string>(
    alloc.override_amount !== null
      ? formatMoneyPlain(alloc.override_amount)
      : '',
  );

  // Re-seed local input when the upstream value changes (e.g. refresh).
  useEffect(() => {
    setOverrideInput(
      alloc.override_amount !== null
        ? formatMoneyPlain(alloc.override_amount)
        : '',
    );
  }, [alloc.override_amount]);

  function commitOverride() {
    const parsed = dollarsToCentavos(overrideInput);
    // Empty / invalid input clears the override. Allocations.override_amount
    // is nullable and null falls back to base_amount on the next refresh.
    if (parsed === null && overrideInput.trim() !== '') return;
    if (parsed === alloc.override_amount) return;
    onChange({ override_amount: parsed });
  }

  function clearOverride() {
    setOverrideInput('');
    onChange({ override_amount: null });
  }

  return (
    <div style={{ ...tableRow, gridTemplateColumns: COLS, opacity: alloc.included ? 1 : 0.6 }}>
      <span style={nameCell}>
        <span style={nameMain}>{alloc.user?.name ?? '—'}</span>
        <span style={nameSub}>
          {alloc.user?.position || alloc.user?.role || ''}
        </span>
      </span>
      <span style={attendedChip}>
        {t('admin.tips.attended').replace('{n}', String(alloc.attended_days))}
      </span>
      <span style={{ display: 'flex', justifyContent: 'center' }}>
        <button
          type="button"
          onClick={() => onChange({ included: !alloc.included })}
          disabled={disabled}
          style={{
            ...toggleTrack,
            background: alloc.included ? 'var(--green)' : 'rgba(168,152,136,0.35)',
            opacity: disabled ? 0.5 : 1,
          }}
          role="switch"
          aria-checked={alloc.included}
          aria-label={t('admin.tips.includedToggle')}
        >
          <span
            style={{
              ...toggleThumb,
              transform: alloc.included ? 'translateX(22px)' : 'translateX(2px)',
            }}
          />
        </button>
      </span>
      <span style={overrideCell}>
        <input
          type="text"
          inputMode="decimal"
          placeholder={formatMoneyPlain(alloc.base_amount)}
          value={overrideInput}
          disabled={disabled || !alloc.included}
          onChange={(e) => setOverrideInput(e.target.value)}
          onBlur={commitOverride}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          }}
          style={overrideInputStyle}
        />
        {alloc.override_amount !== null && !disabled && alloc.included && (
          <button
            type="button"
            onClick={clearOverride}
            style={overrideClear}
            aria-label={t('common.clear') || 'Clear'}
          >
            ×
          </button>
        )}
      </span>
      <span style={{ ...cellNum, fontWeight: 700 }}>
        {formatMoney(alloc.final_amount)}
      </span>
    </div>
  );
}

// ─── Confirmation modal ───────────────────────────────────────────────────

interface ConfirmModalProps {
  kind: 'close' | 'reopen';
  pool: TipPool;
  allocations: TipAllocation[];
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmModal({
  kind,
  pool,
  allocations,
  busy,
  onClose,
  onConfirm,
}: ConfirmModalProps) {
  const { t } = useTranslation();

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

  const isClose = kind === 'close';
  const includedList = allocations.filter((a) => a.included);

  return (
    <div style={modalScrim} onClick={onClose}>
      <div style={modalCard} onClick={(e) => e.stopPropagation()}>
        <div style={modalHead}>
          <h3 style={modalTitle}>
            {isClose ? t('admin.tips.closeConfirm') : t('admin.tips.reopenConfirm')}
          </h3>
          <button type="button" onClick={onClose} style={modalClose}>
            ×
          </button>
        </div>
        <div style={modalBody}>
          <p style={modalIntro}>
            {isClose
              ? t('admin.tips.closeBody')
                  .replace('{week}', fmtShortDate(pool.week_start))
                  .replace('{total}', formatMoney(pool.total_collected))
              : t('admin.tips.reopenBody')}
          </p>
          {isClose && includedList.length > 0 && (
            <div style={confirmList}>
              {includedList.map((a) => (
                <div key={a.id} style={confirmListRow}>
                  <span style={confirmListName}>{a.user?.name ?? '—'}</span>
                  <span style={confirmListAmt}>{formatMoney(a.final_amount)}</span>
                </div>
              ))}
            </div>
          )}
          <div style={modalActions}>
            <button type="button" style={btnSecondary} onClick={onClose} disabled={busy}>
              {t('common.cancel')}
            </button>
            <span style={{ flex: 1 }} />
            <button
              type="button"
              style={isClose ? closeBtn : reopenBtn}
              onClick={onConfirm}
              disabled={busy}
            >
              {busy ? <Spinner size={14} /> : null}
              {isClose ? t('admin.tips.close') : t('admin.tips.reopen')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={adminStyles.kpiCard as CSSProperties}>
      <span style={adminStyles.kpiLabel as CSSProperties}>{label}</span>
      <span style={adminStyles.kpiValue as CSSProperties}>{value}</span>
    </div>
  );
}

// ─── Local styles ──────────────────────────────────────────────────────────

const COLS = '1.6fr 70px 80px 1fr 130px';

const summaryCard: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 20,
  marginBottom: 18,
};

const summaryHead: CSSProperties = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 12,
  marginBottom: 14,
};

const summaryEyebrow: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const summaryWeek: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const statusPill: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '3px 10px',
  borderRadius: 999,
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  marginLeft: 'auto',
};

const kpiRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
  gap: 12,
};

const tableWrap: CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  padding: '12px 16px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  fontSize: 10,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  fontWeight: 700,
  color: 'var(--text3)',
  gap: 10,
  alignItems: 'center',
};

const tableRow: CSSProperties = {
  display: 'grid',
  padding: '12px 16px',
  borderBottom: '1px solid var(--border)',
  alignItems: 'center',
  gap: 10,
  fontSize: 13,
  color: 'var(--text1)',
};

const cellNum: CSSProperties = {
  textAlign: 'right',
  fontVariantNumeric: 'tabular-nums',
  color: 'var(--text1)',
};

const cellNumHead: CSSProperties = { textAlign: 'right' };
const cellCenterHead: CSSProperties = { textAlign: 'center' };

const nameCell: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
};

const nameMain: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text1)',
};

const nameSub: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
};

const attendedChip: CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
  padding: '3px 8px',
  background: 'rgba(168,152,136,0.18)',
  color: 'var(--text2)',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const toggleTrack: CSSProperties = {
  position: 'relative',
  width: 48,
  height: 28,
  borderRadius: 999,
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  transition: 'background 200ms ease',
  flexShrink: 0,
};

const toggleThumb: CSSProperties = {
  position: 'absolute',
  top: 2,
  width: 24,
  height: 24,
  borderRadius: '50%',
  background: '#fff',
  boxShadow: '0 1px 3px rgba(0,0,0,0.2), 0 0 0 0.5px rgba(0,0,0,0.04)',
  transition: 'transform 200ms cubic-bezier(0.4, 0, 0.2, 1)',
};

const overrideCell: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const overrideInputStyle: CSSProperties = {
  flex: 1,
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  padding: '0 10px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: 'inherit',
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const overrideClear: CSSProperties = {
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: 'none',
  background: 'var(--border)',
  color: 'var(--text2)',
  fontSize: 14,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  lineHeight: 1,
  flexShrink: 0,
};

const actionBar: CSSProperties = {
  marginTop: 18,
  display: 'flex',
  justifyContent: 'flex-end',
};

const closeBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 240,
  padding: '14px 24px',
  borderRadius: 12,
  border: 'none',
  background: 'var(--green)',
  color: '#fff',
  fontSize: 15,
  fontWeight: 700,
  cursor: 'pointer',
  fontFamily: 'inherit',
  letterSpacing: '0.02em',
  minHeight: 52,
};

const closeBtnDisabled: CSSProperties = {
  opacity: 0.5,
  cursor: 'not-allowed',
};

const reopenBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  minWidth: 200,
  padding: '14px 22px',
  borderRadius: 12,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 15,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 52,
};

const btnSecondary: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
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

const emptyState: CSSProperties = {
  padding: '36px 24px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const spinnerWrap: CSSProperties = {
  padding: 36,
  display: 'flex',
  justifyContent: 'center',
};

const modalScrim: CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(44,36,32,0.42)',
  zIndex: 250,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 24,
};

const modalCard: CSSProperties = {
  width: 'min(540px, 95vw)',
  background: 'var(--bg2)',
  borderRadius: 16,
  boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
  border: '1px solid var(--border)',
  display: 'flex',
  flexDirection: 'column',
  maxHeight: '85vh',
};

const modalHead: CSSProperties = {
  padding: '18px 22px 14px',
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

const modalClose: CSSProperties = {
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

const modalBody: CSSProperties = {
  padding: '18px 22px 22px',
  overflowY: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const modalIntro: CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  lineHeight: 1.5,
  margin: 0,
};

const confirmList: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
};

const confirmListRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 14px',
  borderBottom: '1px solid var(--border)',
  fontSize: 13,
  color: 'var(--text1)',
};

const confirmListName: CSSProperties = {
  fontWeight: 500,
};

const confirmListAmt: CSSProperties = {
  fontWeight: 700,
  fontVariantNumeric: 'tabular-nums',
};

const modalActions: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  paddingTop: 4,
};
