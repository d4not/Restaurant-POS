// Sticky-top banner that appears when the product header form has unsaved
// edits. Sits at the top of the scrollable AdminViewShell body so it is
// always visible while the operator scrolls through variants / modifiers /
// recipe — no chasing the Save button down the page.

import type { CSSProperties } from 'react';
import { Spinner } from '../../../Spinner';
import { useTranslation } from '../../../../i18n';

interface Props {
  saving: boolean;
  onDiscard: () => void;
  onSave: () => void;
}

export function SaveBar({ saving, onDiscard, onSave }: Props) {
  const { t } = useTranslation();
  return (
    <div style={bar}>
      <span style={text}>{t('admin.productDetail.saveBar.message')}</span>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        style={btnGhost}
        onClick={onDiscard}
        disabled={saving}
      >
        {t('admin.productDetail.saveBar.discard')}
      </button>
      <button
        type="button"
        style={btnPrimary}
        onClick={onSave}
        disabled={saving}
      >
        {saving ? (
          <>
            <Spinner size={14} />
            <span>{t('admin.productDetail.saveBar.save')}</span>
          </>
        ) : (
          <span>{t('admin.productDetail.saveBar.save')}</span>
        )}
      </button>
    </div>
  );
}

const bar: CSSProperties = {
  position: 'sticky',
  top: 0,
  zIndex: 5,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 14px',
  marginBottom: 16,
  borderRadius: 10,
  border: '1px solid rgba(201,164,92,0.42)',
  background: 'rgba(201,164,92,0.10)',
  backdropFilter: 'saturate(140%) blur(4px)',
};

const text: CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text1)',
  letterSpacing: '0.01em',
};

const btnGhost: CSSProperties = {
  padding: '0 14px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 13,
  fontWeight: 500,
  cursor: 'pointer',
  fontFamily: 'inherit',
};

const btnPrimary: CSSProperties = {
  padding: '0 18px',
  height: 36,
  borderRadius: 8,
  border: '1px solid var(--text1)',
  background: 'var(--text1)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
};
