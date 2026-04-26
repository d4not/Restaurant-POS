import { useEffect, useMemo, useState } from 'react';
import type {
  Modifier,
  ModifierGroup,
  PosProduct,
  ProductVariant,
} from '../api/products';
import { formatMoney } from '../utils/format';

// Modal launched when the cashier taps a product card. Walks two optional
// steps:
//   1. Variant picker — required for DISH products with sizes ("Small / Med /
//      Large"). Skipped if the product has no variants.
//   2. Modifier picker — required if the product has any modifier groups
//      attached, and the cashier must satisfy each group's min/max selection
//      rules before the "Add" button enables.
//
// Returns the chosen variant_id and an ordered list of modifier_ids on submit.
// SWAP groups force a single radio choice (with the group's is_default
// pre-selected); ADD groups allow up to max_selection checkboxes.

interface Props {
  product: PosProduct;
  onClose: () => void;
  onSubmit: (selection: {
    variantId: string | null;
    modifierIds: string[];
    notes: string | null;
  }) => void;
  busy?: boolean;
  // When set, the picker opens in "edit mode" with these initial values
  // pre-selected and the CTA reads "Save changes" instead of "Add to ticket".
  // Used by TableDetail for tap-to-edit on an existing ticket row.
  initial?: {
    variantId: string | null;
    modifierIds: string[];
    notes: string | null;
  };
  mode?: 'add' | 'edit';
}

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modal: {
    width: 560,
    maxWidth: '100%',
    maxHeight: 'calc(100vh - 64px)',
    background: 'var(--bg2)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  head: {
    padding: '20px 24px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 16,
  },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    margin: 0,
  },
  sub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    background: 'var(--bg)',
    color: 'var(--text2)',
    border: '1px solid var(--border)',
    fontSize: 18,
    cursor: 'pointer',
  },
  body: {
    padding: '16px 24px 8px',
    overflowY: 'auto',
    flex: 1,
    minHeight: 0,
  },
  groupHeader: {
    display: 'flex',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    margin: '14px 0 8px',
  },
  groupName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  groupHint: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    fontWeight: 600,
  },
  optionGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 10,
  },
  variantBig: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
    gap: 10,
  },
  noteInput: {
    width: '100%',
    minHeight: 64,
    padding: '12px 14px',
    border: '1.5px solid var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical',
  },
  err: {
    background: 'rgba(196,80,64,0.08)',
    color: 'var(--red)',
    padding: '8px 12px',
    borderRadius: 8,
    fontSize: 12,
    margin: '8px 0',
  },
  foot: {
    padding: '16px 24px',
    borderTop: '1px solid var(--border)',
    display: 'flex',
    gap: 10,
    background: 'var(--bg2)',
  },
  cancelBtn: {
    flex: 1,
    padding: '12px 18px',
    borderRadius: 10,
    background: 'var(--bg)',
    color: 'var(--text1)',
    border: '1px solid var(--border)',
    fontSize: 14,
    fontWeight: 600,
    cursor: 'pointer',
    minHeight: 48,
    fontFamily: 'inherit',
  },
};

const submitBtnStyle = (enabled: boolean): React.CSSProperties => ({
  flex: 2,
  padding: '12px 18px',
  borderRadius: 10,
  background: enabled ? 'var(--text1)' : 'var(--text3)',
  color: '#fff',
  border: '1px solid ' + (enabled ? 'var(--text1)' : 'var(--text3)'),
  fontSize: 14,
  fontWeight: 600,
  cursor: enabled ? 'pointer' : 'not-allowed',
  minHeight: 48,
  fontFamily: 'inherit',
  opacity: enabled ? 1 : 0.7,
});

const variantBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '14px 14px',
  borderRadius: 10,
  background: active ? 'var(--gold-soft)' : 'var(--bg)',
  border: '1.5px solid ' + (active ? 'var(--gold)' : 'var(--border)'),
  color: 'var(--text1)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'inherit',
  minHeight: 64,
});

const modBtnStyle = (active: boolean): React.CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 10,
  padding: '12px 14px',
  borderRadius: 10,
  background: active ? 'var(--gold-soft)' : 'var(--bg)',
  border: '1.5px solid ' + (active ? 'var(--gold)' : 'var(--border)'),
  color: 'var(--text1)',
  cursor: 'pointer',
  fontSize: 13,
  fontWeight: 500,
  textAlign: 'left',
  fontFamily: 'inherit',
  minHeight: 48,
});

const checkmarkStyle = (active: boolean): React.CSSProperties => ({
  width: 20,
  height: 20,
  borderRadius: 6,
  border: '1.5px solid ' + (active ? 'var(--gold)' : 'var(--border)'),
  background: active ? 'var(--gold)' : 'transparent',
  color: '#2c2420',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 12,
  fontWeight: 700,
  flexShrink: 0,
});

function describeGroup(group: ModifierGroup): string {
  const min = group.min_selection;
  const max = group.max_selection;
  if (group.type === 'SWAP') return 'Pick one';
  if (max === 1) return min > 0 ? 'Required · pick 1' : 'Optional · pick 1';
  if (min === 0) return `Optional · up to ${max}`;
  if (min === max) return `Pick ${min}`;
  return `Pick ${min}–${max}`;
}

// Determine the group's initial selection. SWAP groups always start with the
// is_default modifier highlighted (or the first modifier if none is flagged) —
// this matches restaurant flow: "Latte" already implies whole milk, the
// cashier only taps to swap to almond.
function defaultSelectionFor(group: ModifierGroup): string[] {
  const actives = group.modifiers.filter((m) => m.active);
  if (group.type === 'SWAP') {
    const dflt = actives.find((m) => m.is_default) ?? actives[0];
    return dflt ? [dflt.id] : [];
  }
  return actives.filter((m) => m.is_default).map((m) => m.id);
}

export function ProductPicker({
  product,
  onClose,
  onSubmit,
  busy,
  initial,
  mode = 'add',
}: Props) {
  const variants = useMemo(
    () => product.variants.filter((v) => v.active),
    [product.variants],
  );
  const groups = useMemo(
    () =>
      product.modifier_groups
        .map((link) => link.modifier_group)
        .filter((g) => g.modifiers.some((m) => m.active))
        .sort((a, b) => a.display_order - b.display_order),
    [product.modifier_groups],
  );

  // In edit mode the initial variant/modifiers come from the existing line so
  // the cashier sees their current selection highlighted; in add mode we fall
  // back to the SWAP defaults so a fresh tap starts from the menu's defaults.
  const initialVariantId = useMemo(() => {
    if (initial && (initial.variantId !== undefined)) return initial.variantId;
    return variants[0]?.id ?? null;
  }, [initial, variants]);

  const initialSelection = useMemo<Record<string, string[]>>(() => {
    const out: Record<string, string[]> = {};
    if (initial) {
      const initialSet = new Set(initial.modifierIds);
      for (const g of groups) {
        const picked = g.modifiers
          .filter((m) => m.active && initialSet.has(m.id))
          .map((m) => m.id);
        // SWAP must always have a selection — fall back to the group default
        // if the line was somehow saved without one.
        if (picked.length === 0 && g.type === 'SWAP') {
          out[g.id] = defaultSelectionFor(g);
        } else {
          out[g.id] = picked;
        }
      }
      return out;
    }
    for (const g of groups) out[g.id] = defaultSelectionFor(g);
    return out;
  }, [initial, groups]);

  const [variantId, setVariantId] = useState<string | null>(initialVariantId);
  // groupId → ordered list of selected modifier ids for that group.
  const [selection, setSelection] = useState<Record<string, string[]>>(initialSelection);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);

  // Reset internal state when the modal is reused for a different product or
  // edit-target. We key the reset off product.id + the initial signature so a
  // re-render with the same target doesn't clobber in-progress edits.
  const initialSig = JSON.stringify(initial ?? null);
  useEffect(() => {
    setVariantId(initialVariantId);
    setSelection(initialSelection);
    setNotes(initial?.notes ?? '');
    setError(null);
  }, [product.id, initialSig, initialVariantId, initialSelection, initial?.notes]);

  function toggleModifier(group: ModifierGroup, modifierId: string) {
    setError(null);
    setSelection((prev) => {
      const current = prev[group.id] ?? [];
      const isSelected = current.includes(modifierId);
      let next: string[];
      if (group.type === 'SWAP' || group.max_selection === 1) {
        next = isSelected ? [] : [modifierId];
        // SWAP must always have a selection; refuse to deselect — matches the
        // backend's `is_default` fallback (the customer always has *some*
        // milk; tap a different milk to swap).
        if (group.type === 'SWAP' && next.length === 0) next = [modifierId];
      } else if (isSelected) {
        next = current.filter((id) => id !== modifierId);
      } else {
        // ADD groups respect max_selection; bumping the cap drops the oldest.
        next = [...current, modifierId];
        if (next.length > group.max_selection) {
          next = next.slice(next.length - group.max_selection);
        }
      }
      return { ...prev, [group.id]: next };
    });
  }

  function validate(): string | null {
    if (variants.length > 0 && !variantId) {
      return 'Choose a size to continue.';
    }
    for (const g of groups) {
      const count = selection[g.id]?.length ?? 0;
      if (count < g.min_selection) {
        return `${g.name}: pick at least ${g.min_selection}.`;
      }
      if (count > g.max_selection) {
        return `${g.name}: pick at most ${g.max_selection}.`;
      }
    }
    return null;
  }

  function submit() {
    const err = validate();
    if (err) {
      setError(err);
      return;
    }
    const ids: string[] = [];
    for (const g of groups) ids.push(...(selection[g.id] ?? []));
    const trimmedNotes = notes.trim();
    onSubmit({
      variantId,
      modifierIds: ids,
      notes: trimmedNotes ? trimmedNotes : null,
    });
  }

  const submitEnabled = !busy && validate() === null;

  return (
    <div style={styles.scrim} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.head}>
          <div>
            <h2 style={styles.title}>{product.name}</h2>
            <div style={styles.sub}>
              {variants.length > 0 ? 'Pick a size and any modifiers.' : 'Confirm modifiers to add to the order.'}
            </div>
          </div>
          <button type="button" style={styles.closeBtn} onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div style={styles.body}>
          {variants.length > 0 && (
            <>
              <div style={styles.groupHeader}>
                <span style={styles.groupName}>Size</span>
                <span style={styles.groupHint}>Required</span>
              </div>
              <div style={styles.variantBig}>
                {variants.map((v: ProductVariant) => {
                  const active = v.id === variantId;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      style={variantBtnStyle(active)}
                      onClick={() => setVariantId(v.id)}
                    >
                      <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text1)' }}>
                        {v.name}
                      </span>
                      <span
                        style={{
                          fontFamily: "'Playfair Display', serif",
                          fontSize: 18,
                          fontWeight: 600,
                          fontVariantNumeric: 'tabular-nums',
                          color: 'var(--text1)',
                        }}
                      >
                        {formatMoney(v.sell_price)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {groups.map((g) => {
            const current = selection[g.id] ?? [];
            const single = g.type === 'SWAP' || g.max_selection === 1;
            return (
              <div key={g.id}>
                <div style={styles.groupHeader}>
                  <span style={styles.groupName}>{g.name}</span>
                  <span style={styles.groupHint}>{describeGroup(g)}</span>
                </div>
                <div style={styles.optionGrid}>
                  {g.modifiers
                    .filter((m) => m.active)
                    .sort((a, b) => a.display_order - b.display_order)
                    .map((m: Modifier) => {
                      const active = current.includes(m.id);
                      const extra = Number(m.extra_price);
                      return (
                        <button
                          key={m.id}
                          type="button"
                          style={modBtnStyle(active)}
                          onClick={() => toggleModifier(g, m.id)}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={checkmarkStyle(active)}>
                              {active ? (single ? '●' : '✓') : ''}
                            </span>
                            <span>{m.name}</span>
                          </span>
                          {extra > 0 && (
                            <span
                              style={{
                                fontFamily: "'Playfair Display', serif",
                                fontVariantNumeric: 'tabular-nums',
                                fontSize: 13,
                                fontWeight: 600,
                                color: 'var(--text2)',
                              }}
                            >
                              +{formatMoney(m.extra_price)}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>
            );
          })}

          <div style={styles.groupHeader}>
            <span style={styles.groupName}>Note</span>
            <span style={styles.groupHint}>Optional</span>
          </div>
          <textarea
            style={styles.noteInput}
            placeholder="e.g., extra hot, no foam, allergy info…"
            value={notes}
            maxLength={240}
            onChange={(e) => setNotes(e.target.value)}
          />

          {error && <div style={styles.err}>{error}</div>}
        </div>

        <div style={styles.foot}>
          <button type="button" style={styles.cancelBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            style={submitBtnStyle(submitEnabled)}
            onClick={submit}
            disabled={!submitEnabled}
          >
            {busy
              ? mode === 'edit' ? 'Saving…' : 'Adding…'
              : mode === 'edit' ? 'Save changes' : 'Add to ticket'}
          </button>
        </div>
      </div>
    </div>
  );
}
