import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addCashMovement,
  closeRegister,
  getRegister,
  openRegister,
} from '../api/registers';
import { useOpenRegister } from '../hooks/useOpenRegister';
import {
  ROLE_CAN_RUN_REGISTER,
  useSessionStore,
  defaultPathForRole,
} from '../store/session';
import { useToastStore } from '../store/toast';
import { ApiError } from '../api/client';
import { formatMoney, relativeTime } from '../utils/format';
import { Numpad } from '../components/ui/Numpad';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import type { CashMovementType, CashRegister } from '../types/api';

type NumpadMode =
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'movement'; type: CashMovementType };

/**
 * Register / shift management screen. Cashier-only. Three phases:
 *  - No open register  → "Open shift" with opening-amount numpad
 *  - Open register     → summary card, cash in/out, close button
 *  - Closing           → actual-count numpad, shows expected vs counted diff
 */
export function RegisterPage() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);

  const openRegisterQuery = useOpenRegister();

  // ── Role gate ──────────────────────────────────────────────────────
  if (!user) return null;
  if (!ROLE_CAN_RUN_REGISTER.includes(user.role)) {
    return (
      <div className="empty">
        <div className="icon">🔒</div>
        <div className="title">Cashier access required</div>
        <div>Only cashiers and admins can manage the cash register.</div>
        <button
          type="button"
          className="btn btn-ghost btn-lg"
          onClick={() => navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </div>
    );
  }

  const register = openRegisterQuery.data;

  if (openRegisterQuery.isLoading) {
    return (
      <div className="empty">
        <div className="title">Loading register…</div>
      </div>
    );
  }

  return register ? (
    <ActiveShift register={register} />
  ) : (
    <OpenShiftForm />
  );
}

// ── No open shift: capture opening amount and create a register. ────

function OpenShiftForm() {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [openingCentavos, setOpeningCentavos] = useState(0);

  const openMutation = useMutation({
    mutationFn: () => openRegister(openingCentavos),
    onSuccess: (register) => {
      queryClient.setQueryData(['register', 'open', user?.id], register);
      queryClient.invalidateQueries({ queryKey: ['register'] });
      pushToast(`Shift opened with ${formatMoney(register.opening_amount)}`, 'success');
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not open shift';
      pushToast(msg, 'error');
    },
  });

  return (
    <div className="register-page">
      <header className="register-head">
        <div className="title">
          <div className="crumb">Cash Register</div>
          <h1>Open Shift</h1>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => user && navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </header>

      <div className="register-card">
        <div className="big-amount">
          <span className="label">Opening amount</span>
          <span className="value">{formatMoney(openingCentavos)}</span>
          <span className="hint">
            Count the cash already in the drawer before the shift begins.
          </span>
        </div>

        <Numpad
          onDigit={(d) => {
            const next = openingCentavos * 10 + Number(d);
            if (next > 100_000_00) return;
            setOpeningCentavos(next);
          }}
          onBackspace={() => setOpeningCentavos((v) => Math.floor(v / 10))}
          onClear={() => setOpeningCentavos(0)}
          disabled={openMutation.isPending}
        />

        <button
          type="button"
          className="btn btn-primary btn-xl btn-block"
          disabled={openMutation.isPending}
          onClick={() => openMutation.mutate()}
        >
          {openMutation.isPending ? 'Opening…' : 'Open Shift'}
        </button>
      </div>
    </div>
  );
}

// ── Open shift: summary, cash in/out, close. ────────────────────────

interface ActiveShiftProps {
  register: CashRegister;
}

function ActiveShift({ register }: ActiveShiftProps) {
  const navigate = useNavigate();
  const user = useSessionStore((s) => s.user);
  const queryClient = useQueryClient();
  const pushToast = useToastStore((s) => s.push);
  const [numpadMode, setNumpadMode] = useState<NumpadMode | null>(null);
  const [numpadCentavos, setNumpadCentavos] = useState(0);
  const [movementReason, setMovementReason] = useState('');
  // Two-step close: first numpad captures the count, then a confirm dialog
  // forces the cashier to acknowledge the diff before firing the API.
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);

  // Poll the detailed register every 15s so the expected_amount and movements
  // stay current with other terminals' payments against the same register.
  const detailQuery = useQuery({
    queryKey: ['register', register.id],
    queryFn: () => getRegister(register.id),
    initialData: register,
    refetchInterval: 15_000,
  });
  const live: CashRegister = detailQuery.data ?? register;

  // Clock counter so "elapsed" updates once a minute without shifting focus.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const inCount = useMemo(
    () => (live.cash_movements ?? []).filter((m) => m.type === 'CASH_IN').length,
    [live.cash_movements],
  );
  const outCount = useMemo(
    () => (live.cash_movements ?? []).filter((m) => m.type === 'CASH_OUT').length,
    [live.cash_movements],
  );

  const movementMutation = useMutation({
    mutationFn: (input: { type: CashMovementType; amount: number; reason: string }) =>
      addCashMovement(register.id, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['register', register.id] });
      queryClient.invalidateQueries({ queryKey: ['register', 'open'] });
      pushToast('Cash movement recorded', 'success');
      closeNumpad();
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not record movement';
      pushToast(msg, 'error');
    },
  });

  const closeMutation = useMutation({
    mutationFn: () => closeRegister(register.id, { actual_amount: numpadCentavos }),
    onSuccess: (closed) => {
      queryClient.setQueryData(['register', register.id], closed);
      queryClient.invalidateQueries({ queryKey: ['register'] });
      const diff = Number(closed.difference ?? 0);
      if (diff === 0) {
        pushToast('Shift closed · drawer matches expected', 'success');
      } else {
        pushToast(
          `Shift closed · ${diff > 0 ? 'over' : 'short'} by ${formatMoney(Math.abs(diff))}`,
          diff < 0 ? 'error' : 'info',
        );
      }
      setCloseConfirmOpen(false);
      closeNumpad();
      if (user) navigate(defaultPathForRole(user.role));
    },
    onError: (err) => {
      const msg = err instanceof ApiError ? err.message : 'Could not close shift';
      pushToast(msg, 'error');
    },
  });

  // Escape returns to the default screen when no modal is open. Enter is
  // handled inside the numpad modal via onConfirm.
  useKeyboardShortcut(
    'Escape',
    numpadMode || closeConfirmOpen
      ? null
      : () => {
          if (user) navigate(defaultPathForRole(user.role));
        },
  );

  function openNumpad(mode: NumpadMode) {
    setNumpadMode(mode);
    // Prefill the expected amount when closing so the cashier only adjusts the
    // delta if their count matches. Start blank for in/out so they don't click
    // "confirm" on a stale amount.
    setNumpadCentavos(mode.kind === 'close' ? Number(live.expected_amount) : 0);
    setMovementReason('');
  }
  function closeNumpad() {
    setNumpadMode(null);
    setNumpadCentavos(0);
    setMovementReason('');
  }

  const expected = Number(live.expected_amount);
  const actual = numpadCentavos;
  const diff = actual - expected;

  function onConfirm() {
    if (!numpadMode) return;
    if (numpadMode.kind === 'close') {
      // Instead of firing the API immediately, surface a confirmation so the
      // cashier sees the diff and acknowledges it — closing a shift is not
      // reversible from the terminal.
      setCloseConfirmOpen(true);
      return;
    }
    if (numpadMode.kind === 'movement') {
      if (!movementReason.trim()) {
        pushToast('Enter a reason for the movement', 'error');
        return;
      }
      if (numpadCentavos <= 0) {
        pushToast('Amount must be greater than zero', 'error');
        return;
      }
      movementMutation.mutate({
        type: numpadMode.type,
        amount: numpadCentavos,
        reason: movementReason.trim(),
      });
    }
  }

  return (
    <div className="register-page">
      <header className="register-head">
        <div className="title">
          <div className="crumb">Cash Register</div>
          <h1>Current Shift</h1>
        </div>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={() => user && navigate(defaultPathForRole(user.role))}
        >
          Back
        </button>
      </header>

      <div className="register-grid">
        <div className="register-card">
          <div className="register-stats">
            <Stat label="Opened" value={relativeTime(live.opened_at)} note={new Date(live.opened_at).toLocaleString()} />
            <Stat label="Opening" value={formatMoney(live.opening_amount)} accent />
            <Stat label="Expected" value={formatMoney(live.expected_amount)} accent />
            <Stat
              label="Cash movements"
              value={`${inCount + outCount}`}
              note={`${inCount} in · ${outCount} out`}
            />
          </div>

          <div className="elapsed">
            Shift running for {relativeTime(live.opened_at)}
            <span className="text-mute"> · updated {relativeTime(new Date(now).toISOString())}</span>
          </div>

          <div className="register-actions">
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => openNumpad({ kind: 'movement', type: 'CASH_IN' })}
            >
              + Cash In
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-lg"
              onClick={() => openNumpad({ kind: 'movement', type: 'CASH_OUT' })}
            >
              − Cash Out
            </button>
            <button
              type="button"
              className="btn btn-danger btn-lg"
              onClick={() => openNumpad({ kind: 'close' })}
            >
              Close Shift
            </button>
          </div>
        </div>

        <div className="register-card movements-card">
          <h3>Cash movements</h3>
          {(live.cash_movements ?? []).length === 0 ? (
            <div className="empty-mini">No cash movements yet this shift.</div>
          ) : (
            <div className="movement-list">
              {[...(live.cash_movements ?? [])]
                .slice()
                .reverse()
                .map((m) => (
                  <div key={m.id} className="movement-row">
                    <span className={`tag ${m.type === 'CASH_IN' ? 'in' : 'out'}`}>
                      {m.type === 'CASH_IN' ? 'IN' : 'OUT'}
                    </span>
                    <span className="reason">{m.reason}</span>
                    <span className="amount">
                      {m.type === 'CASH_IN' ? '+' : '−'}
                      {formatMoney(m.amount)}
                    </span>
                    <span className="when text-mute">{relativeTime(m.created_at)}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {numpadMode && (
        <div className="modal-overlay" onClick={closeNumpad}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>
                {numpadMode.kind === 'close'
                  ? 'Close Shift'
                  : numpadMode.kind === 'movement' && numpadMode.type === 'CASH_IN'
                    ? 'Cash In'
                    : 'Cash Out'}
              </h2>
              <button type="button" className="btn-icon modal-close" onClick={closeNumpad}>
                ✕
              </button>
            </div>

            <div className="modal-body" style={{ alignItems: 'center' }}>
              <div className="big-amount">
                <span className="label">
                  {numpadMode.kind === 'close' ? 'Counted amount' : 'Amount'}
                </span>
                <span className="value">{formatMoney(numpadCentavos)}</span>
                {numpadMode.kind === 'close' && (
                  <span className="hint">
                    Count every bill and coin in the drawer. Expected:{' '}
                    <b>{formatMoney(expected)}</b>
                  </span>
                )}
              </div>

              {numpadMode.kind === 'movement' && (
                <label className="ref-field" style={{ width: 320 }}>
                  <span>Reason</span>
                  <input
                    type="text"
                    value={movementReason}
                    onChange={(e) => setMovementReason(e.target.value)}
                    placeholder={
                      numpadMode.type === 'CASH_IN'
                        ? 'Tips, owner deposit, …'
                        : 'Petty cash, bank drop, …'
                    }
                    maxLength={500}
                  />
                </label>
              )}

              <Numpad
                onDigit={(d) => {
                  const next = numpadCentavos * 10 + Number(d);
                  if (next > 100_000_00) return;
                  setNumpadCentavos(next);
                }}
                onBackspace={() => setNumpadCentavos((v) => Math.floor(v / 10))}
                onClear={() => setNumpadCentavos(0)}
                disabled={closeMutation.isPending || movementMutation.isPending}
              />

              {numpadMode.kind === 'close' && (
                <div className="diff-row">
                  <span>Difference</span>
                  <span className={diff === 0 ? '' : diff > 0 ? 'text-green' : 'text-red'}>
                    {diff === 0 ? formatMoney(0) : `${diff > 0 ? '+' : ''}${formatMoney(diff)}`}
                  </span>
                </div>
              )}
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost btn-lg"
                onClick={closeNumpad}
                disabled={closeMutation.isPending || movementMutation.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary btn-lg"
                onClick={onConfirm}
                disabled={
                  closeMutation.isPending ||
                  movementMutation.isPending ||
                  (numpadMode.kind === 'movement' && numpadCentavos <= 0)
                }
              >
                {numpadMode.kind === 'close'
                  ? 'Review Close'
                  : movementMutation.isPending
                    ? 'Saving…'
                    : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={closeConfirmOpen}
        title="Close this shift?"
        message={
          diff === 0
            ? `Counted ${formatMoney(numpadCentavos)} matches expected. Closing the shift ` +
              `ends this register and cannot be undone.`
            : `Counted ${formatMoney(numpadCentavos)} vs expected ${formatMoney(expected)} — ` +
              `${diff > 0 ? 'over' : 'short'} by ${formatMoney(Math.abs(diff))}. ` +
              `Closing the shift records this difference and cannot be undone.`
        }
        confirmLabel="Close shift"
        cancelLabel="Back"
        tone={diff < 0 ? 'danger' : 'default'}
        busy={closeMutation.isPending}
        onConfirm={() => closeMutation.mutate()}
        onCancel={() => setCloseConfirmOpen(false)}
      />
    </div>
  );
}

// ── Small stat cell used in the shift header. Value is the big line,
//    note an optional dim line below (e.g. "13 Apr · 09:12").
function Stat({
  label,
  value,
  note,
  accent,
}: {
  label: string;
  value: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div className={`stat ${accent ? 'accent' : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}
