import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateOverride,
  useUpdateOverride,
} from '../../hooks/useModifierOverrides';
import type {
  Modifier,
  ModifierGroupType,
  ModifierOverrideType,
  ModifierProductOverride,
} from '../../types/menu';

interface Props {
  open: boolean;
  onClose: () => void;
  productId: string;
  productName: string;
  modifier: Modifier | null;
  groupType: ModifierGroupType;
  existingOverride: ModifierProductOverride | null;
}

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

export function OverrideFormModal({
  open,
  onClose,
  productId,
  productName,
  modifier,
  groupType,
  existingOverride,
}: Props) {
  // SWAP groups scale the existing recipe line by a ratio, so RATIO overrides
  // are the natural shape. ADD groups already carry an absolute qty/unit, so a
  // FIXED_QTY override is the typical customization.
  const defaultType: ModifierOverrideType = groupType === 'SWAP' ? 'RATIO' : 'FIXED_QTY';

  const [type, setType] = useState<ModifierOverrideType>(defaultType);
  const [ratio, setRatio] = useState('1');
  const [qty, setQty] = useState('');
  const [unit, setUnit] = useState('');
  const [error, setError] = useState<string | null>(null);

  const create = useCreateOverride(productId);
  const update = useUpdateOverride(productId);
  const saving = create.isPending || update.isPending;

  useEffect(() => {
    if (!open) return;
    if (existingOverride) {
      setType(existingOverride.override_type);
      setRatio(existingOverride.override_ratio ?? '1');
      setQty(existingOverride.override_quantity ?? '');
      setUnit(existingOverride.override_unit ?? '');
    } else {
      setType(defaultType);
      setRatio('1');
      setQty(modifier?.supply_quantity ?? '');
      setUnit(modifier?.supply_unit ?? '');
    }
    setError(null);
  }, [open, existingOverride, modifier, defaultType]);

  const onSubmit = async () => {
    if (!modifier) return;
    setError(null);
    try {
      if (type === 'RATIO') {
        const r = Number(ratio);
        if (!Number.isFinite(r) || r <= 0) {
          setError('Ratio must be positive');
          return;
        }
        if (existingOverride) {
          await update.mutateAsync({
            modifierId: modifier.id,
            input: {
              override_type: 'RATIO',
              override_ratio: r,
              override_quantity: null,
              override_unit: null,
            },
          });
        } else {
          await create.mutateAsync({
            modifier_id: modifier.id,
            override_type: 'RATIO',
            override_ratio: r,
          });
        }
      } else {
        const q = Number(qty);
        if (!Number.isFinite(q) || q <= 0) {
          setError('Quantity must be positive');
          return;
        }
        if (!unit) {
          setError('Unit is required');
          return;
        }
        if (existingOverride) {
          await update.mutateAsync({
            modifierId: modifier.id,
            input: {
              override_type: 'FIXED_QTY',
              override_ratio: null,
              override_quantity: q,
              override_unit: unit,
            },
          });
        } else {
          await create.mutateAsync({
            modifier_id: modifier.id,
            override_type: 'FIXED_QTY',
            override_quantity: q,
            override_unit: unit,
          });
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  if (!modifier) return null;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={
        existingOverride ? 'Edit override' : 'New override'
      }
      closeOnOverlay={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={saving}>
            {existingOverride ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <div className="fs-12 text-muted mb-12">
        Setting a per-product override for <span className="fw-600">{modifier.name}</span>{' '}
        on <span className="fw-600">{productName}</span>.
      </div>

      <div className="field">
        <label>Override type</label>
        <div className="flex gap-8">
          <button
            type="button"
            className={`filter-pill ${type === 'RATIO' ? 'active' : ''}`}
            onClick={() => setType('RATIO')}
          >
            RATIO
          </button>
          <button
            type="button"
            className={`filter-pill ${type === 'FIXED_QTY' ? 'active' : ''}`}
            onClick={() => setType('FIXED_QTY')}
          >
            FIXED QTY
          </button>
        </div>
        <div className="fs-11 text-muted mt-4">
          {type === 'RATIO'
            ? 'RATIO: multiply the recipe line by this factor (e.g. 0.75 for 75% of original).'
            : 'FIXED_QTY: deduct this exact amount regardless of recipe.'}
        </div>
      </div>

      {type === 'RATIO' ? (
        <Input
          label="Ratio"
          type="number"
          step="0.01"
          min="0"
          value={ratio}
          onChange={(e) => setRatio(e.target.value)}
          hint="× recipe quantity"
        />
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <Input
            label="Quantity"
            type="number"
            step="0.01"
            min="0"
            value={qty}
            onChange={(e) => setQty(e.target.value)}
          />
          <Select
            label="Unit"
            placeholder="unit"
            options={UNIT_OPTIONS}
            value={unit}
            onValueChange={(v) => setUnit(v as string)}
          />
        </div>
      )}
    </Modal>
  );
}
