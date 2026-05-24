// ⌘K / Ctrl+K command palette. A modal-ish overlay with a search input and a
// vertical list of matching tiles. The same tile registry powers it, so any
// tile added to tiles.tsx becomes searchable automatically.
//
// Matching is a tiny fuzzy-ish ranker: substring + word-boundary > anywhere.
// We deliberately avoid pulling in a fuzzy lib for ~9 entries.

import { useEffect, useMemo, useRef, useState } from 'react';
import { adminStyles } from './styles';
import {
  ACCENT_COLORS,
  ADMIN_TILES,
  SECTION_KEYS,
  canUseTile,
  type AdminTileDef,
} from './tiles';
import { useSession } from '../../store/session';
import { useTranslation } from '../../i18n';
import { IconSearch, IconArrowReturn } from './icons';

interface AdminCommandPaletteProps {
  open: boolean;
  onClose: () => void;
  onActivateTile: (tile: AdminTileDef) => void;
}

interface PaletteRow {
  tile: AdminTileDef;
  /** Lower is better. */
  rank: number;
}

function score(query: string, haystack: string): number {
  if (!query) return 0;
  const q = query.trim().toLowerCase();
  const h = haystack.toLowerCase();
  if (!q) return 0;
  const exact = h.indexOf(q);
  if (exact === 0) return 0; // perfect prefix
  if (exact > 0) {
    // Word-boundary match beats mid-word match.
    const isBoundary = exact === 0 || /\s|·|—/.test(h[exact - 1] ?? '');
    return (isBoundary ? 10 : 30) + exact;
  }
  // Fall through to "every char appears in order" tolerance for typos.
  let cursor = 0;
  let gaps = 0;
  for (let i = 0; i < q.length; i += 1) {
    const found = h.indexOf(q[i], cursor);
    if (found === -1) return Number.POSITIVE_INFINITY;
    gaps += found - cursor;
    cursor = found + 1;
  }
  return 80 + gaps;
}

export function AdminCommandPalette({
  open,
  onClose,
  onActivateTile,
}: AdminCommandPaletteProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);

  // Reset query and focus the input every time the palette opens. We don't
  // preserve the last search — the operator usually opens it for one task.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIdx(0);
    // Defer focus so the input is mounted before we call .focus().
    const id = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  // Compute the visible rows: all enabled tiles when query is empty (so the
  // palette is also a quick menu), filtered + ranked when typing.
  const rows: PaletteRow[] = useMemo(() => {
    const enabled = ADMIN_TILES.filter((tile) => canUseTile(tile, role));
    if (!query.trim()) {
      return enabled.map((tile, i) => ({ tile, rank: i }));
    }
    const ranked: PaletteRow[] = [];
    for (const tile of enabled) {
      const haystack = [
        t(tile.titleKey),
        tile.hintKey ? t(tile.hintKey) : '',
        t(SECTION_KEYS[tile.section]),
      ].join(' · ');
      const rank = score(query, haystack);
      if (Number.isFinite(rank)) ranked.push({ tile, rank });
    }
    ranked.sort((a, b) => a.rank - b.rank);
    return ranked;
  }, [query, role, t]);

  // Keep activeIdx within bounds when the row set shrinks.
  useEffect(() => {
    setActiveIdx((idx) => Math.max(0, Math.min(idx, rows.length - 1)));
  }, [rows.length]);

  // Scroll the active row into view as the user navigates.
  useEffect(() => {
    if (!open) return;
    const list = listRef.current;
    if (!list) return;
    const node = list.querySelector<HTMLElement>(`[data-row-index="${activeIdx}"]`);
    node?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  // Keyboard handler — local to the palette, attached to the input so it
  // doesn't fight with the launcher's window-level handler.
  function handleKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(rows.length - 1, i + 1));
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
      return;
    }
    if (e.key === 'Home') {
      e.preventDefault();
      setActiveIdx(0);
      return;
    }
    if (e.key === 'End') {
      e.preventDefault();
      setActiveIdx(rows.length - 1);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      const row = rows[activeIdx];
      if (row) onActivateTile(row.tile);
    }
  }

  if (!open) return null;

  return (
    <div
      style={adminStyles.paletteScrim}
      onMouseDown={(e) => {
        // Click on the scrim closes; click inside the card doesn't.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="admin-mount-pop"
        style={adminStyles.palette}
        role="dialog"
        aria-label={t('common.search')}
      >
        <div style={adminStyles.paletteInputRow}>
          <span style={{ fontSize: 16, color: 'var(--text3)' }}>
            <IconSearch />
          </span>
          <input
            ref={inputRef}
            style={adminStyles.paletteInput}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t('admin.palette.placeholder')}
            autoComplete="off"
            spellCheck={false}
          />
          <span style={adminStyles.paletteEscHint}>esc</span>
        </div>

        <div ref={listRef} style={adminStyles.paletteList}>
          {rows.length === 0 ? (
            <div style={adminStyles.paletteEmpty}>{t('admin.palette.empty')}</div>
          ) : (
            rows.map((row, i) => {
              const active = i === activeIdx;
              const accent = ACCENT_COLORS[row.tile.accent];
              return (
                <div
                  key={row.tile.id}
                  data-row-index={i}
                  className={`admin-palette-row${active ? ' is-active' : ''}`}
                  style={adminStyles.paletteRow}
                  onMouseEnter={() => setActiveIdx(i)}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onActivateTile(row.tile);
                  }}
                >
                  <span style={{ ...adminStyles.paletteIcon, background: accent }}>
                    <row.tile.Icon style={{ fontSize: 14 }} />
                  </span>
                  <div style={adminStyles.paletteRowText}>
                    <span style={adminStyles.paletteRowTitle}>
                      {t(row.tile.titleKey)}
                    </span>
                    <span style={adminStyles.paletteRowMeta}>
                      {t(SECTION_KEYS[row.tile.section])}
                      {row.tile.hintKey ? ` · ${t(row.tile.hintKey)}` : ''}
                    </span>
                  </div>
                  <span style={adminStyles.paletteRowKbd}>
                    {active ? <IconArrowReturn style={{ fontSize: 14 }} /> : row.tile.number}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
