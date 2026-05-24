// Cross-shift cash movement log with day/shift grouping and in-place CRUD.
// Pulls every register (and its embedded cash_movements) in the selected
// period, then renders them as Day → Shift → Movement. Add/Edit/Delete are
// available even on closed shifts; the backend recomputes the shift's
// expected_amount, difference, and ShiftReport snapshot so the totals
// rendered here stay in sync with the rest of the system.

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import {
  fetchAllRegisters,
  type CashMovementRow,
  type CashRegisterDetail,
} from '../../../api/registers';
import {
  createCashMovement,
  deleteCashMovement,
  updateCashMovement,
  type CashMovementType,
} from '../../../api/cash-movements';
import { ApiError } from '../../../api/client';
import { useTranslation } from '../../../i18n';
import { AdminViewShell } from './AdminViewShell';
import { adminStyles } from '../styles';
import { formatMoneyPlain } from '../../../utils/format';
import { Spinner } from '../../Spinner';

interface CashMovementsLogViewProps {
  onBack: () => void;
}

type TypeFilter = 'ALL' | 'CASH_IN' | 'CASH_OUT';

interface ShiftGroup {
  register: CashRegisterDetail;
  movements: CashMovementRow[];
  inSum: Decimal;
  outSum: Decimal;
}

interface DayGroup {
  /** YYYY-MM-DD in the user's local TZ. Stable sort key. */
  dateKey: string;
  /** Pretty label, e.g. "Wed, May 20". */
  label: string;
  shifts: ShiftGroup[];
  inSum: Decimal;
  outSum: Decimal;
  count: number;
}

function isoFromInput(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function dayKey(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'unknown';
  // Local date — we want movements to group by the operator's calendar day,
  // not UTC.
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dayLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function fmtShiftWindow(reg: CashRegisterDetail): string {
  const open = fmtTime(reg.opened_at);
  if (reg.status === 'CLOSED' && reg.closed_at) {
    return `${open} – ${fmtTime(reg.closed_at)}`;
  }
  return open;
}

function parseAmountInput(input: string): number | null {
  const cleaned = input.replace(/[^0-9.,]/g, '').replace(/,/g, '.');
  if (cleaned.length === 0) return null;
  const parts = cleaned.split('.');
  if (parts.length > 2) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value <= 0) return null;
  return Math.round(value * 100);
}

function centsToInputString(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

const QUERY_KEY = 'admin-cash-log';

export function CashMovementsLogView({ onBack }: CashMovementsLogViewProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [type, setType] = useState<TypeFilter>('ALL');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [collapsedDays, setCollapsedDays] = useState<Record<string, boolean>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingForShift, setAddingForShift] = useState<string | null>(null);

  const params = useMemo(
    () => ({ from: isoFromInput(from), to: isoFromInput(to, true) }),
    [from, to],
  );

  const query = useQuery({
    queryKey: [QUERY_KEY, params],
    queryFn: () => fetchAllRegisters(params),
    staleTime: 30_000,
  });

  // Bucket registers into Day → Shift → Movement. Each level keeps its own
  // running totals so the headers can render without re-iterating.
  const days: DayGroup[] = useMemo(() => {
    const registers = query.data ?? [];
    const dayMap = new Map<string, DayGroup>();

    for (const reg of registers) {
      const movements = reg.cash_movements.filter((m) =>
        type === 'ALL' ? true : m.type === type,
      );
      // Hide shifts that have no matching movements when a type filter is
      // active — the user is asking "show me only this kind", and a shift
      // with zero matches is noise. When no filter is applied, we keep the
      // shift visible so the operator can still add a movement to it.
      if (movements.length === 0 && type !== 'ALL') continue;

      const inSum = movements
        .filter((m) => m.type === 'CASH_IN')
        .reduce((s, m) => s.plus(new Decimal(m.amount)), new Decimal(0));
      const outSum = movements
        .filter((m) => m.type === 'CASH_OUT')
        .reduce((s, m) => s.plus(new Decimal(m.amount)), new Decimal(0));

      const key = dayKey(reg.opened_at);
      let day = dayMap.get(key);
      if (!day) {
        day = {
          dateKey: key,
          label: dayLabel(reg.opened_at),
          shifts: [],
          inSum: new Decimal(0),
          outSum: new Decimal(0),
          count: 0,
        };
        dayMap.set(key, day);
      }
      const sorted = [...movements].sort((a, b) =>
        a.created_at < b.created_at ? -1 : 1,
      );
      day.shifts.push({ register: reg, movements: sorted, inSum, outSum });
      day.inSum = day.inSum.plus(inSum);
      day.outSum = day.outSum.plus(outSum);
      day.count += movements.length;
    }

    // Most recent day first; within a day, most recent shift first.
    const ordered = Array.from(dayMap.values()).sort((a, b) =>
      a.dateKey < b.dateKey ? 1 : -1,
    );
    for (const d of ordered) {
      d.shifts.sort((a, b) =>
        a.register.opened_at < b.register.opened_at ? 1 : -1,
      );
    }
    return ordered;
  }, [query.data, type]);

  const kpis = useMemo(() => {
    let inSum = new Decimal(0);
    let outSum = new Decimal(0);
    let count = 0;
    for (const d of days) {
      inSum = inSum.plus(d.inSum);
      outSum = outSum.plus(d.outSum);
      count += d.count;
    }
    return {
      count,
      in: inSum.toString(),
      out: outSum.toString(),
      net: inSum.minus(outSum).toString(),
    };
  }, [days]);

  // After any mutation, refresh the log AND any other UI that cares about
  // register/shift totals (current shift pill, shift reports, daily report).
  async function invalidateAll(): Promise<void> {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: [QUERY_KEY] }),
      queryClient.invalidateQueries({ queryKey: ['register'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'shifts'] }),
      queryClient.invalidateQueries({ queryKey: ['shift-reports'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-summary'] }),
      queryClient.invalidateQueries({ queryKey: ['daily-reports'] }),
    ]);
  }

  return (
    <AdminViewShell
      titleKey="admin.cashLog.title"
      subtitleKey="admin.cashLog.subtitle"
      onBack={onBack}
    >
      {/* ─── Filters ───────────────────────────────────────────────── */}
      <div style={adminStyles.filterRow}>
        <div style={adminStyles.filterField}>
          <span style={adminStyles.filterLabel}>
            {t('admin.cashLog.filter.type')}
          </span>
          <div style={adminStyles.pillRow}>
            {(
              [
                ['ALL', 'admin.cashLog.filter.typeAll'],
                ['CASH_IN', 'admin.cashLog.filter.in'],
                ['CASH_OUT', 'admin.cashLog.filter.out'],
              ] as const
            ).map(([key, labelKey]) => (
              <button
                key={key}
                type="button"
                style={{
                  ...adminStyles.pillBtn,
                  ...(type === key ? adminStyles.pillBtnActive : null),
                }}
                onClick={() => setType(key)}
              >
                {t(labelKey)}
              </button>
            ))}
          </div>
        </div>
        <div style={adminStyles.filterField}>
          <label htmlFor="cash-from" style={adminStyles.filterLabel}>
            {t('admin.cashLog.filter.from')}
          </label>
          <input
            id="cash-from"
            type="date"
            style={adminStyles.dateInput}
            value={from}
            onChange={(e) => setFrom(e.target.value)}
          />
        </div>
        <div style={adminStyles.filterField}>
          <label htmlFor="cash-to" style={adminStyles.filterLabel}>
            {t('admin.cashLog.filter.to')}
          </label>
          <input
            id="cash-to"
            type="date"
            style={adminStyles.dateInput}
            value={to}
            onChange={(e) => setTo(e.target.value)}
          />
        </div>
      </div>

      {/* ─── KPIs ────────────────────────────────────────────────── */}
      <div style={adminStyles.kpiRow}>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>{t('admin.cashLog.kpi.count')}</span>
          <span style={adminStyles.kpiValue}>{kpis.count}</span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>{t('admin.cashLog.kpi.in')}</span>
          <span style={{ ...adminStyles.kpiValue, color: 'var(--green)' }}>
            {formatMoneyPlain(kpis.in)}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>{t('admin.cashLog.kpi.out')}</span>
          <span style={{ ...adminStyles.kpiValue, color: 'var(--red)' }}>
            {formatMoneyPlain(kpis.out)}
          </span>
        </div>
        <div style={adminStyles.kpiCard}>
          <span style={adminStyles.kpiLabel}>{t('admin.cashLog.kpi.net')}</span>
          <span
            style={{
              ...adminStyles.kpiValue,
              color: new Decimal(kpis.net).isNegative()
                ? 'var(--red)'
                : new Decimal(kpis.net).isZero()
                  ? 'var(--text2)'
                  : 'var(--green)',
            }}
          >
            {formatMoneyPlain(kpis.net)}
          </span>
        </div>
      </div>

      {/* ─── Body ─────────────────────────────────────────────────── */}
      {query.isLoading ? (
        <div style={{ padding: 48, textAlign: 'center' }}>
          <Spinner />
        </div>
      ) : days.length === 0 ? (
        <div style={emptyState}>{t('admin.cashLog.empty')}</div>
      ) : (
        <div style={daysStack}>
          {days.map((day) => {
            const collapsed = collapsedDays[day.dateKey] === true;
            const net = day.inSum.minus(day.outSum);
            return (
              <div key={day.dateKey} style={dayCard}>
                <button
                  type="button"
                  style={dayHeader}
                  onClick={() =>
                    setCollapsedDays((c) => ({
                      ...c,
                      [day.dateKey]: !collapsed,
                    }))
                  }
                >
                  <span style={dayChevron}>{collapsed ? '▸' : '▾'}</span>
                  <span style={dayTitle}>{day.label}</span>
                  <span style={dayMetaPill}>
                    {day.count}{' '}
                    {day.count === 1
                      ? t('admin.cashLog.day.movement')
                      : t('admin.cashLog.day.movements')}
                  </span>
                  <span style={dayShiftsPill}>
                    {day.shifts.length}{' '}
                    {day.shifts.length === 1
                      ? t('admin.cashLog.day.shift')
                      : t('admin.cashLog.day.shifts')}
                  </span>
                  <div style={dayTotals}>
                    <span style={{ color: 'var(--green)' }}>
                      +{formatMoneyPlain(day.inSum.toString())}
                    </span>
                    <span style={{ color: 'var(--red)' }}>
                      −{formatMoneyPlain(day.outSum.toString())}
                    </span>
                    <span
                      style={{
                        color: net.isNegative()
                          ? 'var(--red)'
                          : net.isZero()
                            ? 'var(--text2)'
                            : 'var(--green)',
                        fontWeight: 700,
                      }}
                    >
                      {net.isNegative() ? '' : net.isZero() ? '' : '+'}
                      {formatMoneyPlain(net.toString())}
                    </span>
                  </div>
                </button>

                {!collapsed && (
                  <div style={dayBody}>
                    {day.shifts.map((shift) => (
                      <ShiftSection
                        key={shift.register.id}
                        shift={shift}
                        editingId={editingId}
                        addingHere={addingForShift === shift.register.id}
                        onStartAdd={() =>
                          setAddingForShift(shift.register.id)
                        }
                        onCancelAdd={() => setAddingForShift(null)}
                        onStartEdit={(id) => setEditingId(id)}
                        onCancelEdit={() => setEditingId(null)}
                        onMutated={() => {
                          setEditingId(null);
                          setAddingForShift(null);
                          void invalidateAll();
                        }}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Shift sub-section ─────────────────────────────────────────────

interface ShiftSectionProps {
  shift: ShiftGroup;
  editingId: string | null;
  addingHere: boolean;
  onStartAdd: () => void;
  onCancelAdd: () => void;
  onStartEdit: (movementId: string) => void;
  onCancelEdit: () => void;
  onMutated: () => void;
}

function ShiftSection({
  shift,
  editingId,
  addingHere,
  onStartAdd,
  onCancelAdd,
  onStartEdit,
  onCancelEdit,
  onMutated,
}: ShiftSectionProps) {
  const { t } = useTranslation();
  const { register, movements, inSum, outSum } = shift;
  const net = inSum.minus(outSum);
  const closed = register.status === 'CLOSED';
  const provisionalUnverified =
    register.status === 'OPEN' && register.is_provisional;
  // Backend refuses mutations on a provisional-unverified shift; everything
  // else is fair game (cashier+ role check still happens server-side).
  const canMutate = !provisionalUnverified;

  return (
    <div style={shiftBlock}>
      <div style={shiftHeader}>
        <div style={shiftHeaderLeft}>
          <span style={shiftPersonName}>
            {register.user?.name ?? '—'}
          </span>
          <span style={shiftWindow}>{fmtShiftWindow(register)}</span>
          <span
            style={{
              ...shiftStatusPill,
              ...(closed ? shiftStatusClosed : shiftStatusOpen),
            }}
          >
            {closed
              ? t('admin.cashLog.shift.closed')
              : t('admin.cashLog.shift.open')}
          </span>
          {provisionalUnverified && (
            <span style={shiftProvisionalPill}>
              {t('admin.cashLog.shift.provisional')}
            </span>
          )}
        </div>
        <div style={shiftHeaderRight}>
          <span style={shiftTotalsBlock}>
            <span style={{ color: 'var(--green)' }}>
              +{formatMoneyPlain(inSum.toString())}
            </span>
            <span style={shiftTotalsSep}>·</span>
            <span style={{ color: 'var(--red)' }}>
              −{formatMoneyPlain(outSum.toString())}
            </span>
            <span style={shiftTotalsSep}>·</span>
            <span
              style={{
                fontWeight: 700,
                color: net.isNegative()
                  ? 'var(--red)'
                  : net.isZero()
                    ? 'var(--text2)'
                    : 'var(--green)',
              }}
            >
              {net.isZero() || net.isNegative() ? '' : '+'}
              {formatMoneyPlain(net.toString())}
            </span>
          </span>
          <button
            type="button"
            style={{
              ...shiftAddBtn,
              opacity: canMutate ? 1 : 0.5,
              cursor: canMutate ? 'pointer' : 'not-allowed',
            }}
            disabled={!canMutate}
            title={
              !canMutate ? t('admin.cashLog.shift.provisionalHint') : undefined
            }
            onClick={onStartAdd}
          >
            {t('admin.cashLog.shift.add')}
          </button>
        </div>
      </div>

      {/* Inline expected/diff strip — quick sense of the shift's drawer math
          without opening the full audit screen. */}
      <div style={shiftMetaStrip}>
        <span style={shiftMetaCell}>
          <span style={shiftMetaLabel}>
            {t('admin.cashLog.shift.opening')}
          </span>
          <span style={shiftMetaValue}>
            {formatMoneyPlain(register.opening_amount)}
          </span>
        </span>
        <span style={shiftMetaCell}>
          <span style={shiftMetaLabel}>
            {t('admin.cashLog.shift.expected')}
          </span>
          <span style={shiftMetaValue}>
            {formatMoneyPlain(register.expected_amount)}
          </span>
        </span>
        {register.actual_amount !== null && (
          <span style={shiftMetaCell}>
            <span style={shiftMetaLabel}>
              {t('admin.cashLog.shift.counted')}
            </span>
            <span style={shiftMetaValue}>
              {formatMoneyPlain(register.actual_amount)}
            </span>
          </span>
        )}
        {register.difference !== null && (
          <span style={shiftMetaCell}>
            <span style={shiftMetaLabel}>
              {t('admin.cashLog.shift.diff')}
            </span>
            <span
              style={{
                ...shiftMetaValue,
                color: new Decimal(register.difference).isNegative()
                  ? 'var(--red)'
                  : new Decimal(register.difference).isZero()
                    ? 'var(--text2)'
                    : 'var(--green)',
              }}
            >
              {formatMoneyPlain(register.difference)}
            </span>
          </span>
        )}
      </div>

      {/* Movement rows */}
      {movements.length === 0 && !addingHere ? (
        <div style={shiftEmpty}>
          {t('admin.cashLog.shift.noMovements')}
        </div>
      ) : (
        <div style={movementsList}>
          {movements.map((m) =>
            editingId === m.id ? (
              <EditMovementRow
                key={m.id}
                registerId={register.id}
                movement={m}
                onCancel={onCancelEdit}
                onSaved={onMutated}
                onDeleted={onMutated}
              />
            ) : (
              <MovementRow
                key={m.id}
                movement={m}
                canMutate={canMutate}
                onEdit={() => onStartEdit(m.id)}
              />
            ),
          )}
          {addingHere && (
            <NewMovementRow
              registerId={register.id}
              onCancel={onCancelAdd}
              onSaved={onMutated}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Read row ────────────────────────────────────────────────────────

interface MovementRowProps {
  movement: CashMovementRow;
  canMutate: boolean;
  onEdit: () => void;
}

function MovementRow({ movement, canMutate, onEdit }: MovementRowProps) {
  const { t } = useTranslation();
  const isIn = movement.type === 'CASH_IN';
  return (
    <div style={movementRowStyle}>
      <span style={movementTime}>{fmtTime(movement.created_at)}</span>
      <span
        style={{
          ...movementTypePill,
          background: isIn ? 'rgba(74,140,92,0.12)' : 'rgba(196,80,64,0.10)',
          color: isIn ? 'var(--green)' : 'var(--red)',
        }}
      >
        {isIn ? t('admin.cashLog.filter.in') : t('admin.cashLog.filter.out')}
      </span>
      <span
        style={{
          ...movementAmount,
          color: isIn ? 'var(--green)' : 'var(--red)',
        }}
      >
        {isIn ? '+' : '−'}
        {formatMoneyPlain(movement.amount)}
      </span>
      <span style={movementReason}>{movement.reason}</span>
      <button
        type="button"
        style={{
          ...movementEditBtn,
          opacity: canMutate ? 1 : 0.4,
          cursor: canMutate ? 'pointer' : 'not-allowed',
        }}
        disabled={!canMutate}
        onClick={onEdit}
      >
        {t('common.edit')}
      </button>
    </div>
  );
}

// ─── Edit row ────────────────────────────────────────────────────────

interface EditMovementRowProps {
  registerId: string;
  movement: CashMovementRow;
  onCancel: () => void;
  onSaved: () => void;
  onDeleted: () => void;
}

function EditMovementRow({
  registerId,
  movement,
  onCancel,
  onSaved,
  onDeleted,
}: EditMovementRowProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<CashMovementType>(movement.type);
  const [amount, setAmount] = useState(centsToInputString(movement.amount));
  const [reason, setReason] = useState(movement.reason);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const saveMutation = useMutation({
    mutationFn: () => {
      const cents = parseAmountInput(amount);
      if (cents === null) {
        throw new ApiError(t('admin.cashLog.errors.amount'), 400);
      }
      if (reason.trim().length === 0) {
        throw new ApiError(t('admin.cashLog.errors.reason'), 400);
      }
      return updateCashMovement(registerId, movement.id, {
        type,
        amount: cents,
        reason: reason.trim(),
      });
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : t('cashMovement.failed'),
      ),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteCashMovement(registerId, movement.id),
    onSuccess: onDeleted,
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : t('cashMovement.failed'),
      ),
  });

  const busy = saveMutation.isPending || deleteMutation.isPending;

  return (
    <div style={editRowStyle}>
      <div style={editControls}>
        <div style={editTypeToggle}>
          {(
            [
              ['CASH_IN', 'admin.cashLog.filter.in', 'var(--green)'],
              ['CASH_OUT', 'admin.cashLog.filter.out', 'var(--red)'],
            ] as const
          ).map(([key, labelKey, color]) => (
            <button
              key={key}
              type="button"
              style={{
                ...editTypeBtn,
                ...(type === key
                  ? { background: color, color: '#fff', borderColor: color }
                  : null),
              }}
              onClick={() => setType(key)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <input
          type="text"
          inputMode="decimal"
          style={editAmountInput}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <input
          type="text"
          style={editReasonInput}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={t('admin.cashLog.editor.reasonPlaceholder')}
        />
      </div>
      <div style={editActions}>
        {confirmDelete ? (
          <>
            <button
              type="button"
              style={editConfirmDelBtn}
              disabled={busy}
              onClick={() => deleteMutation.mutate()}
            >
              {busy && deleteMutation.isPending ? <Spinner size={12} /> : null}
              {t('admin.cashLog.editor.confirmDelete')}
            </button>
            <button
              type="button"
              style={editGhostBtn}
              onClick={() => setConfirmDelete(false)}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              style={editDeleteBtn}
              onClick={() => setConfirmDelete(true)}
              disabled={busy}
            >
              {t('common.delete')}
            </button>
            <button
              type="button"
              style={editGhostBtn}
              onClick={onCancel}
              disabled={busy}
            >
              {t('common.cancel')}
            </button>
            <button
              type="button"
              style={editSaveBtn}
              onClick={() => saveMutation.mutate()}
              disabled={busy}
            >
              {busy && saveMutation.isPending ? <Spinner size={12} /> : null}
              {t('common.save')}
            </button>
          </>
        )}
      </div>
      {error && <div style={editError}>{error}</div>}
    </div>
  );
}

// ─── New movement row ────────────────────────────────────────────────

interface NewMovementRowProps {
  registerId: string;
  onCancel: () => void;
  onSaved: () => void;
}

function NewMovementRow({ registerId, onCancel, onSaved }: NewMovementRowProps) {
  const { t } = useTranslation();
  const [type, setType] = useState<CashMovementType>('CASH_OUT');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const mutation = useMutation({
    mutationFn: () => {
      const cents = parseAmountInput(amount);
      if (cents === null) {
        throw new ApiError(t('admin.cashLog.errors.amount'), 400);
      }
      if (reason.trim().length === 0) {
        throw new ApiError(t('admin.cashLog.errors.reason'), 400);
      }
      return createCashMovement(registerId, {
        type,
        amount: cents,
        reason: reason.trim(),
      });
    },
    onSuccess: onSaved,
    onError: (err) =>
      setError(
        err instanceof ApiError ? err.message : t('cashMovement.failed'),
      ),
  });

  return (
    <div style={editRowStyle}>
      <div style={editControls}>
        <div style={editTypeToggle}>
          {(
            [
              ['CASH_IN', 'admin.cashLog.filter.in', 'var(--green)'],
              ['CASH_OUT', 'admin.cashLog.filter.out', 'var(--red)'],
            ] as const
          ).map(([key, labelKey, color]) => (
            <button
              key={key}
              type="button"
              style={{
                ...editTypeBtn,
                ...(type === key
                  ? { background: color, color: '#fff', borderColor: color }
                  : null),
              }}
              onClick={() => setType(key)}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
        <input
          type="text"
          inputMode="decimal"
          style={editAmountInput}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          autoFocus
        />
        <input
          type="text"
          style={editReasonInput}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          placeholder={t('admin.cashLog.editor.reasonPlaceholder')}
        />
      </div>
      <div style={editActions}>
        <button
          type="button"
          style={editGhostBtn}
          onClick={onCancel}
          disabled={mutation.isPending}
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          style={editSaveBtn}
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending}
        >
          {mutation.isPending && <Spinner size={12} />}
          {t('common.save')}
        </button>
      </div>
      {error && <div style={editError}>{error}</div>}
    </div>
  );
}

// ─── Local styles ──────────────────────────────────────────────────

const emptyState: React.CSSProperties = {
  padding: '40px 20px',
  textAlign: 'center',
  color: 'var(--text3)',
  fontSize: 13,
};

const daysStack: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
};

const dayCard: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  overflow: 'hidden',
  boxShadow: 'var(--shadow-sm)',
};

const dayHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  padding: '14px 18px',
  background: 'var(--bg)',
  borderBottom: '1px solid var(--border)',
  cursor: 'pointer',
  border: 'none',
  width: '100%',
  fontFamily: 'inherit',
  textAlign: 'left',
};

const dayChevron: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  width: 14,
  display: 'inline-block',
};

const dayTitle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 18,
  fontWeight: 600,
  color: 'var(--text1)',
};

const dayMetaPill: React.CSSProperties = {
  fontSize: 11,
  padding: '3px 10px',
  borderRadius: 999,
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  fontWeight: 600,
  letterSpacing: '0.04em',
};

const dayShiftsPill: React.CSSProperties = {
  ...dayMetaPill,
  background: 'rgba(201,164,92,0.14)',
  color: '#8a6d2a',
};

const dayTotals: React.CSSProperties = {
  marginLeft: 'auto',
  display: 'flex',
  gap: 14,
  fontVariantNumeric: 'tabular-nums',
  fontSize: 13,
};

const dayBody: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const shiftBlock: React.CSSProperties = {
  borderBottom: '1px solid var(--border)',
};

const shiftHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 18px 6px',
};

const shiftHeaderLeft: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  flexWrap: 'wrap',
};

const shiftHeaderRight: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const shiftPersonName: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text1)',
};

const shiftWindow: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
};

const shiftStatusPill: React.CSSProperties = {
  display: 'inline-flex',
  padding: '2px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const shiftStatusOpen: React.CSSProperties = {
  background: 'rgba(74,140,92,0.16)',
  color: 'var(--green)',
};

const shiftStatusClosed: React.CSSProperties = {
  background: 'rgba(168,152,136,0.18)',
  color: 'var(--text2)',
};

const shiftProvisionalPill: React.CSSProperties = {
  display: 'inline-flex',
  padding: '2px 9px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  background: 'rgba(201,164,92,0.18)',
  color: '#8a6d2a',
};

const shiftTotalsBlock: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const shiftTotalsSep: React.CSSProperties = {
  color: 'var(--text3)',
};

const shiftAddBtn: React.CSSProperties = {
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  padding: '6px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const shiftMetaStrip: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 18,
  padding: '6px 18px 12px',
  fontVariantNumeric: 'tabular-nums',
};

const shiftMetaCell: React.CSSProperties = {
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 1,
};

const shiftMetaLabel: React.CSSProperties = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--text3)',
  fontWeight: 600,
};

const shiftMetaValue: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text1)',
  fontWeight: 600,
};

const shiftEmpty: React.CSSProperties = {
  padding: '14px 18px 18px',
  color: 'var(--text3)',
  fontSize: 12,
  fontStyle: 'italic',
};

const movementsList: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  padding: '0 18px 14px',
  gap: 4,
};

const movementRowStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '90px 80px 110px 1fr 70px',
  gap: 12,
  alignItems: 'center',
  padding: '8px 12px',
  borderRadius: 8,
  background: 'var(--bg)',
  fontSize: 13,
  fontVariantNumeric: 'tabular-nums',
};

const movementTime: React.CSSProperties = {
  color: 'var(--text2)',
  fontSize: 12,
};

const movementTypePill: React.CSSProperties = {
  display: 'inline-flex',
  justifyContent: 'center',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
};

const movementAmount: React.CSSProperties = {
  textAlign: 'right',
  fontWeight: 600,
};

const movementReason: React.CSSProperties = {
  color: 'var(--text1)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const movementEditBtn: React.CSSProperties = {
  justifySelf: 'end',
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  padding: '4px 10px',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  fontFamily: 'inherit',
};

const editRowStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
  padding: '12px 14px',
  margin: '4px 0',
  background: 'rgba(201,164,92,0.08)',
  border: '1px solid rgba(201,164,92,0.30)',
  borderRadius: 10,
};

const editControls: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 120px 1fr',
  gap: 10,
  alignItems: 'center',
};

const editTypeToggle: React.CSSProperties = {
  display: 'inline-flex',
  borderRadius: 8,
  overflow: 'hidden',
  border: '1px solid var(--border)',
};

const editTypeBtn: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  fontWeight: 600,
  background: 'var(--bg2)',
  color: 'var(--text2)',
  border: 'none',
  borderRight: '1px solid var(--border)',
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const editAmountInput: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  fontSize: 13,
  fontFamily: 'inherit',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const editReasonInput: React.CSSProperties = {
  padding: '7px 10px',
  borderRadius: 6,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  fontSize: 13,
  fontFamily: 'inherit',
};

const editActions: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  justifyContent: 'flex-end',
};

const editSaveBtn: React.CSSProperties = {
  padding: '7px 14px',
  borderRadius: 6,
  background: 'var(--text1)',
  border: '1px solid var(--text1)',
  color: '#fff',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const editGhostBtn: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 6,
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  color: 'var(--text2)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const editDeleteBtn: React.CSSProperties = {
  padding: '7px 12px',
  borderRadius: 6,
  background: 'transparent',
  border: '1px solid rgba(196,80,64,0.4)',
  color: 'var(--red)',
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
  marginRight: 'auto',
};

const editConfirmDelBtn: React.CSSProperties = {
  ...editDeleteBtn,
  marginRight: 'auto',
  background: 'var(--red)',
  borderColor: 'var(--red)',
  color: '#fff',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
};

const editError: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--red)',
  background: 'rgba(196,80,64,0.08)',
  border: '1px solid rgba(196,80,64,0.25)',
  padding: '6px 10px',
  borderRadius: 6,
};
