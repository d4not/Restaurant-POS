// Centered help card triggered by `?`. Same visual language as the palette
// (rounded panel, dim scrim) so the two overlays feel like siblings.

import { useEffect } from 'react';
import { adminStyles } from './styles';
import { useTranslation } from '../../i18n';

interface AdminHelpOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function AdminHelpOverlay({ open, onClose }: AdminHelpOverlayProps) {
  const { t } = useTranslation();
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const cmd = isMac ? '⌘' : 'Ctrl';

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      style={{ ...adminStyles.paletteScrim, paddingTop: '18vh' }}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="admin-mount-pop"
        style={{ ...adminStyles.palette, width: 480 }}
        role="dialog"
        aria-label={t('admin.help.title')}
      >
        <div style={{ padding: '18px 22px 14px', borderBottom: '1px solid var(--border)' }}>
          <h2
            style={{
              fontFamily: "'Playfair Display', serif",
              fontSize: 18,
              fontWeight: 600,
              margin: 0,
              color: 'var(--text1)',
            }}
          >
            {t('admin.help.title')}
          </h2>
        </div>
        <ul
          style={{
            listStyle: 'none',
            padding: '14px 22px 20px',
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            fontSize: 13,
            color: 'var(--text2)',
            lineHeight: 1.5,
          }}
        >
          <li>{t('admin.help.tiles')}</li>
          <li>{t('admin.help.arrows')}</li>
          <li>{t('admin.help.palette').replace('⌘K', `${cmd}+K`)}</li>
          <li>{t('admin.help.escape')}</li>
          <li>{t('admin.help.global').replace('⌘⇧A', `${cmd}+Shift+A`)}</li>
        </ul>
      </div>
    </div>
  );
}
