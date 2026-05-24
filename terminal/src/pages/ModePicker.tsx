import { useSession } from '../store/session';
import { useUi } from '../store/ui';
import type { AuthUser } from '../api/auth';
import { useHaptics } from '../hooks/useHaptics';
import { useTranslation } from '../i18n';

interface Props {
  token: string;
  user: AuthUser;
}

const tileStyle = (busy: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 10,
  padding: '24px 22px',
  minHeight: 180,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  cursor: busy ? 'not-allowed' : 'pointer',
  opacity: busy ? 0.55 : 1,
  transition: 'all 0.15s',
  textAlign: 'left',
  fontFamily: 'inherit',
});

const tileBadgeStyle = (variant: 'pos' | 'admin'): React.CSSProperties => ({
  width: 44,
  height: 44,
  borderRadius: 10,
  background: variant === 'pos' ? 'var(--green)' : 'var(--gold)',
  color: variant === 'pos' ? '#fff' : '#2c2420',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 700,
});

const styles: Record<string, React.CSSProperties> = {
  root: {
    flex: 1,
    minHeight: 0,
    width: '100%',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: 720,
    maxWidth: '100%',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 18,
    boxShadow: 'var(--shadow-lg)',
    padding: '40px 40px 32px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 24,
  },
  brand: {
    width: 56,
    height: 56,
    borderRadius: 12,
    background: 'linear-gradient(135deg, #c9a45c 0%, #a8843f 100%)',
    color: '#2c2420',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 26,
    fontWeight: 700,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
    textAlign: 'center',
  },
  sub: {
    fontSize: 14,
    color: 'var(--text2)',
    margin: 0,
    textAlign: 'center',
  },
  greeting: {
    fontSize: 13,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  tiles: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    width: '100%',
  },
  tileTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  tileDesc: {
    fontSize: 13,
    color: 'var(--text2)',
    lineHeight: 1.4,
  },
  error: {
    fontSize: 12,
    color: 'var(--red)',
    fontWeight: 500,
    textAlign: 'center',
    minHeight: 16,
  },
  footer: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    paddingTop: 12,
    borderTop: '1px solid var(--border)',
  },
  footerText: {
    fontSize: 12,
    color: 'var(--text3)',
  },
  ghostBtn: {
    padding: '8px 14px',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--text2)',
    fontSize: 12,
    fontWeight: 500,
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
};

// Shown after a MANAGER/ADMIN signs in via PIN. The operator picks between
// running this device as a POS terminal (the existing flow) or popping the
// admin panel for back-office work. The PIN session is held in a parent ref
// until they choose — committing only after the pick keeps Settings, register
// gates, and auto-lock from kicking in while the operator is still on this
// screen.
export function ModePicker({ token, user }: Props) {
  const { t } = useTranslation();
  const signIn = useSession((s) => s.signIn);
  const haptics = useHaptics();
  function pickPos() {
    haptics.success();
    signIn(token, user);
  }

  function pickAdmin() {
    haptics.success();
    // The previous flow popped a separate admin-web window via the platform
    // bridge. We now stay inside the terminal and route to the in-app Admin
    // Mode launcher, which lives at view === 'admin' in useUi.
    signIn(token, user);
    useUi.getState().openAdmin();
  }

  return (
    <div style={styles.root}>
      <div style={styles.card}>
        <div style={styles.brand}>R</div>
        <div style={styles.greeting}>{t('modePicker.greeting')} · {user.name}</div>
        <h1 style={styles.title}>{t('modePicker.title')}</h1>
        <p style={styles.sub}>{t('modePicker.sub')}</p>

        <div style={styles.tiles}>
          <button type="button" style={tileStyle(false)} onClick={pickPos}>
            <div style={tileBadgeStyle('pos')}>P</div>
            <div style={styles.tileTitle}>{t('modePicker.posMode')}</div>
            <div style={styles.tileDesc}>{t('modePicker.posDesc')}</div>
          </button>
          <button type="button" style={tileStyle(false)} onClick={pickAdmin}>
            <div style={tileBadgeStyle('admin')}>A</div>
            <div style={styles.tileTitle}>{t('modePicker.adminMode')}</div>
            <div style={styles.tileDesc}>{t('modePicker.adminDesc')}</div>
          </button>
        </div>

        <div style={styles.footer}>
          <span style={styles.footerText}>{t('modePicker.roleLabel')}: {user.role}</span>
          <button
            type="button"
            style={styles.ghostBtn}
            onClick={() => {
              haptics.tap();
              useSession.getState().signOut();
            }}
          >
            {t('nav.signOut')}
          </button>
        </div>
      </div>
    </div>
  );
}
