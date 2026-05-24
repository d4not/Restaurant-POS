// Always-visible palette entry. Sits between the narrative cell and the
// section row. Clicking it (or pressing '/' anywhere outside an input)
// opens the existing AdminCommandPalette overlay. This earns the palette
// its discoverability without forcing the operator to learn ⌘K cold.
//
// The component itself is a non-typeable button styled as an input. The
// actual typing happens inside the palette overlay, where the existing
// fuzzy ranker already lives. Splitting "entry" from "search" lets us
// surface the affordance on the launcher without duplicating the ranking
// logic or fighting focus with arrow-key tile navigation.

import { useEffect } from 'react';
import { useTranslation } from '../../i18n';
import { IconSearch } from './icons';

interface PaletteEntryProps {
  onOpen: () => void;
  /** Disable when an overlay / sub-view is already up so we don't double-fire. */
  disabled?: boolean;
}

export function PaletteEntry({ onOpen, disabled }: PaletteEntryProps) {
  const { t } = useTranslation();

  // Press '/' anywhere outside a text input to focus / open the palette.
  // Cron, Linear, Slack convention. Skipped when disabled (overlay already
  // up) so the slash inside the palette's own input still types.
  useEffect(() => {
    if (disabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable);
      if (inField) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      onOpen();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [disabled, onOpen]);

  return (
    <button
      type="button"
      className="admin-palette-entry"
      onClick={onOpen}
      disabled={disabled}
      aria-label={t('admin.palette.entryHint')}
    >
      <IconSearch
        style={{ fontSize: 16, color: 'var(--text3)', flexShrink: 0 }}
      />
      <span className="admin-palette-entry-placeholder">
        {t('admin.palette.entryHint')}
      </span>
      <span className="admin-palette-entry-kbd" aria-hidden="true">
        <kbd>/</kbd>
        <span>{t('admin.palette.entryKbd')}</span>
      </span>
    </button>
  );
}
