// Inline numeric input that persists on blur (or Enter), reverts on Esc, and
// surfaces a small per-cell error. Used by RecipeItemRow for quantity and
// waste-% edits — keeps the table dense while still validating on each commit.

import { useEffect, useState, type CSSProperties } from 'react';

interface Props {
  value: string;
  min?: number;
  max?: number;
  step?: string;
  /** When the field is cleared, write this value instead of erroring. */
  emptyAs?: number;
  validate?: (n: number) => string | null;
  onSave: (n: number) => Promise<unknown>;
  disabled?: boolean;
}

export function InlineNumberCell({
  value,
  min,
  max,
  step = 'any',
  emptyAs,
  validate,
  onSave,
  disabled,
}: Props) {
  const [draft, setDraft] = useState<string>(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = async () => {
    if (saving) return;
    let next: number;
    if (draft.trim() === '') {
      if (emptyAs === undefined) {
        setError('Required');
        setDraft(value);
        return;
      }
      next = emptyAs;
    } else {
      next = Number(draft);
      if (!Number.isFinite(next)) {
        setError('Invalid');
        return;
      }
    }
    const validationError = validate?.(next);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (Number(value) === next) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={wrap}>
      <input
        type="number"
        value={draft}
        min={min}
        max={max}
        step={step}
        disabled={saving || disabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          } else if (e.key === 'Escape') {
            setDraft(value);
            setError(null);
            (e.target as HTMLInputElement).blur();
          }
        }}
        style={{ ...input, ...(error ? inputError : null), ...(saving ? inputSaving : null) }}
      />
      {error && <span style={errorText}>{error}</span>}
    </div>
  );
}

const wrap: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  minWidth: 0,
};

const input: CSSProperties = {
  width: '100%',
  height: 30,
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--bg)',
  padding: '0 8px',
  fontSize: 13,
  color: 'var(--text1)',
  fontFamily: "'Playfair Display', serif",
  fontVariantNumeric: 'tabular-nums',
  outline: 'none',
  textAlign: 'right',
};

const inputError: CSSProperties = {
  borderColor: 'var(--red)',
  background: 'rgba(196,80,64,0.08)',
};

const inputSaving: CSSProperties = {
  opacity: 0.7,
};

const errorText: CSSProperties = {
  fontSize: 10,
  color: 'var(--red)',
  fontWeight: 500,
};
