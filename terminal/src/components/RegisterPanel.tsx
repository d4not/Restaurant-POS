import { useQuery } from '@tanstack/react-query';
import { fetchCurrentRegister, openRegister } from '../api/registers';
import { useSession } from '../store/session';
import { confirmDialog } from './ConfirmDialog';
import { useTranslation, t as tStatic } from '../i18n';

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
  pillProvisional: {
    background: 'rgba(201,164,92,0.18)',
    border: '1px solid rgba(201,164,92,0.45)',
    color: '#f0d9a4',
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
// status dot showing shift open/closed at a glance — green = normal open,
// gold = provisional open (cashier needs to reconcile), red = closed,
// gray = checking — but the click target now opens the multi-feature hub.

export function OperationsPill({ onClick }: ShiftPillProps) {
  const { t } = useTranslation();
  const userId = useSession((s) => s.user?.id ?? null);

  // Always rendered while authed — every role uses the hub for at least
  // transfers and printer diagnostics. Cashier-only actions inside the hub
  // gate themselves.
  const { data, isLoading } = useQuery({
    queryKey: ['register', 'current'],
    queryFn: fetchCurrentRegister,
    enabled: Boolean(userId),
    staleTime: 15_000,
  });

  if (!userId) return null;

  const isOpen = Boolean(data);
  const isProvisional = data?.kind === 'PROVISIONAL';
  const dotColor = isLoading
    ? 'var(--text3)'
    : isProvisional
      ? 'var(--gold)'
      : isOpen
        ? 'var(--green)'
        : 'var(--red)';

  return (
    <button
      type="button"
      style={{
        ...styles.pill,
        ...(isProvisional ? styles.pillProvisional : null),
      }}
      onClick={onClick}
    >
      <span style={{ ...styles.pillDot, background: dotColor }} />
      <span>
        {isProvisional ? t('register.provisionalBadge') : t('topbar.operations')}
      </span>
    </button>
  );
}

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
