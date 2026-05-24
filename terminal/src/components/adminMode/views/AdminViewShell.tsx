// Shared chrome for the full-screen admin views (Shift Audit, Cash Log,
// Multi-Transfer, …). Owns the slim header (Back + title + subtitle) and
// the scrollable body slot. Esc closes the view — the listener is captured
// so it wins over the launcher's window-level Esc.

import { useEffect, type ReactNode } from 'react';
import { adminStyles } from '../styles';
import { IconChevronLeft } from '../../Icons';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';

interface AdminViewShellProps {
  titleKey: TranslationKey;
  subtitleKey?: TranslationKey;
  /** Optional action slot rendered next to the title (e.g. "+ New", filters). */
  headerActions?: ReactNode;
  onBack: () => void;
  children: ReactNode;
}

export function AdminViewShell({
  titleKey,
  subtitleKey,
  headerActions,
  onBack,
  children,
}: AdminViewShellProps) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        // Some inputs (modals layered on top) want to swallow Esc themselves.
        // We capture late so child overlays still get first crack via their
        // own listeners — we react only if nothing else preventDefault'd.
        if (e.defaultPrevented) return;
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  return (
    <div className="admin-view-enter" style={adminStyles.viewShell}>
      <div style={adminStyles.viewHead}>
        <button
          type="button"
          style={adminStyles.comingBack}
          onClick={onBack}
          aria-label={t('common.back')}
        >
          <IconChevronLeft style={{ fontSize: 18 }} />
          <span>{t('common.back')}</span>
        </button>
        <div style={adminStyles.viewTitleBlock}>
          <h2 style={adminStyles.viewTitle}>{t(titleKey)}</h2>
          {subtitleKey && (
            <p style={adminStyles.viewSubtitle}>{t(subtitleKey)}</p>
          )}
        </div>
        {headerActions && <div style={adminStyles.viewActions}>{headerActions}</div>}
      </div>
      <div style={adminStyles.viewBody}>{children}</div>
    </div>
  );
}
