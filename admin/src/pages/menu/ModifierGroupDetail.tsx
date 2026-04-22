import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateModifier,
  useDeleteModifier,
  useDeleteModifierGroup,
  useGroupLinkedProducts,
  useGroupOverrides,
  useModifierGroup,
  useUpdateModifier,
} from '../../hooks/useModifierGroups';
import { useSupplies } from '../../hooks/useSupplies';
import type {
  LinkedProduct,
  Modifier,
  ModifierProductOverride,
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

export function ModifierGroupDetail() {
  const { id = '' } = useParams<{ id: string }>();

  const groupQ = useModifierGroup(id);
  const productsQ = useGroupLinkedProducts(id);
  const overridesQ = useGroupOverrides(id);

  const deleteGroup = useDeleteModifierGroup();

  const group = groupQ.data;
  const isSwap = group?.type === 'SWAP';

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

  if (groupQ.error || !group) {
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

  return (
    <>
      {/* Header */}
      <div className="flex-between mb-16" style={{ flexWrap: 'wrap', gap: 8 }}>
        <div>
          <Link
            to="/menu/modifier-groups"
            className="fs-12 text-muted"
            style={{ display: 'inline-block', marginBottom: 6 }}
          >
            ← Back to modifier groups
          </Link>
          <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 24 }}>
            {group.name}
          </h1>
          <div className="flex gap-8 mt-4" style={{ alignItems: 'center' }}>
            {isSwap ? (
              <Badge tone="blue">SWAP</Badge>
            ) : (
              <Badge tone="gray">ADD</Badge>
            )}
            {group.required && <Badge tone="gold">Required</Badge>}
            <span className="fs-12 text-muted">
              min {group.min_selection} · max {group.max_selection}
            </span>
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
          <Button variant="danger" onClick={onDeleteGroup} loading={deleteGroup.isPending}>
            Delete group
          </Button>
        </div>
      </div>

      {/* Modifiers section */}
      <div className="detail-section">
        <ModifiersSection groupId={group.id} isSwap={isSwap} />
      </div>

      {/* Linked products */}
      <div className="detail-section">
        <h3>Linked products</h3>
        <LinkedProductsList products={productsQ.data ?? []} loading={productsQ.isLoading} />
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
  const modifiers = useMemo<Modifier[]>(
    () => groupQ.data?.modifiers ?? [],
    [groupQ.data],
  );

  const createMod = useCreateModifier(groupId);
  const updateMod = useUpdateModifier(groupId);
  const deleteMod = useDeleteModifier(groupId);

  const suppliesQ = useSupplies({ active: true });
  const supplies = useMemo(
    () => suppliesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliesQ.data],
  );

  const [form, setForm] = useState({
    name: '',
    extra_price: '',
    ratio: '1',
    supply_id: '',
    supply_quantity: '',
    supply_unit: '',
  });
  const [addError, setAddError] = useState<string | null>(null);

  const resetForm = () =>
    setForm({
      name: '',
      extra_price: '',
      ratio: '1',
      supply_id: '',
      supply_quantity: '',
      supply_unit: '',
    });

  const onAdd = async () => {
    setAddError(null);
    if (!form.name.trim()) {
      setAddError('Name required');
      return;
    }
    const price = form.extra_price ? Number(form.extra_price) : 0;
    if (!Number.isFinite(price) || price < 0) {
      setAddError('Extra price must be ≥ 0');
      return;
    }

    const body: Parameters<typeof createMod.mutateAsync>[0] = {
      name: form.name.trim(),
      extra_price: price,
    };

    if (isSwap) {
      const ratio = Number(form.ratio);
      if (!Number.isFinite(ratio) || ratio <= 0) {
        setAddError('Ratio must be positive');
        return;
      }
      body.ratio = ratio;
      if (form.supply_id) {
        // SWAP modifiers may specify a specific supply to stand in for the
        // replaced ingredient; qty/unit come from the recipe via the ratio.
        body.supply_id = form.supply_id;
      }
    } else {
      // ADD: all or nothing for the supply triplet.
      const supplyId = form.supply_id || null;
      const qty = form.supply_quantity ? Number(form.supply_quantity) : null;
      const unit = form.supply_unit || null;
      if (supplyId || qty != null || unit) {
        if (!supplyId || qty == null || !unit) {
          setAddError('Supply, quantity, and unit must all be provided together');
          return;
        }
        if (!Number.isFinite(qty) || qty <= 0) {
          setAddError('Supply quantity must be positive');
          return;
        }
        body.supply_id = supplyId;
        body.supply_quantity = qty;
        body.supply_unit = unit;
      }
    }

    try {
      await createMod.mutateAsync(body);
      resetForm();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : 'Create failed');
    }
  };

  const onToggleActive = async (m: Modifier) => {
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
    if (!confirm(`Delete modifier "${m.name}"?`)) return;
    try {
      await deleteMod.mutateAsync(m.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const columns: TableColumn<Modifier>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '1.5fr',
      render: (m) => <span className="fw-600 fs-13">{m.name}</span>,
    },
    {
      key: 'price',
      header: 'Extra price',
      width: '120px',
      render: (m) => (
        <span className="fs-13">
          {Number(m.extra_price) > 0 ? `+${formatMoney(m.extra_price)}` : '—'}
        </span>
      ),
    },
    ...(isSwap
      ? [
          {
            key: 'default',
            header: 'Default',
            width: '80px',
            render: (m: Modifier) => (
              <label
                className="flex gap-8"
                style={{ alignItems: 'center', cursor: m.is_default ? 'default' : 'pointer' }}
                onClick={(ev) => ev.stopPropagation()}
                title={
                  m.is_default
                    ? 'Used when the customer picks nothing from this group'
                    : 'Set as default'
                }
              >
                <input
                  type="radio"
                  name={`modifier-default-${groupId}`}
                  checked={m.is_default}
                  onChange={() => onSetDefault(m)}
                  disabled={!m.supply_id}
                  style={{ cursor: m.supply_id ? 'pointer' : 'not-allowed' }}
                />
              </label>
            ),
          },
          {
            key: 'ratio',
            header: 'Ratio',
            width: '100px',
            render: (m: Modifier) => (
              <span className="fs-13">{Number(m.ratio ?? 1).toFixed(2)}×</span>
            ),
          },
        ]
      : []),
    {
      key: 'supply',
      header: 'Supply',
      width: '1.2fr',
      render: (m) => (
        <span className="fs-12 text-muted">{m.supply?.name ?? '—'}</span>
      ),
    },
    ...(isSwap
      ? []
      : [
          {
            key: 'supply_qty',
            header: 'Qty',
            width: '120px',
            render: (m: Modifier) => (
              <span className="fs-12">
                {m.supply_quantity
                  ? `${Number(m.supply_quantity)} ${m.supply_unit ?? ''}`
                  : '—'}
              </span>
            ),
          },
        ]),
    {
      key: 'status',
      header: 'Status',
      width: '110px',
      render: (m) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleActive(m);
          }}
        >
          {m.active ? (
            <Badge tone="green">Active</Badge>
          ) : (
            <Badge tone="gray">Inactive</Badge>
          )}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '80px',
      render: (m) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(ev) => {
            ev.stopPropagation();
            onDelete(m);
          }}
          style={{ marginLeft: 'auto' }}
        >
          ✕
        </button>
      ),
    },
  ];

  return (
    <>
      <div className="flex-between mb-8">
        <h3 style={{ marginBottom: 0, paddingBottom: 0, border: 'none' }}>
          Modifiers ({modifiers.length})
        </h3>
      </div>

      {/* Inline add form */}
      <Card className="mb-12">
        <div className="fs-12 fw-600 text-muted mb-8">Add a modifier</div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isSwap
              ? '2fr 120px 120px 2fr auto'
              : '2fr 120px 1.5fr 120px 120px auto',
            gap: 12,
            alignItems: 'end',
          }}
        >
          <Input
            label="Name"
            placeholder={isSwap ? 'e.g. Almond Milk' : 'e.g. Extra Shot'}
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
          <Input
            label="Extra price"
            type="number"
            min="0"
            placeholder="0"
            value={form.extra_price}
            onChange={(e) => setForm((f) => ({ ...f, extra_price: e.target.value }))}
            hint="in centavos"
          />
          {isSwap ? (
            <Input
              label="Ratio"
              type="number"
              step="0.01"
              min="0"
              value={form.ratio}
              onChange={(e) => setForm((f) => ({ ...f, ratio: e.target.value }))}
              hint="× recipe qty"
            />
          ) : (
            <>
              <Select
                label="Supply"
                placeholder="(none)"
                options={supplies.map((s) => ({ value: s.id, label: s.name }))}
                value={form.supply_id}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, supply_id: v as string }))
                }
              />
              <Input
                label="Qty"
                type="number"
                step="0.01"
                min="0"
                value={form.supply_quantity}
                onChange={(e) => setForm((f) => ({ ...f, supply_quantity: e.target.value }))}
              />
              <Select
                label="Unit"
                placeholder="unit"
                options={UNIT_OPTIONS}
                value={form.supply_unit}
                onValueChange={(v) =>
                  setForm((f) => ({ ...f, supply_unit: v as string }))
                }
              />
            </>
          )}
          {isSwap && (
            <Select
              label="Supply (optional)"
              placeholder="(from group's replaces)"
              options={supplies.map((s) => ({ value: s.id, label: s.name }))}
              value={form.supply_id}
              onValueChange={(v) =>
                setForm((f) => ({ ...f, supply_id: v as string }))
              }
            />
          )}
          <Button variant="primary" onClick={onAdd} loading={createMod.isPending}>
            Add
          </Button>
        </div>
        {addError && (
          <div className="auth-alert" style={{ marginTop: 12 }}>
            {addError}
          </div>
        )}
      </Card>

      <Table
        columns={columns}
        rows={modifiers}
        getRowKey={(m) => m.id}
        emptyMessage="No modifiers yet"
        emptySub="Add at least one choice so this group can be attached to products."
      />
    </>
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
