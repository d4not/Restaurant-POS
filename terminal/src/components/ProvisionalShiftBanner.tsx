import type { CashRegisterRow } from '../api/registers';
import { useTranslation } from '../i18n';

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '8px 16px',
    background: 'rgba(201,164,92,0.18)',
    color: '#5a4115',
    borderBottom: '1px solid rgba(201,164,92,0.45)',
    fontSize: 12,
    fontWeight: 500,
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 9px',
    borderRadius: 999,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    flexShrink: 0,
  },
  text: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontWeight: 700,
    color: '#3d2c12',
  },
  sub: {
    color: '#7a5a30',
    marginLeft: 8,
  },
};

interface ProvisionalShiftBannerProps {
  register: CashRegisterRow;
}

// Shown above the topbar whenever the active shift is PROVISIONAL. Reminds
// the room (any role) that a cashier still needs to count cash and start a
// normal shift.
export function ProvisionalShiftBanner({ register }: ProvisionalShiftBannerProps) {
  const { t } = useTranslation();
  const openedBy = t('register.openedBy').replace('{name}', register.user.name);
  return (
    <div style={styles.root}>
      <span style={styles.badge}>{t('register.provisionalBadge')}</span>
      <div style={styles.text}>
        <span style={styles.title}>{t('register.provisionalBanner')}</span>
        <span style={styles.sub}>{openedBy} · {t('register.provisionalBannerSub')}</span>
      </div>
    </div>
  );
}
