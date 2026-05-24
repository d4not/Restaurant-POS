import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card } from '../../components/ui';
import { Select } from '../../components/forms/Select';
import { useSuppliers } from '../../hooks/useSuppliers';
import { useStorages } from '../../hooks/useStorages';
import {
  externalSearch,
  lookupBarcode,
  type BarcodeLookupResult,
  type ExternalSearchResult,
  type LookupSource,
  type SourcedLookup,
} from '../../api/supplies';
import { ApiError } from '../../api/client';
import { SupplyEditor } from './SupplyEditor';

// Quick supply entry — designed for stocking runs. Two complementary modes:
//
//   "scan"   → USB barcode scanner workflow. Field captures the scanner's
//              keystrokes + Enter, runs the multi-source backend lookup,
//              shows existing-supply hit OR a candidate picker (when several
//              source databases agreed on the barcode) OR an empty-state
//              that drops straight into manual entry.
//
//   "search" → Fallback when there's no barcode (or it doesn't scan):
//              debounced free-text search against Open Food Facts. Picker
//              UI shows thumbnails + brand + content so the user can spot
//              the right SKU at a glance.
//
// Either path lands on the embedded SupplyEditor (same component used by
// /new and /:id) seeded with the chosen candidate's data.

type ScanState =
  | { kind: 'idle' }
  | { kind: 'loading'; barcode: string }
  | { kind: 'existing'; barcode: string; result: BarcodeLookupResult }
  | { kind: 'choosing'; barcode: string; candidates: SourcedLookup[] }
  | { kind: 'empty'; barcode: string }
  | { kind: 'error'; barcode: string; message: string };

type SearchState =
  | { kind: 'idle' }
  | { kind: 'loading'; query: string }
  | { kind: 'results'; query: string; candidates: SourcedLookup[] }
  | { kind: 'empty'; query: string }
  | { kind: 'error'; query: string; message: string };

type EditorSeed =
  | { source: 'scan'; barcode: string; pick: SourcedLookup | null }
  | { source: 'search'; pick: SourcedLookup };

type Mode = 'scan' | 'search';

const SOURCE_LABEL: Record<LookupSource, string> = {
  openfoodfacts: 'Open Food Facts',
  openbeautyfacts: 'Open Beauty Facts',
  openproductsfacts: 'Open Products Facts',
  upcitemdb: 'UPC Item DB',
};

const SOURCE_TONE: Record<LookupSource, 'gold' | 'green' | 'blue' | 'gray'> = {
  openfoodfacts: 'gold',
  openbeautyfacts: 'blue',
  openproductsfacts: 'green',
  upcitemdb: 'gray',
};

export function SupplyQuickAdd() {
  const navigate = useNavigate();
  const barcodeInputRef = useRef<HTMLInputElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  // Sticky supplier + storage — when the user is at Sam's bringing things to
  // the Warehouse, every scan goes against the same pair. Persisted in
  // sessionStorage so a stray reload doesn't lose them.
  const [supplierId, setSupplierId] = useState<string>(() =>
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('quickadd:supplier_id') ?? ''
      : '',
  );
  const [storageId, setStorageId] = useState<string>(() =>
    typeof window !== 'undefined'
      ? window.sessionStorage.getItem('quickadd:storage_id') ?? ''
      : '',
  );
  const [mode, setMode] = useState<Mode>(() =>
    typeof window !== 'undefined'
      ? ((window.sessionStorage.getItem('quickadd:mode') as Mode | null) ?? 'scan')
      : 'scan',
  );

  const [barcodeInput, setBarcodeInput] = useState('');
  const [scan, setScan] = useState<ScanState>({ kind: 'idle' });

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState<SearchState>({ kind: 'idle' });

  // The "winning" pick that drives the embedded editor. Set when:
  //   - barcode mode finds 1 candidate (auto-pick) or user clicks one
  //   - barcode mode returns empty → manual entry seed
  //   - search mode user clicks a result
  const [seed, setSeed] = useState<EditorSeed | null>(null);

  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedName, setLastSavedName] = useState<string | null>(null);

  const suppliersQ = useSuppliers({ active: true });
  const storagesQ = useStorages();
  const suppliers = useMemo(
    () => suppliersQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliersQ.data],
  );
  const storages = useMemo(
    () => storagesQ.data?.items.filter((s) => s.active) ?? [],
    [storagesQ.data],
  );
  const supplierName = useMemo(
    () => suppliers.find((s) => s.id === supplierId)?.name ?? null,
    [suppliers, supplierId],
  );
  const storageName = useMemo(
    () => storages.find((s) => s.id === storageId)?.name ?? null,
    [storages, storageId],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (supplierId) {
      window.sessionStorage.setItem('quickadd:supplier_id', supplierId);
    } else {
      window.sessionStorage.removeItem('quickadd:supplier_id');
    }
  }, [supplierId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (storageId) {
      window.sessionStorage.setItem('quickadd:storage_id', storageId);
    } else {
      window.sessionStorage.removeItem('quickadd:storage_id');
    }
  }, [storageId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.sessionStorage.setItem('quickadd:mode', mode);
  }, [mode]);

  // Autofocus the active input once the supplier is locked in. Re-runs when
  // the form is reset so the next entry goes straight in.
  useEffect(() => {
    if (!supplierId) return;
    if (mode === 'scan' && scan.kind === 'idle') {
      barcodeInputRef.current?.focus();
    } else if (mode === 'search' && search.kind === 'idle') {
      searchInputRef.current?.focus();
    }
  }, [supplierId, mode, scan.kind, search.kind]);

  const lookupMutation = useMutation({
    mutationFn: (barcode: string) => lookupBarcode(barcode),
  });

  const searchMutation = useMutation({
    mutationFn: (q: string) => externalSearch(q, 12),
  });

  // ── Barcode submit ───────────────────────────────────────────────────
  const handleBarcodeSubmit = async (barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    setSeed(null);
    setScan({ kind: 'loading', barcode: trimmed });
    try {
      const result: BarcodeLookupResult = await lookupMutation.mutateAsync(trimmed);
      if (result.existing) {
        setScan({ kind: 'existing', barcode: trimmed, result });
        return;
      }
      if (result.candidates.length === 0) {
        setScan({ kind: 'empty', barcode: trimmed });
        // Empty barcode → still useful: prefill manual entry with the code.
        setSeed({ source: 'scan', barcode: trimmed, pick: null });
        return;
      }
      if (result.candidates.length === 1) {
        // One match → no point making the user click. Auto-commit.
        setScan({ kind: 'idle' });
        setSeed({ source: 'scan', barcode: trimmed, pick: result.candidates[0]! });
        setBarcodeInput('');
        return;
      }
      // Multiple sources matched → let the user pick.
      setScan({ kind: 'choosing', barcode: trimmed, candidates: result.candidates });
    } catch (err) {
      setScan({
        kind: 'error',
        barcode: trimmed,
        message: err instanceof ApiError ? err.message : 'Lookup failed',
      });
    }
  };

  const onBarcodeKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleBarcodeSubmit(barcodeInput);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelCurrentEntry();
    }
  };

  // ── Search debounce ──────────────────────────────────────────────────
  // 400ms feels right: long enough to absorb the burst of typing, short
  // enough that the picker appears before the user has time to wonder if
  // anything is happening.
  useEffect(() => {
    const trimmed = searchInput.trim();
    if (trimmed.length < 2) {
      setSearch({ kind: 'idle' });
      return;
    }
    setSearch({ kind: 'loading', query: trimmed });
    const handle = window.setTimeout(async () => {
      try {
        const res: ExternalSearchResult = await searchMutation.mutateAsync(trimmed);
        if (res.candidates.length === 0) {
          setSearch({ kind: 'empty', query: trimmed });
        } else {
          setSearch({ kind: 'results', query: trimmed, candidates: res.candidates });
        }
      } catch (err) {
        setSearch({
          kind: 'error',
          query: trimmed,
          message: err instanceof ApiError ? err.message : 'Search failed',
        });
      }
    }, 400);
    return () => window.clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  // ── Common reset / commit helpers ────────────────────────────────────
  const resetForNextEntry = () => {
    setBarcodeInput('');
    setSearchInput('');
    setScan({ kind: 'idle' });
    setSearch({ kind: 'idle' });
    setSeed(null);
    setTimeout(() => {
      if (mode === 'scan') barcodeInputRef.current?.focus();
      else searchInputRef.current?.focus();
    }, 0);
  };

  const cancelCurrentEntry = () => {
    setSeed(null);
    if (mode === 'scan') {
      setBarcodeInput('');
      setScan({ kind: 'idle' });
      setTimeout(() => barcodeInputRef.current?.focus(), 0);
    } else {
      // Don't blow away the search query — the user might just be backing
      // out of an accidental candidate selection. Just clear the seed so
      // the editor closes; the search results stay visible.
    }
  };

  const commitCandidate = (pick: SourcedLookup, fromScanBarcode?: string) => {
    if (fromScanBarcode) {
      setScan({ kind: 'idle' });
      setBarcodeInput('');
      setSeed({ source: 'scan', barcode: fromScanBarcode, pick });
    } else {
      setSeed({ source: 'search', pick });
    }
  };

  const editorPrefill = useMemo(() => {
    if (!seed) return undefined;
    if (seed.source === 'scan' && !seed.pick) {
      return { barcode: seed.barcode };
    }
    const pick = seed.source === 'scan' ? seed.pick! : seed.pick;
    const barcode =
      seed.source === 'scan' ? seed.barcode : pick.barcode ?? '';
    return {
      barcode,
      name: pick.brand ? `${pick.name} (${pick.brand})` : pick.name,
      image_url: pick.image_url,
      content_per_unit: pick.content_per_unit,
      content_unit: pick.content_unit,
      suggestedCategories: pick.categories,
      source: pick.source,
    };
  }, [seed]);

  const editorKey = useMemo(() => {
    if (!seed) return 'none';
    if (seed.source === 'scan') {
      return `scan:${seed.barcode}:${seed.pick?.source ?? 'manual'}`;
    }
    return `search:${seed.pick.source}:${seed.pick.barcode ?? seed.pick.name}`;
  }, [seed]);

  // ── Render ───────────────────────────────────────────────────────────
  return (
    <>
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/inventory/supplies"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to supplies
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            Quick add supply
          </h1>
          <div className="fs-12 text-muted mt-4">
            Scan a barcode or search by name → verify the prefilled data → save.
          </div>
        </div>
        {savedCount > 0 && (
          <Badge tone="green">{savedCount} added this session</Badge>
        )}
      </div>

      {/* Supplier + storage pickers — sticky for the session */}
      <Card>
        <div className="section-grid-2">
          <div>
            <Select
              label="Supplier you're buying from"
              name="supplier"
              value={supplierId}
              onValueChange={setSupplierId}
              placeholder={suppliersQ.isLoading ? 'Loading…' : 'Select supplier…'}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              disabled={suppliersQ.isLoading}
            />
            <div className="fs-11 text-muted mt-4">
              Every entry attaches to this supplier.
            </div>
          </div>
          <div>
            <Select
              label="Where the stock lands"
              name="storage"
              value={storageId}
              onValueChange={setStorageId}
              placeholder={storagesQ.isLoading ? 'Loading…' : 'Pick storage…'}
              options={storages.map((s) => ({ value: s.id, label: s.name }))}
              disabled={storagesQ.isLoading}
            />
            <div className="fs-11 text-muted mt-4">
              Initial-stock purchases go here. Leave blank to skip auto-purchase.
            </div>
          </div>
        </div>
      </Card>

      {/* Mode toggle + active-mode input panel */}
      <Card style={{ marginTop: 14 }}>
        <ModeToggle mode={mode} onChange={setMode} />

        {mode === 'scan' ? (
          <ScanPanel
            inputRef={barcodeInputRef}
            value={barcodeInput}
            onChange={setBarcodeInput}
            onKeyDown={onBarcodeKeyDown}
            onSubmit={() => void handleBarcodeSubmit(barcodeInput)}
            disabled={!supplierId || scan.kind === 'loading'}
            supplierPicked={Boolean(supplierId)}
            scan={scan}
            lastSavedName={lastSavedName}
            onClearLastSaved={() => setLastSavedName(null)}
            onDismissError={() => setScan({ kind: 'idle' })}
          />
        ) : (
          <SearchPanel
            inputRef={searchInputRef}
            value={searchInput}
            onChange={setSearchInput}
            onClear={() => {
              setSearchInput('');
              setSearch({ kind: 'idle' });
              setTimeout(() => searchInputRef.current?.focus(), 0);
            }}
            disabled={!supplierId}
            supplierPicked={Boolean(supplierId)}
            state={search}
            onPick={(c) => commitCandidate(c)}
          />
        )}
      </Card>

      {/* Existing supply hit — only ever from scan mode */}
      {scan.kind === 'existing' && scan.result.existing && (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ marginBottom: 10 }}>Already in your catalog</h3>
          <div className="detail-grid mb-12">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Barcode</div>
                <div className="dv" style={{ fontFamily: 'monospace' }}>
                  {scan.barcode}
                </div>
              </div>
              <div className="detail-cell">
                <div className="dk">Existing supply</div>
                <div className="dv fw-600">{scan.result.existing.name}</div>
              </div>
            </div>
          </div>
          <div className="flex gap-8" style={{ flexWrap: 'wrap' }}>
            <Button
              variant="primary"
              onClick={() =>
                navigate(`/inventory/supplies/${scan.result.existing!.id}`)
              }
            >
              Open supply detail →
            </Button>
            <Button variant="ghost" onClick={resetForNextEntry}>
              Skip — next entry
            </Button>
          </div>
        </Card>
      )}

      {/* Multi-source candidate picker (scan mode, > 1 source matched) */}
      {scan.kind === 'choosing' && (
        <Card style={{ marginTop: 14 }}>
          <h3 style={{ margin: 0 }}>Pick the best match</h3>
          <div className="fs-12 text-muted mt-4 mb-12">
            Multiple databases recognized barcode{' '}
            <span style={{ fontFamily: 'monospace' }}>{scan.barcode}</span>. Choose the
            one that matches the SKU on your shelf — quantity and unit detection
            varies by source.
          </div>
          <CandidateGrid
            candidates={scan.candidates}
            onPick={(c) => commitCandidate(c, scan.barcode)}
          />
          <div className="mt-8">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setScan({ kind: 'empty', barcode: scan.barcode });
                setSeed({ source: 'scan', barcode: scan.barcode, pick: null });
              }}
            >
              None of these — fill manually
            </Button>
          </div>
        </Card>
      )}

      {/* Embedded editor — same component used by /new and /:id, just with
          prefill data and a quick-add-friendly save handler. The key forces
          an unmount between entries so the editor's internal state resets. */}
      {seed && (
        <Card
          style={{
            marginTop: 14,
            padding: '18px 18px 8px',
          }}
        >
          <div className="flex-between mb-12" style={{ alignItems: 'flex-start' }}>
            <div>
              <h3 style={{ margin: 0 }}>
                {seed.source === 'scan' && !seed.pick ? 'Manual entry' : 'Verify and save'}
              </h3>
              <div className="fs-11 text-muted mt-4">
                {seed.source === 'scan' && (
                  <>
                    Barcode:{' '}
                    <span style={{ fontFamily: 'monospace' }}>{seed.barcode}</span>
                  </>
                )}
                {seed.source === 'search' && seed.pick.barcode && (
                  <>
                    Barcode:{' '}
                    <span style={{ fontFamily: 'monospace' }}>
                      {seed.pick.barcode}
                    </span>
                  </>
                )}
                {seed.source === 'scan' && seed.pick && (
                  <>
                    {' · '}
                    <Badge tone={SOURCE_TONE[seed.pick.source]}>
                      {SOURCE_LABEL[seed.pick.source]}
                    </Badge>
                  </>
                )}
                {seed.source === 'search' && (
                  <>
                    {' · '}
                    <Badge tone={SOURCE_TONE[seed.pick.source]}>
                      {SOURCE_LABEL[seed.pick.source]}
                    </Badge>
                  </>
                )}
                {seed.source === 'scan' && !seed.pick && (
                  <>
                    {' · '}
                    <Badge tone="gray">Not found — fill manually</Badge>
                  </>
                )}
                {supplierName && (
                  <>
                    {' · supplier '}
                    <strong>{supplierName}</strong>
                  </>
                )}
                {storageName && (
                  <>
                    {' · storage '}
                    <strong>{storageName}</strong>
                  </>
                )}
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={cancelCurrentEntry}>
              Cancel
            </Button>
          </div>

          <SupplyEditor
            key={editorKey}
            mode="create"
            embedded
            prefill={editorPrefill}
            fixedSupplierId={supplierId || undefined}
            fixedStorageId={storageId || undefined}
            saveLabel="Save & next entry"
            onSaved={(supply) => {
              setSavedCount((n) => n + 1);
              setLastSavedName(supply.name);
              resetForNextEntry();
            }}
          />
        </Card>
      )}
    </>
  );
}

// ── Subcomponents ────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const tabStyle = (active: boolean): React.CSSProperties => ({
    flex: 1,
    padding: '10px 14px',
    border: '1px solid var(--border2)',
    background: active ? 'var(--sidebar2)' : 'var(--surface)',
    color: active ? '#f0e0c0' : 'var(--text2)',
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.12s',
  });
  return (
    <div className="flex" style={{ gap: 0, marginBottom: 14 }}>
      <button
        type="button"
        onClick={() => onChange('scan')}
        style={{
          ...tabStyle(mode === 'scan'),
          borderRadius: 'var(--radius-sm) 0 0 var(--radius-sm)',
          borderRight: 'none',
        }}
      >
        ▦ Scan barcode
      </button>
      <button
        type="button"
        onClick={() => onChange('search')}
        style={{
          ...tabStyle(mode === 'search'),
          borderRadius: '0 var(--radius-sm) var(--radius-sm) 0',
        }}
      >
        ⌕ Search by name
      </button>
    </div>
  );
}

interface ScanPanelProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
  onSubmit: () => void;
  disabled: boolean;
  supplierPicked: boolean;
  scan: ScanState;
  lastSavedName: string | null;
  onClearLastSaved: () => void;
  onDismissError: () => void;
}

function ScanPanel({
  inputRef,
  value,
  onChange,
  onKeyDown,
  onSubmit,
  disabled,
  supplierPicked,
  scan,
  lastSavedName,
  onClearLastSaved,
  onDismissError,
}: ScanPanelProps) {
  return (
    <>
      <label
        htmlFor="quickadd-barcode"
        style={{
          display: 'block',
          fontFamily: "'Playfair Display', serif",
          fontSize: 16,
          marginBottom: 8,
        }}
      >
        Scan or type barcode
      </label>
      <div className="flex" style={{ gap: 8 }}>
        <input
          id="quickadd-barcode"
          ref={inputRef}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={disabled}
          placeholder={
            supplierPicked
              ? 'Point scanner here, or type and press Enter'
              : 'Pick a supplier above first…'
          }
          style={{
            flex: 1,
            height: 56,
            fontSize: 22,
            fontFamily: 'monospace',
            letterSpacing: '0.04em',
            padding: '0 16px',
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            outline: 'none',
          }}
        />
        <Button
          variant="primary"
          onClick={onSubmit}
          disabled={disabled || !value.trim()}
        >
          Lookup
        </Button>
      </div>

      {lastSavedName && scan.kind === 'idle' && (
        <div
          className="fs-12 text-green mt-8"
          style={{ display: 'flex', alignItems: 'center', gap: 6 }}
        >
          ✓ Saved <strong>{lastSavedName}</strong> — ready for the next entry
          <button
            type="button"
            onClick={onClearLastSaved}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--text3)',
              cursor: 'pointer',
              fontSize: 11,
              marginLeft: 6,
            }}
            aria-label="Dismiss"
          >
            ×
          </button>
        </div>
      )}

      {scan.kind === 'loading' && (
        <div className="fs-12 text-muted mt-8">
          <span className="spin" style={{ marginRight: 6 }}>↻</span>
          Looking up <strong>{scan.barcode}</strong> across product databases…
        </div>
      )}

      {scan.kind === 'error' && (
        <div className="auth-alert mt-8" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {scan.message}
          <Button variant="ghost" size="sm" onClick={onDismissError}>
            Dismiss
          </Button>
        </div>
      )}

      <style>{`
        @keyframes qa-spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
        .spin { display: inline-block; animation: qa-spin 0.9s linear infinite; }
      `}</style>
    </>
  );
}

interface SearchPanelProps {
  inputRef: React.RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
  disabled: boolean;
  supplierPicked: boolean;
  state: SearchState;
  onPick: (c: SourcedLookup) => void;
}

function SearchPanel({
  inputRef,
  value,
  onChange,
  onClear,
  disabled,
  supplierPicked,
  state,
  onPick,
}: SearchPanelProps) {
  return (
    <>
      <label
        htmlFor="quickadd-search"
        style={{
          display: 'block',
          fontFamily: "'Playfair Display', serif",
          fontSize: 16,
          marginBottom: 8,
        }}
      >
        Search by product name
      </label>
      <div className="flex" style={{ gap: 8, position: 'relative' }}>
        <input
          id="quickadd-search"
          ref={inputRef}
          type="text"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          placeholder={
            supplierPicked
              ? 'e.g. "almond milk", "coca cola 600", "lavazza espresso"…'
              : 'Pick a supplier above first…'
          }
          style={{
            flex: 1,
            height: 48,
            fontSize: 16,
            padding: '0 16px',
            paddingRight: value ? 36 : 16,
            border: '1px solid var(--border2)',
            borderRadius: 'var(--radius)',
            background: 'var(--bg)',
            outline: 'none',
          }}
        />
        {value && (
          <button
            type="button"
            onClick={onClear}
            aria-label="Clear search"
            style={{
              position: 'absolute',
              right: 12,
              top: 12,
              width: 24,
              height: 24,
              border: 'none',
              background: 'transparent',
              color: 'var(--text3)',
              cursor: 'pointer',
              fontSize: 18,
              borderRadius: '50%',
            }}
          >
            ×
          </button>
        )}
      </div>

      <div className="fs-11 text-muted mt-4">
        Powered by Open Food Facts. Best for groceries and packaged drinks. For
        non-food items use the barcode tab.
      </div>

      {state.kind === 'loading' && (
        <div className="fs-12 text-muted mt-12">
          <span className="spin" style={{ marginRight: 6 }}>↻</span>
          Searching for <strong>{state.query}</strong>…
        </div>
      )}

      {state.kind === 'empty' && (
        <div className="fs-12 text-muted mt-12">
          No products match <strong>“{state.query}”</strong>. Try a brand name
          plus product (e.g. “lala milk” instead of just “milk”).
        </div>
      )}

      {state.kind === 'error' && (
        <div className="auth-alert mt-12">{state.message}</div>
      )}

      {state.kind === 'results' && (
        <div className="mt-12">
          <div className="fs-11 text-muted mb-8">
            {state.candidates.length} match{state.candidates.length === 1 ? '' : 'es'} —
            click one to prefill the form.
          </div>
          <CandidateGrid candidates={state.candidates} onPick={onPick} />
        </div>
      )}
    </>
  );
}

function CandidateGrid({
  candidates,
  onPick,
}: {
  candidates: SourcedLookup[];
  onPick: (c: SourcedLookup) => void;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 10,
      }}
    >
      {candidates.map((c, i) => (
        <CandidateCard key={`${c.source}:${c.barcode ?? c.name}:${i}`} c={c} onPick={onPick} />
      ))}
    </div>
  );
}

function CandidateCard({
  c,
  onPick,
}: {
  c: SourcedLookup;
  onPick: (c: SourcedLookup) => void;
}) {
  const [hover, setHover] = useState(false);
  const contentLine =
    c.content_per_unit !== null && c.content_unit
      ? `${c.content_per_unit} ${c.content_unit.toLowerCase()}`
      : null;
  return (
    <button
      type="button"
      onClick={() => onPick(c)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        display: 'flex',
        gap: 12,
        padding: 12,
        background: hover ? '#fef8ef' : 'var(--surface)',
        border: `1px solid ${hover ? 'var(--gold)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        cursor: 'pointer',
        textAlign: 'left',
        fontFamily: 'inherit',
        transition: 'all 0.12s',
        alignItems: 'flex-start',
      }}
    >
      <CandidateThumb url={c.image_url} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          className="fw-600"
          style={{
            fontSize: 13,
            color: 'var(--text)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {c.name}
        </div>
        {c.brand && (
          <div className="fs-11 text-muted mt-4">{c.brand}</div>
        )}
        <div
          className="mt-8"
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}
        >
          <Badge tone={SOURCE_TONE[c.source]}>{SOURCE_LABEL[c.source]}</Badge>
          {contentLine && (
            <span className="fs-11 text-muted" style={{ fontFamily: 'monospace' }}>
              {contentLine}
            </span>
          )}
          {c.barcode && (
            <span className="fs-11 text-muted" style={{ fontFamily: 'monospace' }}>
              {c.barcode}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function CandidateThumb({ url }: { url: string | null }) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg)',
          border: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text3)',
          fontSize: 20,
          flexShrink: 0,
        }}
      >
        ◫
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      onError={() => setErrored(true)}
      style={{
        width: 56,
        height: 56,
        objectFit: 'cover',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg)',
        border: '1px solid var(--border)',
        flexShrink: 0,
      }}
    />
  );
}
