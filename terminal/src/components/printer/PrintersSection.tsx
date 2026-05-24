import { useTranslation } from '../../i18n';
import { useUi } from '../../store/ui';
import { usePrinterProfiles } from '../../hooks/usePrinterProfiles';

export function PrintersSection() {
  const { t } = useTranslation();
  const closeSettings = useUi((s) => s.closeSettings);
  const setView = useUi((s) => s.setView);
  const profilesQuery = usePrinterProfiles();

  const count = profilesQuery.data?.length ?? 0;

  return (
    <div style={root}>
      <div style={card}>
        <div style={{ fontSize: 28, marginBottom: 10 }}>🖨</div>
        <h3 style={title}>{t('printers.pageTitle')}</h3>
        <p style={desc}>
          {count > 0
            ? t('printers.profileCount').replace('{n}', String(count))
            : t('printers.emptyState')}
        </p>
        <button
          type="button"
          style={openBtn}
          onClick={() => { closeSettings(); setView('printers'); }}
        >
          {t('printers.openPage')}
        </button>
      </div>
    </div>
  );
}

const root: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: 200,
};

const card: React.CSSProperties = {
  textAlign: 'center',
  padding: '40px 32px',
};

const title: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: '0 0 6px',
};

const desc: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text3)',
  margin: '0 0 16px',
};

const openBtn: React.CSSProperties = {
  padding: '12px 24px',
  borderRadius: 8,
  background: 'var(--gold)',
  color: '#2c2420',
  fontSize: 14,
  fontWeight: 600,
  border: '1px solid rgba(44,36,32,0.08)',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 44,
};
