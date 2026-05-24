// Footer hint bar — surfaces the keyboard model without forcing the operator
// to open a help overlay. Mirrors what Apple does at the bottom of system
// pickers (Spotlight, Mission Control, etc.).

import { adminStyles } from './styles';
import { useTranslation } from '../../i18n';

function HintKey({ children }: { children: React.ReactNode }) {
  return <span className="admin-hint-key">{children}</span>;
}

export function AdminShortcutHints() {
  const { t } = useTranslation();
  const isMac =
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPod|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const cmd = isMac ? '⌘' : 'Ctrl';

  return (
    <footer style={adminStyles.hintBar} aria-label={t('admin.help.title')}>
      <span style={adminStyles.hintItem}>
        <HintKey>1</HintKey>–<HintKey>9</HintKey>
        <span>{t('admin.hint.openTile')}</span>
      </span>
      <span style={adminStyles.hintItem}>
        <HintKey>↑</HintKey>
        <HintKey>↓</HintKey>
        <HintKey>←</HintKey>
        <HintKey>→</HintKey>
        <span>{t('admin.hint.navigate')}</span>
      </span>
      <span style={adminStyles.hintItem}>
        <HintKey>{cmd}</HintKey>
        <HintKey>K</HintKey>
        <span>{t('admin.hint.search')}</span>
      </span>
      <span style={adminStyles.hintItem}>
        <HintKey>?</HintKey>
        <span>{t('admin.hint.help')}</span>
      </span>
      <span style={{ ...adminStyles.hintItem, marginLeft: 'auto' }}>
        <HintKey>Esc</HintKey>
        <span>{t('admin.hint.back')}</span>
      </span>
    </footer>
  );
}
