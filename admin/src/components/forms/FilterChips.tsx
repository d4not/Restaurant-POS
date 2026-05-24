import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useSavedFilters } from '../../store/savedReportFilters';

/* ── Anchored-popover hook ─────────────────────────────────────────────── */

interface AnchorPos {
  top: number;
  /** Distance from viewport right edge — used so the popover hugs the right
   *  side of its trigger and grows leftward. */
  right: number;
}

/**
 * Compute viewport-fixed coordinates that pin a popover to the bottom-right
 * of its trigger. Returns null until the trigger is measurable.
 *
 * We use position:fixed (not absolute) because the report layout sits inside
 * `.main`, which is `overflow: hidden`. An absolutely-positioned dropdown
 * extending past `.main`'s edges gets clipped — visible as the sidebar
 * "eating" the menu when it grows leftward. Fixed positioning escapes the
 * overflow context entirely.
 */
function useAnchoredPos(
  open: boolean,
  triggerRef: React.RefObject<HTMLElement | null>,
): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);

  useLayoutEffect(() => {
    if (!open) { setPos(null); return; }
    const measure = () => {
      const el = triggerRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      setPos({
        top: rect.bottom + 6,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    };
    measure();
    window.addEventListener('resize', measure);
    // Capture-phase scroll catches scrolls in any ancestor (e.g. .content).
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, triggerRef]);

  return pos;
}

/* ── Public types ──────────────────────────────────────────── */

export interface FilterField {
  key: string;
  label: string;
  /** Distinct values present in the current dataset; rendered as suggestions
   *  when the user is picking a value to filter on. */
  options: string[];
}

export interface FilterChip {
  /** Local React-key uid; not stable across save/load. */
  id: string;
  field: string;
  value: string;
  exclude: boolean;
}

interface FilterChipsProps {
  fields: FilterField[];
  chips: FilterChip[];
  onChange: (next: FilterChip[]) => void;
  /** Used to scope saved-set persistence — pick something stable per report
   *  (e.g. 'products-sold'). Saved sets do not appear when omitted. */
  storageKey?: string;
}

interface SavedShape {
  field: string;
  value: string;
  exclude: boolean;
}

/* ── Helpers ───────────────────────────────────────────────── */

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function chipsToSaved(chips: FilterChip[]): SavedShape[] {
  return chips.map((c) => ({ field: c.field, value: c.value, exclude: c.exclude }));
}

function savedToChips(saved: SavedShape[]): FilterChip[] {
  return saved.map((s) => ({ id: uid(), ...s }));
}

/* ── Predicate helpers — exposed so the consumer can apply chips uniformly ─ */

/**
 * Build a row predicate from a chip set. Within the same field, includes are
 * OR'd ("Medium OR Large"). Across fields, all groups are AND'd. Exclusion
 * chips reject any matching row regardless of field.
 *
 * `getValue(row, fieldKey)` may return `null` (field doesn't apply to the
 * row), a single string, or an array (for multi-valued fields like
 * "modifier"). For arrays:
 *   - an include chip matches the row when the value is in the array
 *   - an exclude chip rejects the row when the value is in the array
 *
 * A null value never matches any chip — so "exclude variant=Medium" won't
 * accidentally drop rows that have no variant at all.
 */
export function buildChipPredicate<R>(
  chips: FilterChip[],
  getValue: (row: R, field: string) => string | string[] | null,
): (row: R) => boolean {
  if (chips.length === 0) return () => true;

  const includeByField = new Map<string, string[]>();
  const excludes: { field: string; value: string }[] = [];
  for (const c of chips) {
    if (c.exclude) {
      excludes.push({ field: c.field, value: c.value });
    } else {
      const list = includeByField.get(c.field) ?? [];
      list.push(c.value);
      includeByField.set(c.field, list);
    }
  }

  const matches = (rv: string | string[] | null, target: string): boolean => {
    if (rv == null) return false;
    if (Array.isArray(rv)) return rv.includes(target);
    return rv === target;
  };

  return (row) => {
    for (const ex of excludes) {
      if (matches(getValue(row, ex.field), ex.value)) return false;
    }
    for (const [field, values] of includeByField) {
      const rv = getValue(row, field);
      if (rv == null) return false;
      const ok = values.some((v) => matches(rv, v));
      if (!ok) return false;
    }
    return true;
  };
}

/* ── Component ─────────────────────────────────────────────── */

export function FilterChips({ fields, chips, onChange, storageKey }: FilterChipsProps) {
  const saved = useSavedFilters<SavedShape[]>(storageKey ?? '__none__');
  const [adderOpen, setAdderOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const adderTriggerRef = useRef<HTMLButtonElement>(null);
  const savedTriggerRef = useRef<HTMLButtonElement>(null);
  const adderPos = useAnchoredPos(adderOpen, adderTriggerRef);
  const savedPos = useAnchoredPos(savedOpen, savedTriggerRef);

  const removeChip = (id: string) => {
    onChange(chips.filter((c) => c.id !== id));
  };

  const toggleExclude = (id: string) => {
    onChange(
      chips.map((c) => (c.id === id ? { ...c, exclude: !c.exclude } : c)),
    );
  };

  const addChip = (field: string, value: string, exclude: boolean) => {
    if (!value.trim()) return;
    // Don't add an exact duplicate.
    if (chips.some((c) => c.field === field && c.value === value && c.exclude === exclude)) {
      setAdderOpen(false);
      return;
    }
    onChange([...chips, { id: uid(), field, value, exclude }]);
    setAdderOpen(false);
  };

  const clearAll = () => onChange([]);

  return (
    <div
      style={{
        display: 'flex',
        gap: 8,
        flexWrap: 'wrap',
        alignItems: 'center',
        padding: '6px 0',
      }}
    >
      {chips.map((chip) => {
        const fieldLabel =
          fields.find((f) => f.key === chip.field)?.label ?? chip.field;
        return (
          <ChipPill
            key={chip.id}
            chip={chip}
            fieldLabel={fieldLabel}
            onToggleExclude={() => toggleExclude(chip.id)}
            onRemove={() => removeChip(chip.id)}
          />
        );
      })}

      <button
        ref={adderTriggerRef}
        type="button"
        className="filter-pill"
        onClick={() => { setAdderOpen((v) => !v); setSavedOpen(false); }}
      >
        + Add filter
      </button>
      {adderOpen && adderPos && (
        <FilterAdder
          fields={fields}
          existing={chips}
          pos={adderPos}
          ignoreRef={adderTriggerRef}
          onAdd={addChip}
          onClose={() => setAdderOpen(false)}
        />
      )}

      {storageKey && (
        <>
          <button
            ref={savedTriggerRef}
            type="button"
            className="filter-pill"
            onClick={() => { setSavedOpen((v) => !v); setAdderOpen(false); }}
          >
            ★ Saved ▾
          </button>
          {savedOpen && savedPos && (
            <SavedFiltersMenu
              saved={saved.saved}
              hasCurrent={chips.length > 0}
              pos={savedPos}
              ignoreRef={savedTriggerRef}
              onSave={(name) => saved.save(name, chipsToSaved(chips))}
              onLoad={(s) => { onChange(savedToChips(s.chips)); setSavedOpen(false); }}
              onRename={(id, name) => saved.rename(id, name)}
              onRemove={(id) => saved.remove(id)}
              onClose={() => setSavedOpen(false)}
            />
          )}
        </>
      )}

      {chips.length > 0 && (
        <button
          type="button"
          className="filter-pill"
          onClick={clearAll}
          title="Remove all filter chips"
        >
          Clear all
        </button>
      )}
    </div>
  );
}

/* ── Chip pill ─────────────────────────────────────────────── */

interface ChipPillProps {
  chip: FilterChip;
  fieldLabel: string;
  onToggleExclude: () => void;
  onRemove: () => void;
}

function ChipPill({ chip, fieldLabel, onToggleExclude, onRemove }: ChipPillProps) {
  const baseStyle: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 4px 4px 10px',
    borderRadius: 16,
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid',
    background: chip.exclude ? 'var(--red-bg)' : 'var(--gold-bg)',
    borderColor: chip.exclude ? 'var(--red)' : 'var(--gold)',
    color: chip.exclude ? 'var(--red)' : 'var(--text)',
  };

  return (
    <span style={baseStyle}>
      <span style={{ fontWeight: 700 }}>{fieldLabel}</span>
      <button
        type="button"
        onClick={onToggleExclude}
        title={chip.exclude ? 'Switch to "is"' : 'Switch to "is NOT"'}
        style={{
          background: 'transparent',
          border: 'none',
          padding: 0,
          color: 'inherit',
          cursor: 'pointer',
          fontWeight: 700,
        }}
      >
        {chip.exclude ? '≠' : '='}
      </button>
      <span>“{chip.value}”</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove filter"
        style={{
          width: 20, height: 20, borderRadius: '50%',
          border: 'none',
          background: 'rgba(0,0,0,0.06)',
          color: 'inherit',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 12, lineHeight: 1,
        }}
      >
        ×
      </button>
    </span>
  );
}

/* ── Add-filter popover ────────────────────────────────────── */

interface FilterAdderProps {
  fields: FilterField[];
  existing: FilterChip[];
  pos: AnchorPos;
  ignoreRef: React.RefObject<HTMLElement | null>;
  onAdd: (field: string, value: string, exclude: boolean) => void;
  onClose: () => void;
}

function FilterAdder({ fields, existing, pos, ignoreRef, onAdd, onClose }: FilterAdderProps) {
  const [field, setField] = useState<string>(fields[0]?.key ?? '');
  const [value, setValue] = useState<string>('');
  const [exclude, setExclude] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Click-outside / Esc to close. Ignore clicks on the trigger itself —
  // otherwise toggling the popover would close-then-reopen on the same click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (ignoreRef.current?.contains(target)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose, ignoreRef]);

  const fieldDef = fields.find((f) => f.key === field);
  const suggestions = useMemo(() => {
    if (!fieldDef) return [];
    const needle = value.trim().toLowerCase();
    // Drop options the user already has a chip for to avoid duplicates.
    const usedSameMode = new Set(
      existing
        .filter((c) => c.field === field && c.exclude === exclude)
        .map((c) => c.value),
    );
    return fieldDef.options
      .filter((o) => !usedSameMode.has(o))
      .filter((o) => o.toLowerCase().includes(needle))
      .slice(0, 30);
  }, [fieldDef, value, existing, field, exclude]);

  const submit = () => {
    if (!field || !value.trim()) return;
    onAdd(field, value.trim(), exclude);
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        zIndex: 500,
        width: 320,
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        boxShadow: 'var(--shadow-lg)',
        padding: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', gap: 8 }}>
        <select
          className="search-box"
          style={{ flex: '0 0 110px' }}
          value={field}
          onChange={(e) => { setField(e.target.value); setValue(''); }}
        >
          {fields.map((f) => (
            <option key={f.key} value={f.key}>{f.label}</option>
          ))}
        </select>
        <button
          type="button"
          className="filter-pill"
          onClick={() => setExclude((v) => !v)}
          title="Toggle inclusion / exclusion"
          style={{
            background: exclude ? 'var(--red-bg)' : undefined,
            borderColor: exclude ? 'var(--red)' : undefined,
            color: exclude ? 'var(--red)' : undefined,
          }}
        >
          {exclude ? 'is NOT' : 'is'}
        </button>
      </div>
      <input
        className="search-box"
        autoFocus
        placeholder="Type or pick a value…"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      {suggestions.length > 0 && (
        <div
          style={{
            maxHeight: 160,
            overflowY: 'auto',
            border: '1px solid var(--border)',
            borderRadius: 4,
            background: 'var(--bg)',
          }}
        >
          {suggestions.map((opt) => (
            <button
              key={opt}
              type="button"
              onClick={() => onAdd(field, opt, exclude)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '6px 10px',
                fontSize: 12.5,
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = '#fef8ef'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            >
              {opt}
            </button>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submit}
          disabled={!value.trim()}
        >
          Add
        </button>
      </div>
    </div>
  );
}

/* ── Saved-filters dropdown ────────────────────────────────── */

interface SavedFiltersMenuProps {
  saved: ReturnType<typeof useSavedFilters<SavedShape[]>>['saved'];
  hasCurrent: boolean;
  pos: AnchorPos;
  ignoreRef: React.RefObject<HTMLElement | null>;
  onSave: (name: string) => void;
  onLoad: (set: SavedFiltersMenuProps['saved'][number]) => void;
  onRename: (id: string, name: string) => void;
  onRemove: (id: string) => void;
  onClose: () => void;
}

function SavedFiltersMenu({
  saved,
  hasCurrent,
  pos,
  ignoreRef,
  onSave,
  onLoad,
  onRename,
  onRemove,
  onClose,
}: SavedFiltersMenuProps) {
  const [savingName, setSavingName] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      const target = e.target as Node;
      if (ref.current?.contains(target)) return;
      if (ignoreRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [onClose, ignoreRef]);

  const submitSave = () => {
    if (!savingName.trim() || !hasCurrent) return;
    onSave(savingName);
    setSavingName('');
  };

  return (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        top: pos.top,
        right: pos.right,
        zIndex: 500,
        width: 280,
        background: 'var(--surface)',
        border: '1px solid var(--border2)',
        borderRadius: 8,
        boxShadow: 'var(--shadow-lg)',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      <div style={{ display: 'flex', gap: 6 }}>
        <input
          className="search-box"
          placeholder={hasCurrent ? 'Save current as…' : 'Add a chip first'}
          value={savingName}
          onChange={(e) => setSavingName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submitSave(); }}
          disabled={!hasCurrent}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={submitSave}
          disabled={!hasCurrent || !savingName.trim()}
        >
          Save
        </button>
      </div>
      {saved.length === 0 ? (
        <div className="fs-12 text-muted" style={{ padding: '8px 6px' }}>
          No saved filter sets yet.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {saved.map((s) => (
            <SavedRow
              key={s.id}
              entry={s}
              onLoad={() => onLoad(s)}
              onRename={(name) => onRename(s.id, name)}
              onRemove={() => onRemove(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function SavedRow({
  entry,
  onLoad,
  onRename,
  onRemove,
}: {
  entry: { id: string; name: string; chips: SavedShape[] };
  onLoad: () => void;
  onRename: (name: string) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(entry.name);
  const submit = () => {
    if (name.trim() && name.trim() !== entry.name) onRename(name);
    setEditing(false);
  };
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 8px',
        borderRadius: 4,
        background: 'var(--bg)',
        fontSize: 12.5,
      }}
    >
      {editing ? (
        <input
          className="search-box"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={submit}
          onKeyDown={(e) => { if (e.key === 'Enter') submit(); }}
          style={{ flex: 1 }}
        />
      ) : (
        <button
          type="button"
          onClick={onLoad}
          title={`Apply (${entry.chips.length} chip${entry.chips.length === 1 ? '' : 's'})`}
          style={{
            flex: 1, textAlign: 'left',
            background: 'transparent', border: 'none',
            cursor: 'pointer', color: 'var(--text)',
            fontSize: 12.5,
            padding: 0,
          }}
        >
          {entry.name}
          <span className="fs-11 text-muted" style={{ marginLeft: 6 }}>
            ({entry.chips.length})
          </span>
        </button>
      )}
      <button
        type="button"
        title="Rename"
        onClick={() => setEditing((v) => !v)}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--text3)', fontSize: 12 }}
      >
        ✎
      </button>
      <button
        type="button"
        title="Delete"
        onClick={onRemove}
        style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--red)', fontSize: 12 }}
      >
        ×
      </button>
    </div>
  );
}
