import { useQuery } from '@tanstack/react-query';
import { fetchOpenRegister, openRegister } from '../api/registers';
import { useSession } from '../store/session';
import { confirmDialog } from './ConfirmDialog';
import { useTranslation, t as tStatic } from '../i18n';

// Roles that can open or close their own register from the terminal. Waiters
// and baristas don't have a personal register — orders they create attach to a
// cashier's open register, which they don't own.
const ROLES_WITH_REGISTER: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

interface ShiftPillProps {
  onClick: () => void;
}

const styles: Record<string, React.CSSProperties> = {
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 14px',
    borderRadius: 999,
    background: 'rgba(232,221,208,0.08)',
    color: '#e8ddd0',
    border: '1px solid rgba(232,221,208,0.12)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 36,
    fontFamily: 'inherit',
    whiteSpace: 'nowrap',
  },
  pillDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    flexShrink: 0,
  },
};

// ─── Top-bar pill ──────────────────────────────────────────────────────────
// Renders the cashier's entry point to the Operations Hub. The pill keeps a
// status dot showing shift open/closed at a glance — green = open, red =
// closed, gray = checking — but the click target now opens the multi-feature
// hub instead of just the shift modal.

export function OperationsPill({ onClick }: ShiftPillProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const canManage = ROLES_WITH_REGISTER.has(role);

  // Skip the network entirely for waiters/baristas — the hub is cashier-only
  // and showing a perpetual closed pill is misleading.
  const enabled = canManage && Boolean(userId);

  const { data, isLoading } = useQuery({
    queryKey: ['register', 'open', userId],
    queryFn: () => fetchOpenRegister(userId!),
    enabled,
    staleTime: 30_000,
  });

  if (!enabled) return null;

  const isOpen = Boolean(data);
  const dotColor = isLoading
    ? 'var(--text3)'
    : isOpen
      ? 'var(--green)'
      : 'var(--red)';

  return (
    <button type="button" style={styles.pill} onClick={onClick}>
      <span style={{ ...styles.pillDot, background: dotColor }} />
      <span>{t('topbar.operations')}</span>
    </button>
  );
}

// The old ShiftManagerModal lives at terminal/src/components/operations-hub/
// ShiftActionPanel.tsx — same logic, now mounted as a child of the
// Operations Hub. The pill above is the only export this file needs.

// Shared confirm helper exported for callers that want a one-click open with
// $0 / default amount. Currently unused; left in for future "quick open" UX.
export async function confirmAndOpenShift(): Promise<boolean> {
  const ok = await confirmDialog({
    title: tStatic('register.openShiftZero'),
    message: tStatic('register.openShiftZeroSub'),
    confirmLabel: tStatic('register.openShift'),
  });
  if (!ok) return false;
  await openRegister({ opening_amount: 0 });
  return true;
}
