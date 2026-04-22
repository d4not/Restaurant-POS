import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, EmptyState } from '../../components/ui';
import {
  useCreateModifier,
  useDeleteModifier,
  useDeleteModifierGroup,
  useGroupLinkedProducts,
  useGroupOverrides,
  useModifierGroup,
  useUpdateModifier,
  useUpdateModifierGroup,
} from '../../hooks/useModifierGroups';
import { useSupplies } from '../../hooks/useSupplies';
import type {
  LinkedProduct,
  Modifier,
  ModifierGroup,
  ModifierGroupType,
  ModifierProductOverride,
  UpdateModifierGroupInput,
  UpdateModifierInput,
} from '../../types/menu';
import { formatMoney } from '../../utils/format';
import { productTypeTone } from './product-meta';

const UNIT_OPTIONS = [
  { value: 'ml', label: 'ml' },
  { value: 'l', label: 'l' },
  { value: 'g', label: 'g' },
  { value: 'kg', label: 'kg' },
  { value: 'oz', label: 'oz' },
  { value: 'fl_oz', label: 'fl oz' },
  { value: 'piece', label: 'piece' },
  { value: 'unit', label: 'unit' },
];

// Column templates shared between the table head, the add row, and each
// modifier row so every cell lines up regardless of group type.
const SWAP_GRID = '1.6fr 120px 110px 100px 1.4fr 110px 60px';
const ADD_GRID = '1.6fr 120px 1.4fr 100px 90px 110px 60px';

export function ModifierGroupDetail() {
  const { id = '' } = useParams<{ id: string }>();

  const groupQ = useModifierGroup(id);
  const productsQ = useGroupLinkedProducts(id);
  const overridesQ = useGroupOverrides(id);

  const updateGroup = useUpdateModifierGroup();
  const deleteGroup = useDeleteModifierGroup();

  const group = groupQ.data;

  // Header inline-edit state. Mirrors the ProductDetail pattern: diff a
  // buildFormState(group) snapshot against the form, show the save bar when
  // they differ, and rebuild the snapshot after every fetch.
  const [form, setForm] = useState<HeaderFormState | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (group) setForm(buildFormState(group));
  }, [group]);

  const setField = <K extends keyof HeaderFormState>(
    key: K,
    value: HeaderFormState[K],
  ) => {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setFieldErrors((e) => {
      if (!(key in e)) return e;
      const rest = { ...e };
      delete rest[key as string];
      return rest;
    });
    setSaveError(null);
  };

  const isDirty = useMemo(() => {
    if (!group || !form) return false;
    const original = buildFormState(group);
    return (Object.keys(form) as (keyof HeaderFormState)[]).some(
      (k) => form[k] !== original[k],
    );
  }, [group, form]);

  const onDiscard = () => {
    if (!group) return;
    setForm(buildFormState(group));
    setFieldErrors({});
    setSaveError(null);
  };

  const onSave = async () => {
    if (!group || !form) return;
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = 'Name is required';
    const min = Number(form.min_selection);
    const max = Number(form.max_selection);
    if (!Number.isInteger(min) || min < 0) {
      errors.min_selection = 'Min must be a non-negative integer';
    }
    if (!Number.isInteger(max) || max < 1) {
      errors.max_selection = 'Max must be an integer ≥ 1';
    }
    if (
      Number.isInteger(min) &&
      Number.isInteger(max) &&
      min >= 0 &&
      max >= 1 &&
      min > max
    ) {
      errors.max_selection = 'Max cannot be less than min';
    }
    const displayOrder = Number(form.display_order);
    if (!Number.isFinite(displayOrder)) {
      errors.display_order = 'Must be a number';
    }
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    const original = buildFormState(group);
    const payload: UpdateModifierGroupInput = {};
    if (form.name.trim() !== original.name) payload.name = form.name.trim();
    if (form.type !== original.type) payload.type = form.type;
    if (form.min_selection !== original.min_selection) payload.min_selection = min;
    if (form.max_selection !== original.max_selection) payload.max_selection = max;
    if (form.required !== original.required) payload.required = form.required;
    if (form.display_order !== original.display_order) {
      payload.display_order = displayOrder;
    }

    setSaveError(null);
    try {
      await updateGroup.mutateAsync({ id: group.id, input: payload });
      setFieldErrors({});
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const onDeleteGroup = async () => {
    if (!group) return;
    const linkedCount = productsQ.data?.length ?? 0;
    if (linkedCount > 0) {
      if (
        !confirm(
          `"${group.name}" is attached to ${linkedCount} product(s). Deleting will detach it from all of them. Continue?`,
        )
      )
        return;
    } else {
      if (!confirm(`Delete "${group.name}"?`)) return;
    }
    try {
      await deleteGroup.mutateAsync(group.id);
      window.location.href = '/menu/modifier-groups';
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  if (groupQ.isLoading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading group…
      </div>
    );
  }

  if (groupQ.error || !group || !form) {
    return (
      <EmptyState
        icon="⚠"
        message="Modifier group not found"
        sub={(groupQ.error as Error | null)?.message}
        action={
          <Link to="/menu/modifier-groups">
            <Button variant="secondary">Back to groups</Button>
          </Link>
        }
      />
    );
  }

  const isSwap = form.type === 'SWAP';

  return (
    <>
      {isDirty && (
        <div className="save-bar" role="region" aria-label="Unsaved changes">
          <span className="save-bar-msg">Unsaved changes</span>
          <div className="save-bar-actions">
            <Button
              variant="ghost"
              onClick={onDiscard}
              disabled={updateGroup.isPending}
            >
              Discard
            </Button>
            <Button
              variant="primary"
              onClick={onSave}
              loading={updateGroup.isPending}
            >
              Save changes
            </Button>
          </div>
        </div>
      )}

      {/* Header — inline edit. No modal. */}
      <div
        className="flex-between mb-16"
        style={{ flexWrap: 'wrap', gap: 8, alignItems: 'flex-start' }}
      >
        <div style={{ flex: 1, minWidth: 320 }}>
          <Link
            to="/menu/modifier-groups"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to modifier groups
          </Link>
          <div className="flex gap-8 mt-4" style={{ alignItems: 'center' }}>
            {isSwap ? (
              <Badge tone="blue">SWAP</Badge>
            ) : (
              <Badge tone="gray">ADD</Badge>
            )}
            {form.required && <Badge tone="gold">Required</Badge>}
            {isSwap && (() => {
              const def = group.modifiers?.find((m) => m.is_default);
              return def ? (
                <span className="fs-12 text-muted">
                  Default: <span className="fw-600">{def.name}</span>
                </span>
              ) : (
                <span className="fs-12 text-red">No default set</span>
              );
            })()}
          </div>
        </div>
        <div className="flex gap-8">
          <Button
            variant="danger"
            onClick={onDeleteGroup}
            loading={deleteGroup.isPending}
          >
            Delete group
          </Button>
        </div>
      </div>

      <div className="card mb-16" style={{ padding: 18 }}>
        {saveError && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {saveError}
          </div>
        )}

        <div className="field" style={{ marginBottom: 16 }}>
          <label htmlFor="group-name">Group name</label>
          <input
            id="group-name"
            className="product-name-input"
            value={form.name}
            onChange={(e) => setField('name', e.target.value)}
            maxLength={200}
            placeholder='e.g. "Milk Type"'
          />
          {fieldErrors.name && (
            <div className="field-error">{fieldErrors.name}</div>
          )}
        </div>

        <div className="field">
          <label>Type</label>
          <div className="flex gap-8">
            <button
              type="button"
              className={`filter-pill ${form.type === 'SWAP' ? 'active' : ''}`}
              onClick={() => setField('type', 'SWAP')}
            >
              SWAP
            </button>
            <button
              type="button"
              className={`filter-pill ${form.type === 'ADD' ? 'active' : ''}`}
              onClick={() => setField('type', 'ADD')}
            >
              ADD
            </button>
          </div>
          <div className="fs-11 text-muted mt-4">
            {form.type === 'SWAP'
              ? 'SWAP: modifiers fill a recipe slot (e.g. Whole Milk → Almond Milk). Mark one modifier as Default — the recipe uses that fallback when the customer picks nothing.'
              : 'ADD: modifiers deduct extra inventory on top of the recipe (e.g. extra shot).'}
          </div>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
            gap: 12,
          }}
        >
          <div className="field">
            <label htmlFor="group-min">Min selection</label>
            <input
              id="group-min"
              type="number"
              min="0"
              value={form.min_selection}
              onChange={(e) => setField('min_selection', e.target.value)}
            />
            {fieldErrors.min_selection && (
              <div className="field-error">{fieldErrors.min_selection}</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="group-max">Max selection</label>
            <input
              id="group-max"
              type="number"
              min="1"
              value={form.max_selection}
              onChange={(e) => setField('max_selection', e.target.value)}
            />
            {fieldErrors.max_selection && (
              <div className="field-error">{fieldErrors.max_selection}</div>
            )}
          </div>
          <div className="field">
            <label htmlFor="group-order">Display order</label>
            <input
              id="group-order"
              type="number"
              value={form.display_order}
              onChange={(e) => setField('display_order', e.target.value)}
            />
            {fieldErrors.display_order && (
              <div className="field-error">{fieldErrors.display_order}</div>
            )}
          </div>
        </div>

        <div className="flex gap-16 mt-4" style={{ paddingTop: 4 }}>
          <label
            className="flex gap-8"
            style={{ alignItems: 'center', fontSize: 13, cursor: 'pointer' }}
          >
            <input
              type="checkbox"
              checked={form.required}
              onChange={(e) => setField('required', e.target.checked)}
            />
            Required — customer must pick from this group
          </label>
        </div>
      </div>

      {/* Modifiers section */}
      <div className="detail-section">
        <ModifiersSection groupId={group.id} isSwap={isSwap} />
      </div>

      {/* Linked products */}
      <div className="detail-section">
        <h3>Linked products</h3>
        <LinkedProductsList
          products={productsQ.data ?? []}
          loading={productsQ.isLoading}
        />
      </div>

      {/* Overrides */}
      <div className="detail-section">
        <h3>Per-product overrides</h3>
        <OverridesList
          overrides={overridesQ.data ?? []}
          loading={overridesQ.isLoading}
        />
      </div>
    </>
  );
}

/* ────────────────── Modifiers editor ───────────────────── */

interface ModifiersSectionProps {
  groupId: string;
  isSwap: boolean;
}

function ModifiersSection({ groupId, isSwap }: ModifiersSectionProps) {
  const groupQ = useModifierGroup(groupId);

  // Sort deterministically so toggling `active` can never reorder the list.
  // display_order may be 0 for every row, so fall back to creation time.
  const modifiers = useMemo<Modifier[]>(() => {
    const list = groupQ.data?.modifiers ?? [];
    return [...list].sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }
      return a.created_at.localeCompare(b.created_at);
    });
  }, [groupQ.data]);

  const [showInactive, setShowInactive] = useState(false);
  const visibleModifiers = useMemo(
    () => (showInactive ? modifiers : modifiers.filter((m) => m.active)),
    [modifiers, showInactive],
  );
  const inactiveCount = modifiers.length - modifiers.filter((m) => m.active).length;

  const createMod = useCreateModifier(groupId);
  const updateMod = useUpdateModifier(groupId);
  const deleteMod = useDeleteModifier(groupId);

  const suppliesQ = useSupplies({ active: true });
  const supplies = useMemo(
    () => suppliesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliesQ.data],
  );

  const gridTemplate = isSwap ? SWAP_GRID : ADD_GRID;

  const onToggleActive = async (m: Modifier) => {
    if (m.active) {
      if (
        !confirm(
          `Deactivate "${m.name}"? It will no longer appear at the POS.`,
        )
      ) {
        return;
      }
    }
    try {
      await updateMod.mutateAsync({
        modifierId: m.id,
        input: { active: !m.active },
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const onSetDefault = async (m: Modifier) => {
    if (m.is_default) return;
    try {
      await updateMod.mutateAsync({
        modifierId: m.id,
        input: { is_default: true },
      });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const onDelete = async (m: Modifier) => {
    if (!confirm(`Delete modifier "${m.name}"? This cannot be undone.`)) return;
    try {
      await deleteMod.mutateAsync(m.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const onUpdate = (modifierId: string, input: UpdateModifierInput) =>
    updateMod.mutateAsync({ modifierId, input });

  return (
    <>
      <div className="flex-between mb-8">
        <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
          Modifiers ({modifiers.length})
        </h3>
        {inactiveCount > 0 && (
          <button
            type="button"
            className={`filter-pill ${showInactive ? 'active' : ''}`}
            onClick={() => setShowInactive((v) => !v)}
          >
            {showInactive
              ? `✓ Showing ${inactiveCount} inactive`
              : `Show ${inactiveCount} inactive`}
          </button>
        )}
      </div>

      <div className="table-wrap">
        <div
          className="table-head"
          style={{ gridTemplateColumns: gridTemplate }}
        >
          <div>Name</div>
          <div>Extra price</div>
          {isSwap ? (
            <>
              <div>Default</div>
              <div>Ratio</div>
              <div>Supply</div>
            </>
          ) : (
            <>
              <div>Supply</div>
              <div>Qty</div>
              <div>Unit</div>
            </>
          )}
          <div>Status</div>
          <div />
        </div>

        <AddModifierRow
          isSwap={isSwap}
          gridTemplate={gridTemplate}
          supplies={supplies}
          onAdd={async (input) => {
            await createMod.mutateAsync(input);
          }}
          saving={createMod.isPending}
        />

        {visibleModifiers.length === 0 ? (
          <div className="empty-state" style={{ padding: '24px 16px' }}>
            <div className="msg">
              {modifiers.length === 0
                ? 'No modifiers yet'
                : 'No active modifiers match'}
            </div>
            <div className="sub">
              {modifiers.length === 0
                ? 'Add at least one choice above so this group can be attached to products.'
                : 'Enable "Show inactive" to see deactivated modifiers.'}
            </div>
          </div>
        ) : (
          visibleModifiers.map((m, i) => (
            <ModifierRow
              key={m.id}
              modifier={m}
              isSwap={isSwap}
              even={i % 2 === 0}
              gridTemplate={gridTemplate}
              supplies={supplies}
              onUpdate={onUpdate}
              onToggleActive={onToggleActive}
              onSetDefault={onSetDefault}
              onDelete={onDelete}
            />
          ))
        )}
      </div>
    </>
  );
}

/* ────────────────── Add-modifier row ───────────────────── */

interface AddRowProps {
  isSwap: boolean;
  gridTemplate: string;
  supplies: { id: string; name: string }[];
  onAdd: (input: {
    name: string;
    extra_price: number;
    ratio?: number;
    supply_id?: string | null;
    supply_quantity?: number | null;
    supply_unit?: string | null;
  }) => Promise<void>;
  saving: boolean;
}

function AddModifierRow({
  isSwap,
  gridTemplate,
  supplies,
  onAdd,
  saving,
}: AddRowProps) {
  const [name, setName] = useState('');
  const [extraPrice, setExtraPrice] = useState('');
  const [ratio, setRatio] = useState('1');
  const [supplyId, setSupplyId] = useState('');
  const [supplyQty, setSupplyQty] = useState('');
  const [supplyUnit, setSupplyUnit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const reset = () => {
    setName('');
    setExtraPrice('');
    setRatio('1');
    setSupplyId('');
    setSupplyQty('');
    setSupplyUnit('');
    setError(null);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    const price = extraPrice ? Number(extraPrice) : 0;
    if (!Number.isFinite(price) || price < 0) {
      setError('Extra price must be ≥ 0 (centavos)');
      return;
    }

    const body: Parameters<typeof onAdd>[0] = {
      name: name.trim(),
      extra_price: price,
    };

    if (isSwap) {
      const r = Number(ratio);
      if (!Number.isFinite(r) || r <= 0) {
        setError('Ratio must be positive');
        return;
      }
      body.ratio = r;
      if (supplyId) body.supply_id = supplyId;
    } else {
      const hasId = Boolean(supplyId);
      const hasQty = supplyQty.trim() !== '';
      const hasUnit = Boolean(supplyUnit);
      if (hasId || hasQty || hasUnit) {
        if (!hasId || !hasQty || !hasUnit) {
          setError('Supply, quantity, and unit must all be provided together');
          return;
        }
        const qty = Number(supplyQty);
        if (!Number.isFinite(qty) || qty <= 0) {
          setError('Supply quantity must be positive');
          return;
        }
        body.supply_id = supplyId;
        body.supply_quantity = qty;
        body.supply_unit = supplyUnit;
      }
    }

    try {
      await onAdd(body);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  return (
    <>
      <div
        className="table-row modifier-add-row"
        style={{ gridTemplateColumns: gridTemplate }}
      >
        <input
          className="inline-input"
          placeholder={isSwap ? 'e.g. Almond Milk' : 'e.g. Extra Shot'}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        <input
          className="inline-input"
          type="number"
          min="0"
          step="1"
          placeholder="0"
          value={extraPrice}
          onChange={(e) => setExtraPrice(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
          }}
        />
        {isSwap ? (
          <>
            {/* Default is set per-modifier after creation — the backend
                requires an existing modifier id to mark as default. */}
            <span className="fs-11 text-muted">Set after add</span>
            <input
              className="inline-input"
              type="number"
              step="0.01"
              min="0"
              value={ratio}
              onChange={(e) => setRatio(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <select
              className="inline-select"
              value={supplyId}
              onChange={(e) => setSupplyId(e.target.value)}
            >
              <option value="">— supply (optional) —</option>
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </>
        ) : (
          <>
            <select
              className="inline-select"
              value={supplyId}
              onChange={(e) => setSupplyId(e.target.value)}
            >
              <option value="">— none —</option>
              {supplies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <input
              className="inline-input"
              type="number"
              step="0.01"
              min="0"
              placeholder="0"
              value={supplyQty}
              onChange={(e) => setSupplyQty(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
            <select
              className="inline-select"
              value={supplyUnit}
              onChange={(e) => setSupplyUnit(e.target.value)}
            >
              <option value="">—</option>
              {UNIT_OPTIONS.map((u) => (
                <option key={u.value} value={u.value}>
                  {u.label}
                </option>
              ))}
            </select>
          </>
        )}
        <Button
          variant="primary"
          size="sm"
          onClick={submit}
          loading={saving}
        >
          + Add
        </Button>
        <div />
      </div>
      {error && (
        <div
          className="field-error"
          style={{ padding: '6px 16px 10px', background: 'var(--gold-bg)' }}
        >
          {error}
        </div>
      )}
    </>
  );
}

/* ────────────────── Modifier row ───────────────────────── */

interface ModifierRowProps {
  modifier: Modifier;
  isSwap: boolean;
  even: boolean;
  gridTemplate: string;
  supplies: { id: string; name: string }[];
  onUpdate: (modifierId: string, input: UpdateModifierInput) => Promise<unknown>;
  onToggleActive: (m: Modifier) => void;
  onSetDefault: (m: Modifier) => void;
  onDelete: (m: Modifier) => void;
}

function ModifierRow({
  modifier: m,
  isSwap,
  even,
  gridTemplate,
  supplies,
  onUpdate,
  onToggleActive,
  onSetDefault,
  onDelete,
}: ModifierRowProps) {
  return (
    <div
      className={`table-row ${even ? 'even' : 'odd'} ${
        m.active ? '' : 'row-inactive'
      }`}
      style={{ gridTemplateColumns: gridTemplate, cursor: 'default' }}
    >
      <InlineTextCell
        value={m.name}
        validate={(v) => (v.trim() ? null : 'Name required')}
        onSave={(v) => onUpdate(m.id, { name: v.trim() })}
        fontWeight={600}
      />
      <InlineNumberCell
        value={m.extra_price}
        min={0}
        step="1"
        validate={(n) => (n >= 0 ? null : '≥ 0')}
        onSave={(n) => onUpdate(m.id, { extra_price: n })}
        prefix={(n) => (n > 0 ? `+${formatMoney(n)}` : '')}
      />
      {isSwap ? (
        <>
          <DefaultCell
            isDefault={m.is_default}
            canDefault={!!m.supply_id}
            onClick={() => onSetDefault(m)}
          />
          <InlineNumberCell
            value={m.ratio}
            min={0}
            step="0.01"
            validate={(n) => (n > 0 ? null : '> 0')}
            onSave={(n) => onUpdate(m.id, { ratio: n })}
            suffix="×"
          />
          <InlineSupplyCell
            value={m.supply_id}
            supplies={supplies}
            allowNone
            onSave={(next) => onUpdate(m.id, { supply_id: next || null })}
          />
        </>
      ) : (
        <AddSupplyTriplet
          modifier={m}
          supplies={supplies}
          onSave={(input) => onUpdate(m.id, input)}
        />
      )}
      <button
        type="button"
        className={`status-btn ${m.active ? 'is-active' : 'is-inactive'}`}
        onClick={() => onToggleActive(m)}
        title={m.active ? 'Click to deactivate' : 'Click to activate'}
      >
        {m.active ? 'Active' : 'Inactive'}
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={() => onDelete(m)}
        style={{ marginLeft: 'auto' }}
        aria-label="Delete modifier"
      >
        ✕
      </button>
    </div>
  );
}

/* ───── Default cell: styled pill that switches the group's default ───── */

function DefaultCell({
  isDefault,
  canDefault,
  onClick,
}: {
  isDefault: boolean;
  canDefault: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`default-btn ${isDefault ? 'is-default' : ''}`}
      onClick={onClick}
      disabled={isDefault || !canDefault}
      title={
        isDefault
          ? 'Used when the customer picks nothing from this group'
          : canDefault
            ? 'Set as default'
            : 'Link a supply first — defaults need something to deduct'
      }
    >
      {isDefault ? '★ Default' : 'Set default'}
    </button>
  );
}

/* ────────────────── ADD-type supply triplet ────────────────── */
/**
 * ADD modifiers carry a supply triplet (id + quantity + unit) that the
 * backend validates as all-or-nothing. We keep local drafts for all three
 * and PATCH the full triplet whenever any one of them blurs, so the row
 * never leaves the backend in a half-valid state.
 */
function AddSupplyTriplet({
  modifier: m,
  supplies,
  onSave,
}: {
  modifier: Modifier;
  supplies: { id: string; name: string }[];
  onSave: (input: UpdateModifierInput) => Promise<unknown>;
}) {
  const [supplyId, setSupplyId] = useState<string>(m.supply_id ?? '');
  const [qty, setQty] = useState<string>(m.supply_quantity ?? '');
  const [unit, setUnit] = useState<string>(m.supply_unit ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Ref so callers inside event handlers can read the latest local draft even
  // when they were captured in an older closure.
  const latest = useRef({ supplyId, qty, unit });
  latest.current = { supplyId, qty, unit };

  useEffect(() => {
    setSupplyId(m.supply_id ?? '');
    setQty(m.supply_quantity ?? '');
    setUnit(m.supply_unit ?? '');
    setError(null);
  }, [m.id, m.supply_id, m.supply_quantity, m.supply_unit]);

  const commit = async () => {
    if (saving) return;
    const { supplyId: sid, qty: q, unit: u } = latest.current;
    const hasId = Boolean(sid);
    const hasQty = q.trim() !== '';
    const hasUnit = Boolean(u);

    // Nothing meaningful to save yet.
    const originalHad =
      Boolean(m.supply_id) || Boolean(m.supply_quantity) || Boolean(m.supply_unit);
    const currentHas = hasId || hasQty || hasUnit;
    if (!originalHad && !currentHas) return;

    // Clearing all three is valid.
    if (!hasId && !hasQty && !hasUnit) {
      if (!originalHad) return;
      setSaving(true);
      setError(null);
      try {
        await onSave({
          supply_id: null,
          supply_quantity: null,
          supply_unit: null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Save failed');
      } finally {
        setSaving(false);
      }
      return;
    }

    // Partial states aren't savable — wait for the user to finish.
    if (!hasId || !hasQty || !hasUnit) {
      setError('Supply, quantity, and unit must all be set');
      return;
    }

    const qtyNum = Number(q);
    if (!Number.isFinite(qtyNum) || qtyNum <= 0) {
      setError('Qty must be > 0');
      return;
    }

    // No-op: every field matches the server.
    if (
      sid === (m.supply_id ?? '') &&
      qtyNum === Number(m.supply_quantity ?? 0) &&
      u === (m.supply_unit ?? '')
    ) {
      setError(null);
      return;
    }

    setSaving(true);
    setError(null);
    try {
      await onSave({
        supply_id: sid,
        supply_quantity: qtyNum,
        supply_unit: u,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div>
        <select
          className={`inline-select${error ? ' error' : ''}${
            saving ? ' saving' : ''
          }`}
          value={supplyId}
          disabled={saving}
          onChange={(e) => setSupplyId(e.target.value)}
          onBlur={commit}
        >
          <option value="">— none —</option>
          {supplies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        {error && <div className="inline-cell-error">{error}</div>}
      </div>
      <div>
        <input
          type="number"
          step="0.01"
          min="0"
          className={`inline-input${saving ? ' saving' : ''}`}
          value={qty}
          disabled={saving}
          onChange={(e) => setQty(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
      </div>
      <div>
        <select
          className={`inline-select${saving ? ' saving' : ''}`}
          value={unit}
          disabled={saving}
          onChange={(e) => setUnit(e.target.value)}
          onBlur={commit}
        >
          <option value="">—</option>
          {UNIT_OPTIONS.map((u) => (
            <option key={u.value} value={u.value}>
              {u.label}
            </option>
          ))}
        </select>
      </div>
    </>
  );
}

/* ────────────────── Inline cell helpers ────────────────── */

interface InlineTextCellProps {
  value: string;
  validate?: (v: string) => string | null;
  onSave: (v: string) => Promise<unknown>;
  fontWeight?: number;
}

function InlineTextCell({
  value,
  validate,
  onSave,
  fontWeight,
}: InlineTextCellProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = async () => {
    if (saving) return;
    const trimmed = draft.trim();
    const ve = validate?.(trimmed) ?? null;
    if (ve) {
      setError(ve);
      return;
    }
    if (trimmed === value) {
      setError(null);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSave(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <input
        className={`inline-input${error ? ' error' : ''}${
          saving ? ' saving' : ''
        }`}
        value={draft}
        disabled={saving}
        style={fontWeight ? { fontWeight } : undefined}
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
      />
      {error && <div className="inline-cell-error">{error}</div>}
    </div>
  );
}

interface InlineNumberCellProps {
  value: string;
  min?: number;
  max?: number;
  step?: string;
  validate?: (n: number) => string | null;
  onSave: (n: number) => Promise<unknown>;
  /** Show a read-only hint below the input (e.g. "+$12.00"). */
  prefix?: (n: number) => string;
  suffix?: string;
}

function InlineNumberCell({
  value,
  min,
  max,
  step = 'any',
  validate,
  onSave,
  prefix,
  suffix,
}: InlineNumberCellProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value);
    setError(null);
  }, [value]);

  const commit = async () => {
    if (saving) return;
    if (draft.trim() === '') {
      setError('Required');
      setDraft(value);
      return;
    }
    const next = Number(draft);
    if (!Number.isFinite(next)) {
      setError('Invalid');
      return;
    }
    const ve = validate?.(next) ?? null;
    if (ve) {
      setError(ve);
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

  const asNumber = Number(value);
  const hint = prefix && Number.isFinite(asNumber) ? prefix(asNumber) : '';

  return (
    <div>
      <div className="flex gap-4" style={{ alignItems: 'center' }}>
        <input
          type="number"
          className={`inline-input${error ? ' error' : ''}${
            saving ? ' saving' : ''
          }`}
          value={draft}
          min={min}
          max={max}
          step={step}
          disabled={saving}
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
        />
        {suffix && <span className="fs-11 text-muted">{suffix}</span>}
      </div>
      {hint && (
        <div className="fs-11 text-muted mt-4" style={{ paddingLeft: 2 }}>
          {hint}
        </div>
      )}
      {error && <div className="inline-cell-error">{error}</div>}
    </div>
  );
}

interface InlineSupplyCellProps {
  value: string | null;
  supplies: { id: string; name: string }[];
  allowNone: boolean;
  onSave: (next: string) => Promise<unknown>;
}

function InlineSupplyCell({
  value,
  supplies,
  allowNone,
  onSave,
}: InlineSupplyCellProps) {
  const [draft, setDraft] = useState(value ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(value ?? '');
    setError(null);
  }, [value]);

  const commit = async (next: string) => {
    if (saving) return;
    if ((value ?? '') === next) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
      setDraft(value ?? '');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <select
        className={`inline-select${error ? ' error' : ''}${
          saving ? ' saving' : ''
        }`}
        value={draft}
        disabled={saving}
        onChange={(e) => {
          const next = e.target.value;
          setDraft(next);
          void commit(next);
        }}
      >
        {allowNone && <option value="">— none —</option>}
        {supplies.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      {error && <div className="inline-cell-error">{error}</div>}
    </div>
  );
}

/* ──────────────── Linked products list ────────────────── */

function LinkedProductsList({
  products,
  loading,
}: {
  products: LinkedProduct[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading…
      </div>
    );
  }
  if (products.length === 0) {
    return (
      <EmptyState
        message="No products use this group yet"
        sub="Attach it to a product from the product detail page."
      />
    );
  }
  return (
    <div className="table-wrap">
      <div
        className="table-head"
        style={{ gridTemplateColumns: '2fr 130px 1.5fr 140px 100px' }}
      >
        <div>Product</div>
        <div>Type</div>
        <div>Category</div>
        <div>Price</div>
        <div>Status</div>
      </div>
      {products.map((p, i) => (
        <Link
          key={p.id}
          to={`/menu/products/${p.id}`}
          className={`table-row ${i % 2 === 0 ? 'even' : 'odd'}`}
          style={{
            gridTemplateColumns: '2fr 130px 1.5fr 140px 100px',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div className="fw-600 fs-13">{p.name}</div>
          <div>
            <Badge tone={productTypeTone(p.type)}>{p.type}</Badge>
          </div>
          <div className="fs-12 text-muted">{p.category?.name ?? '—'}</div>
          <div className="fs-13">
            {p.sell_price ? formatMoney(p.sell_price) : '—'}
          </div>
          <div>
            {p.active ? (
              <Badge tone="green">Active</Badge>
            ) : (
              <Badge tone="red">Inactive</Badge>
            )}
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ────────────────── Overrides list ────────────────────── */

function OverridesList({
  overrides,
  loading,
}: {
  overrides: ModifierProductOverride[];
  loading: boolean;
}) {
  if (loading) {
    return (
      <div className="loading-block">
        <span className="spinner" />
        Loading…
      </div>
    );
  }
  if (overrides.length === 0) {
    return (
      <EmptyState
        message="No overrides defined"
        sub="Overrides let a product deduct a different amount than the modifier's default. Create one from the product detail page."
      />
    );
  }
  return (
    <div className="table-wrap">
      <div
        className="table-head"
        style={{ gridTemplateColumns: '2fr 1.5fr 120px 1fr' }}
      >
        <div>Product</div>
        <div>Modifier</div>
        <div>Type</div>
        <div>Amount</div>
      </div>
      {overrides.map((o, i) => (
        <Link
          key={o.id}
          to={`/menu/products/${o.product_id}`}
          className={`table-row ${i % 2 === 0 ? 'even' : 'odd'}`}
          style={{
            gridTemplateColumns: '2fr 1.5fr 120px 1fr',
            textDecoration: 'none',
            color: 'inherit',
          }}
        >
          <div className="fw-600 fs-13">{o.product?.name ?? '—'}</div>
          <div className="fs-13">{o.modifier?.name ?? '—'}</div>
          <div>
            <Badge tone={o.override_type === 'RATIO' ? 'blue' : 'gray'}>
              {o.override_type}
            </Badge>
          </div>
          <div className="fs-13">
            {o.override_type === 'RATIO'
              ? `${Number(o.override_ratio ?? 0).toFixed(2)}×`
              : `${Number(o.override_quantity ?? 0)} ${o.override_unit ?? ''}`}
          </div>
        </Link>
      ))}
    </div>
  );
}

/* ───────────────────────────────────────────────────────── */

interface HeaderFormState {
  name: string;
  type: ModifierGroupType;
  min_selection: string;
  max_selection: string;
  required: boolean;
  display_order: string;
}

function buildFormState(g: ModifierGroup): HeaderFormState {
  return {
    name: g.name,
    type: g.type,
    min_selection: String(g.min_selection),
    max_selection: String(g.max_selection),
    required: g.required,
    display_order: String(g.display_order),
  };
}
