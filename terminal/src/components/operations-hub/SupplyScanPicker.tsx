import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  lookupSupplyByBarcode,
  searchSupplies,
  type SupplyBarcodeResult,
  type SupplySearchResult,
} from '../../api/supplies';
import { ApiError } from '../../api/client';
import { useBarcodeScanner } from '../../hooks/use-barcode-scanner';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { IconBarcode } from './HubIcons';

export interface SupplyPicked {
  id: string;
  name: string;
  // Display unit string — base unit name when present (KG, BOTTLE, etc.). Empty
  // for legacy supplies without a base_unit; the caller renders an em-dash.
  unit: string;
}

interface SupplyScanPickerProps {
  // Modal is open — used for autofocus, query enabling, and barcode listening.
  active: boolean;
  // Whether the picker accepts input. When false (e.g., storages not chosen
  // yet) the input is disabled and a warning shows on attempted scan.
  enabled: boolean;
  // Reason to surface when a scan/search is attempted while disabled.
  disabledReason?: string;
  onPick: (supply: SupplyPicked) => void;
  // Optional ids that should not appear in the autocomplete (e.g., supplies
  // already added to the ticket). The caller already deduplicates on pick,
  // but hiding them prevents accidental double-adds.
  hideIds?: ReadonlySet<string>;
}

const styles = {
  scanWrap: {
    display: 'flex',
    gap: 10,
    alignItems: 'stretch',
    marginBottom: 8,
    position: 'relative',
  } satisfies React.CSSProperties,
  scanBox: { position: 'relative', flex: 1 } satisfies React.CSSProperties,
  scanInput: {
    width: '100%',
    height: 48,
    padding: '0 14px 0 42px',
    border: '2px solid var(--gold)',
    borderRadius: 10,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 15,
    outline: 'none',
    fontFamily: 'inherit',
  } satisfies React.CSSProperties,
  scanIcon: {
    position: 'absolute',
    left: 12,
    top: '50%',
    transform: 'translateY(-50%)',
    fontSize: 20,
    color: 'var(--gold)',
    pointerEvents: 'none',
  } satisfies React.CSSProperties,
  dropdown: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 'calc(100% + 4px)',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    boxShadow: '0 12px 32px rgba(44,36,32,0.16)',
    maxHeight: 280,
    overflowY: 'auto',
    zIndex: 5,
  } satisfies React.CSSProperties,
  option: (active: boolean): React.CSSProperties => ({
    display: 'grid',
    gridTemplateColumns: '1fr auto',
    alignItems: 'center',
    columnGap: 12,
    padding: '12px 14px',
    cursor: 'pointer',
    borderBottom: '1px solid var(--border)',
    background: active ? 'rgba(201,164,92,0.10)' : 'transparent',
  }),
  optName: {
    fontSize: 14,
    color: 'var(--text1)',
    fontWeight: 500,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  } satisfies React.CSSProperties,
  optSub: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 2,
  } satisfies React.CSSProperties,
  optUnit: {
    fontSize: 12,
    color: 'var(--text2)',
    fontVariantNumeric: 'tabular-nums',
  } satisfies React.CSSProperties,
  emptyDrop: {
    padding: '14px 16px',
    fontSize: 12,
    color: 'var(--text3)',
    textAlign: 'center',
  } satisfies React.CSSProperties,
  notice: {
    marginTop: 10,
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    fontWeight: 500,
  } satisfies React.CSSProperties,
};

// Inline debounce hook — only used here, not worth a shared file. 180ms feels
// instant on tablet but cuts request count ~5×.
function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function looksLikeBarcode(value: string): boolean {
  // Heuristic: scanners always emit Enter; humans rarely type 8+ digits without
  // letters in this picker. Anything matching pure digits length ≥ 6 is treated
  // as a barcode lookup if the user explicitly presses Enter — otherwise it
  // flows through name search like any other typed text.
  return /^\d{6,}$/.test(value);
}

function unitLabel(s: SupplySearchResult): string {
  if (s.content_per_unit && s.content_unit) {
    return `${s.content_per_unit}${s.content_unit.toLowerCase()}`;
  }
  return s.base_unit ?? '';
}

/**
 * Combined barcode-scan + name-search input for supply selection.
 * - Typing slowly triggers a debounced server search (case-insensitive name +
 *   barcode contains) with autocomplete dropdown.
 * - Scanning a barcode (Enter key, or a 50ms-burst from a HID scanner) fires
 *   `lookupSupplyByBarcode` and adds the matching supply directly.
 * - Pressing Enter on a typed value also resolves: digit-only → barcode,
 *   otherwise picks the first dropdown row.
 */
export function SupplyScanPicker({
  active,
  enabled,
  disabledReason,
  onPick,
  hideIds,
}: SupplyScanPickerProps) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const [notice, setNotice] = useState<{ kind: 'warn' | 'err'; text: string } | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [activeIdx, setActiveIdx] = useState(0);
  const [focused, setFocused] = useState(false);
  const noticeTimer = useRef<number | null>(null);
  const debouncedText = useDebounced(text, 180);

  // Reset state when the modal opens/closes.
  useEffect(() => {
    if (!active) {
      setText('');
      setNotice(null);
      setLookupBusy(false);
      setActiveIdx(0);
    }
  }, [active]);

  function flashNotice(kind: 'warn' | 'err', message: string) {
    setNotice({ kind, text: message });
    if (noticeTimer.current != null) window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4000);
  }

  // Name search — debounced server query. `enabled` is a TanStack flag, NOT
  // the picker's enabled prop — we still want to search to be ready even if
  // the storage picker is empty (the user might be exploring).
  const trimmed = debouncedText.trim();
  const searchQuery = useQuery<SupplySearchResult[]>({
    queryKey: ['supplies', 'search', trimmed],
    queryFn: () => searchSupplies(trimmed, 12),
    // Skip when too short — avoids hammering the API on every keystroke.
    enabled: active && trimmed.length >= 2 && !looksLikeBarcode(trimmed),
    staleTime: 30_000,
    // The dropdown should feel snappy; placeholder data avoids the flash
    // between two adjacent searches (e.g., "tom" → "toma").
    placeholderData: (prev) => prev,
  });

  const visibleResults = useMemo(() => {
    const all = searchQuery.data ?? [];
    if (!hideIds || hideIds.size === 0) return all;
    return all.filter((s) => !hideIds.has(s.id));
  }, [searchQuery.data, hideIds]);

  // Clamp activeIdx whenever the list shrinks.
  useEffect(() => {
    if (activeIdx >= visibleResults.length) setActiveIdx(0);
  }, [visibleResults.length, activeIdx]);

  async function doBarcodeLookup(code: string) {
    if (!enabled) {
      flashNotice('warn', disabledReason ?? t('supplyPicker.disabled'));
      return;
    }
    setLookupBusy(true);
    try {
      const result: SupplyBarcodeResult = await lookupSupplyByBarcode(code);
      if (!result.existing) {
        flashNotice(
          'warn',
          result.lookup ? t('supplyPicker.notFoundCta') : t('supplyPicker.unknownBarcode'),
        );
        return;
      }
      // Barcode lookup doesn't include base_unit; we keep unit empty so the
      // caller renders "—". The list/search path returns a unit; reuse where
      // possible by also matching the existing id in the most recent results.
      const fromSearch = (searchQuery.data ?? []).find((s) => s.id === result.existing!.id);
      onPick({
        id: result.existing.id,
        name: result.existing.name,
        unit: fromSearch ? unitLabel(fromSearch) : '',
      });
      setText('');
      setNotice(null);
    } catch (err) {
      flashNotice(
        'err',
        err instanceof ApiError ? err.message : t('supplyPicker.lookupFailed'),
      );
    } finally {
      setLookupBusy(false);
    }
  }

  function pickFromSearch(item: SupplySearchResult) {
    if (!enabled) {
      flashNotice('warn', disabledReason ?? t('supplyPicker.disabled'));
      return;
    }
    onPick({ id: item.id, name: item.name, unit: unitLabel(item) });
    setText('');
    setNotice(null);
    setActiveIdx(0);
    scanner.reset();
    scanner.ref.current?.focus();
  }

  // The barcode hook fires when keys arrive in a tight burst (HID scanner) or
  // when the input pauses. We only treat digit-only flushes as barcodes — the
  // 50ms gap timer flushes on every human pause too, so any non-digit buffer
  // is just typed text we should ignore here. Dropdown selection is handled
  // by the React onKeyDown handler below (Enter picks the highlighted row).
  const scanner = useBarcodeScanner({
    enabled: active,
    onScan: (code) => {
      if (!looksLikeBarcode(code)) return;
      setText('');
      void doBarcodeLookup(code);
    },
  });

  // Keep the scan input focused when the modal opens.
  useEffect(() => {
    if (!active) return;
    scanner.ref.current?.focus();
  }, [active, scanner.ref]);

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, Math.max(0, visibleResults.length - 1)));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      // Pick the highlighted dropdown row when the buffer doesn't look like a
      // barcode. The native barcode hook also fires on Enter — for digit-only
      // bursts its handler runs first and routes through doBarcodeLookup; for
      // typed text we handle the selection here.
      if (looksLikeBarcode(text.trim())) return;
      if (visibleResults.length > 0) {
        e.preventDefault();
        const idx = Math.min(activeIdx, visibleResults.length - 1);
        const item = visibleResults[idx];
        if (item) pickFromSearch(item);
      }
    } else if (e.key === 'Escape' && text) {
      // Local escape: clear the field before letting the parent modal close.
      e.preventDefault();
      e.stopPropagation();
      setText('');
      setActiveIdx(0);
    }
  }

  const showDropdown =
    focused &&
    trimmed.length >= 2 &&
    !looksLikeBarcode(trimmed) &&
    !lookupBusy;

  const noticeStyle: React.CSSProperties | null = notice
    ? {
        ...styles.notice,
        background:
          notice.kind === 'warn'
            ? 'rgba(201,164,92,0.10)'
            : 'rgba(196,80,64,0.10)',
        color: notice.kind === 'warn' ? '#8a6d2a' : 'var(--red)',
      }
    : null;

  return (
    <>
      <div style={styles.scanWrap}>
        <div style={styles.scanBox}>
          <span style={styles.scanIcon}>
            <IconBarcode />
          </span>
          <input
            ref={scanner.ref}
            style={styles.scanInput}
            value={text}
            placeholder={t('supplyPicker.placeholder')}
            onChange={(e) => {
              setText(e.target.value);
              setActiveIdx(0);
            }}
            onFocus={() => setFocused(true)}
            // Delay blur so a click on a dropdown row registers before the
            // dropdown disappears.
            onBlur={() => window.setTimeout(() => setFocused(false), 120)}
            onKeyDown={onKeyDown}
            disabled={lookupBusy}
            aria-label={t('supplyPicker.placeholder')}
            autoComplete="off"
          />
          {showDropdown && (
            <div style={styles.dropdown} role="listbox">
              {searchQuery.isFetching && visibleResults.length === 0 ? (
                <div style={styles.emptyDrop}>{t('supplyPicker.searching')}</div>
              ) : visibleResults.length === 0 ? (
                <div style={styles.emptyDrop}>{t('supplyPicker.noResults')}</div>
              ) : (
                visibleResults.map((s, i) => (
                  <div
                    key={s.id}
                    role="option"
                    aria-selected={i === activeIdx}
                    style={styles.option(i === activeIdx)}
                    onMouseEnter={() => setActiveIdx(i)}
                    onMouseDown={(e) => {
                      // mousedown beats blur — keeps focus on the input.
                      e.preventDefault();
                      pickFromSearch(s);
                    }}
                  >
                    <div>
                      <div style={styles.optName}>{s.name}</div>
                      {s.barcode && <div style={styles.optSub}>{s.barcode}</div>}
                    </div>
                    <div style={styles.optUnit}>{unitLabel(s) || '—'}</div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
        {lookupBusy && <Spinner size={18} />}
      </div>
      {notice && noticeStyle && <div style={noticeStyle}>{notice.text}</div>}
    </>
  );
}
