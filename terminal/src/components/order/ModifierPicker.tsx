import { useMemo, useState } from 'react';
import type {
  ModifierGroup,
  ModifierOption,
  Product,
  ProductVariant,
} from '../../types/api';
import { formatMoney } from '../../utils/format';

interface Props {
  product: Product;
  variant: ProductVariant | null;
  onAdd: (modifierIds: string[]) => void;
  onCancel: () => void;
}

// Seed the selection for a single group:
// - SWAP + required → preselect the group's is_default modifier (if any)
// - otherwise start empty. ADD groups are multi-select, SWAP is single-select.
function initialSelectionFor(group: ModifierGroup): Set<string> {
  const selected = new Set<string>();
  if (group.type === 'SWAP' && group.required) {
    const def = group.modifiers.find((m) => m.is_default && m.active);
    if (def) selected.add(def.id);
  }
  return selected;
}

// Running price preview: base unit price + sum of selected extras. Only used
// for display — the authoritative total is recomputed by the backend after
// the item is added to the order.
function computePreview(
  basePrice: string | null,
  selectedExtras: Map<string, ModifierOption>,
): number {
  const base = basePrice == null ? 0 : Number(basePrice);
  let extras = 0;
  for (const m of selectedExtras.values()) extras += Number(m.extra_price);
  return base + extras;
}

export function ModifierPicker({ product, variant, onAdd, onCancel }: Props) {
  const groups = useMemo<ModifierGroup[]>(
    () =>
      product.modifier_groups
        .map((link) => link.modifier_group)
        .sort((a, b) => a.display_order - b.display_order),
    [product],
  );

  // One Set of selected modifier ids per group. Lives in this picker's state
  // so Cancel returns to the grid with no side-effects and OK sends a flat
  // id list to the caller.
  const [selections, setSelections] = useState<Record<string, Set<string>>>(() => {
    const init: Record<string, Set<string>> = {};
    for (const g of groups) init[g.id] = initialSelectionFor(g);
    return init;
  });

  const basePrice = variant?.sell_price ?? product.sell_price;

  // Flat map of id → option for quick price lookup when building the preview.
  const allOptions = useMemo(() => {
    const map = new Map<string, ModifierOption>();
    for (const g of groups) for (const m of g.modifiers) map.set(m.id, m);
    return map;
  }, [groups]);

  const selectedExtras = useMemo(() => {
    const map = new Map<string, ModifierOption>();
    for (const g of groups) {
      const selected = selections[g.id];
      if (!selected) continue;
      for (const id of selected) {
        const opt = allOptions.get(id);
        if (opt) map.set(id, opt);
      }
    }
    return map;
  }, [groups, selections, allOptions]);

  function toggle(group: ModifierGroup, modifier: ModifierOption) {
    setSelections((prev) => {
      const current = new Set(prev[group.id] ?? []);
      if (group.type === 'SWAP' || group.max_selection === 1) {
        // SWAP + max=1: radio behaviour. Tapping the same option while it's
        // required is a no-op; otherwise tapping a selected option clears it.
        if (current.has(modifier.id)) {
          if (!group.required) current.delete(modifier.id);
        } else {
          current.clear();
          current.add(modifier.id);
        }
      } else {
        // ADD / multi-select. Honour max_selection — silently drop the oldest
        // selection when the user over-picks so the button still responds
        // rather than appearing stuck.
        if (current.has(modifier.id)) {
          current.delete(modifier.id);
        } else {
          if (current.size >= group.max_selection) {
            const first = current.values().next().value;
            if (first) current.delete(first);
          }
          current.add(modifier.id);
        }
      }
      return { ...prev, [group.id]: current };
    });
  }

  // Disable the "Add to Order" button until every required group has at least
  // min_selection picks. Keeps the user from submitting an incomplete line.
  const satisfied = useMemo(() => {
    for (const g of groups) {
      const count = selections[g.id]?.size ?? 0;
      if (g.required && count < Math.max(1, g.min_selection)) return false;
      if (!g.required && count < g.min_selection) return false;
    }
    return true;
  }, [groups, selections]);

  function submit() {
    // Flatten selections in the group's display_order — the backend processes
    // the array in order and the order matters for repeated modifiers.
    const ids: string[] = [];
    for (const g of groups) {
      const set = selections[g.id];
      if (!set) continue;
      for (const m of g.modifiers) {
        if (set.has(m.id)) ids.push(m.id);
      }
    }
    onAdd(ids);
  }

  const preview = computePreview(basePrice, selectedExtras);

  return (
    <div className="modal-overlay" role="dialog" aria-label={`Customize ${product.name}`}>
      <div className="modal">
        <header className="modal-header">
          <div>
            <div
              className="text-mute"
              style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}
            >
              Customize
            </div>
            <h2 style={{ marginTop: 4 }}>
              {product.name}
              {variant && (
                <span style={{ color: 'var(--text-3)', fontWeight: 500, marginLeft: 8, fontSize: 16 }}>
                  · {variant.name}
                </span>
              )}
            </h2>
          </div>
        </header>

        <div className="modal-body">
          {groups.length === 0 && (
            <div className="text-mute">No modifiers for this item.</div>
          )}

          {groups.map((group) => {
            const selected = selections[group.id] ?? new Set<string>();
            const rule =
              group.type === 'SWAP'
                ? 'Pick one'
                : group.max_selection === 1
                  ? 'Pick one'
                  : group.required
                    ? `Pick ${group.min_selection}–${group.max_selection}`
                    : `Up to ${group.max_selection}`;
            return (
              <section className="mod-group" key={group.id}>
                <div className="mod-group-title">
                  <span>{group.name}</span>
                  <span>
                    {rule}
                    {group.required && <span className="required"> · required</span>}
                  </span>
                </div>
                <div className="mod-options">
                  {group.modifiers
                    .filter((m) => m.active)
                    .map((m) => {
                      const extra = Number(m.extra_price);
                      const isSelected = selected.has(m.id);
                      const isDefaultSwap = group.type === 'SWAP' && m.is_default;
                      const extraLabel =
                        extra === 0 ? (
                          // Surface "default" on the SWAP option the kitchen
                          // would fall back to if the cashier picked nothing.
                          isDefaultSwap ? 'default' : ''
                        ) : (
                          `+${formatMoney(extra)}`
                        );
                      return (
                        <button
                          key={m.id}
                          type="button"
                          className={`mod-option ${isSelected ? 'selected' : ''} ${
                            isDefaultSwap && !isSelected ? 'default-hint' : ''
                          }`}
                          onClick={() => toggle(group, m)}
                        >
                          <span>{m.name}</span>
                          {extraLabel && <span className="extra">{extraLabel}</span>}
                        </button>
                      );
                    })}
                </div>
              </section>
            );
          })}
        </div>

        <footer className="modal-footer">
          <div>
            <div className="text-mute" style={{ fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase' }}>
              Total
            </div>
            <div className="preview">{formatMoney(preview)}</div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="btn btn-ghost btn-lg" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary btn-lg"
              onClick={submit}
              disabled={!satisfied}
            >
              Add to Order
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
