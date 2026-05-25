import { useState } from 'react';
import { useTranslation } from '../../i18n';
import { useTestProfile } from '../../hooks/usePrinterProfiles';
import { Spinner } from '../Spinner';
import type { PrinterProfile } from '../../api/printer-profiles';
import { ps, statusDotStyle } from './styles';

interface Props {
  profile: PrinterProfile;
  connected: boolean | null;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

export function PrinterProfileCard({ profile, connected, canEdit, onEdit, onDelete }: Props) {
  const { t } = useTranslation();
  const testMut = useTestProfile();
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);

  const roles: string[] = [];
  if (profile.prints_comandas) roles.push(t('printers.comandas'));
  if (profile.prints_receipts) roles.push(t('printers.receipts'));

  const connLabel = profile.connection_type === 'USB' ? 'USB' : 'Network';
  const widthLabel = profile.paper_width === 32 ? '58mm' : profile.paper_width === 42 ? '76mm' : '80mm';

  async function handleTest() {
    setTestResult(null);
    const res = await testMut.mutateAsync(profile.id);
    setTestResult(res);
  }

  return (
    <div style={cardStyle}>
      {/* Header */}
      <div style={cardHead}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={statusDotStyle(profile.address ? connected : null)} />
          <h3 style={cardName}>{profile.name}</h3>
        </div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 6 }}>
            <button type="button" style={ps.ghostBtn} onClick={onEdit}>
              {t('common.edit')}
            </button>
            <button type="button" style={deleteBtn} onClick={onDelete}>
              ×
            </button>
          </div>
        )}
      </div>

      {/* Roles + hardware */}
      <div style={metaRow}>
        <span style={roleChip}>{roles.join(' · ') || '—'}</span>
        {profile.address && (
          <span style={addrLabel}>
            {connLabel} · {profile.address} · {widthLabel}
          </span>
        )}
        {!profile.address && <span style={addrLabel}>{t('printers.noAddress')}</span>}
      </div>

      {/* Template indicator */}
      {(profile.comanda_template || profile.receipt_template) && (
        <span style={templateBadge}>
          {t('printers.templateCustomized')}
        </span>
      )}

      {/* Categories */}
      {profile.categories.length > 0 && (
        <div style={catRow}>
          {profile.categories.map((cat) => (
            <span key={cat.id} style={catChip(cat.color)}>
              {cat.name}
            </span>
          ))}
        </div>
      )}
      {profile.categories.length === 0 && (
        <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' }}>
          {t('printers.noCategories')}
        </div>
      )}

      {/* Test print */}
      <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button
          type="button"
          style={ps.goldBtn}
          onClick={handleTest}
          disabled={testMut.isPending || !profile.address}
        >
          {testMut.isPending ? <Spinner size={11} /> : '🖨'} {t('printers.testPrint')}
        </button>
        {testResult && (
          <span style={{ fontSize: 11, color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>
            {testResult.ok ? t('printers.testSent') : testResult.error || t('printers.testFailed')}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const cardStyle: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: '16px 18px',
  marginBottom: 12,
};

const cardHead: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  marginBottom: 8,
};

const cardName: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: 0,
};

const metaRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  fontSize: 12,
  flexWrap: 'wrap',
};

const roleChip: React.CSSProperties = {
  background: 'rgba(201,164,92,0.15)',
  color: '#8a6d2a',
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.04em',
};

const addrLabel: React.CSSProperties = {
  color: 'var(--text2)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  fontSize: 11,
};

const catRow: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 5,
  marginTop: 8,
};

const catChip = (color: string | null): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 500,
  color: 'var(--text1)',
  background: color ? `${color}22` : 'rgba(168,152,136,0.12)',
  border: `1px solid ${color || 'var(--border)'}`,
});

const templateBadge: React.CSSProperties = {
  display: 'inline-block',
  marginTop: 6,
  padding: '2px 8px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  background: 'rgba(201,164,92,0.12)',
  color: '#8a6d2a',
  border: '1px solid rgba(201,164,92,0.35)',
};

const deleteBtn: React.CSSProperties = {
  width: 28,
  height: 28,
  borderRadius: 6,
  border: '1px solid rgba(196,80,64,0.3)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 16,
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontFamily: 'inherit',
};
