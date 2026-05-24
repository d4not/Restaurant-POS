// Placeholder full-screen sub-view for report tiles whose terminal-native
// dashboard hasn't been built yet. Slides in from below, returns on Esc or
// back arrow. The shape mirrors the planned real views so swapping it out
// later is a one-file change per view.

import { useEffect } from 'react';
import { adminStyles } from '../styles';
import { IconChevronLeft } from '../../Icons';
import { IconSparkle } from '../icons';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';

interface ComingSoonViewProps {
  titleKey: TranslationKey;
  onBack: () => void;
}

export function ComingSoonView({ titleKey, onBack }: ComingSoonViewProps) {
  const { t } = useTranslation();

  // Esc backs out — sub-views own this so AdminMode's launcher doesn't fire
  // when the user is in a view. Captured so it wins over the launcher.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onBack();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onBack]);

  return (
    <div className="admin-view-enter" style={adminStyles.comingShell}>
      <div style={adminStyles.comingHead}>
        <button
          type="button"
          style={adminStyles.comingBack}
          onClick={onBack}
          aria-label={t('common.back')}
        >
          <IconChevronLeft style={{ fontSize: 18 }} />
          <span>{t('common.back')}</span>
        </button>
        <h2 style={adminStyles.comingTitle}>{t(titleKey)}</h2>
      </div>
      <div style={adminStyles.comingBody}>
        <span
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: 'var(--gold-soft)',
            color: 'var(--gold)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 26,
          }}
        >
          <IconSparkle />
        </span>
        <h3
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 22,
            fontWeight: 600,
            color: 'var(--text1)',
            margin: 0,
          }}
        >
          {t('admin.comingSoon.title')}
        </h3>
        <p style={adminStyles.comingHint}>{t('admin.comingSoon.subtitle')}</p>
      </div>
    </div>
  );
}
