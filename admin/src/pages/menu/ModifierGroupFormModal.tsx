import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import {
  useCreateModifierGroup,
  useUpdateModifierGroup,
} from '../../hooks/useModifierGroups';
import { useSupplies } from '../../hooks/useSupplies';
import type {
  ModifierGroup,
  ModifierGroupType,
} from '../../types/menu';

interface Props {
  open: boolean;
  onClose: () => void;
  group?: ModifierGroup | null;
}

interface FormState {
  name: string;
  type: ModifierGroupType;
  replaces_supply_id: string;
  min_selection: string;
  max_selection: string;
  required: boolean;
  display_order: string;
}

const emptyForm: FormState = {
  name: '',
  type: 'ADD',
  replaces_supply_id: '',
  min_selection: '0',
  max_selection: '1',
  required: false,
  display_order: '0',
};

export function ModifierGroupFormModal({ open, onClose, group }: Props) {
  const suppliesQ = useSupplies({ active: true });
  const supplies = useMemo(
    () => suppliesQ.data?.pages.flatMap((p) => p.items) ?? [],
    [suppliesQ.data],
  );

  const [form, setForm] = useState<FormState>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  const createMut = useCreateModifierGroup();
  const updateMut = useUpdateModifierGroup();
  const saving = createMut.isPending || updateMut.isPending;

  useEffect(() => {
    if (!open) return;
    if (group) {
      setForm({
        name: group.name,
        type: group.type,
        replaces_supply_id: group.replaces_supply_id ?? '',
        min_selection: String(group.min_selection),
        max_selection: String(group.max_selection),
        required: group.required,
        display_order: String(group.display_order),
      });
    } else {
      setForm(emptyForm);
    }
    setError(null);
  }, [open, group]);

  const onSubmit = async () => {
    setError(null);
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    const min = Number(form.min_selection);
    const max = Number(form.max_selection);
    if (!Number.isInteger(min) || min < 0) {
      setError('Min selection must be a non-negative integer');
      return;
    }
    if (!Number.isInteger(max) || max < 1) {
      setError('Max selection must be an integer ≥ 1');
      return;
    }
    if (min > max) {
      setError('Min selection cannot exceed max selection');
      return;
    }
    if (form.type === 'SWAP' && !form.replaces_supply_id) {
      setError('SWAP groups must select the ingredient being replaced');
      return;
    }

    const body = {
      name: form.name.trim(),
      type: form.type,
      replaces_supply_id:
        form.type === 'SWAP' ? form.replaces_supply_id : null,
      min_selection: min,
      max_selection: max,
      required: form.required,
      display_order: Number(form.display_order) || 0,
    };

    try {
      if (group) {
        await updateMut.mutateAsync({ id: group.id, input: body });
      } else {
        await createMut.mutateAsync(body);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={group ? 'Edit modifier group' : 'New modifier group'}
      size="sm"
      closeOnOverlay={!saving}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" onClick={onSubmit} loading={saving}>
            {group ? 'Save' : 'Create'}
          </Button>
        </>
      }
    >
      {error && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {error}
        </div>
      )}

      <Input
        label="Name"
        placeholder='e.g. "Milk Type"'
        value={form.name}
        onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
      />

      {/* Type toggle — SWAP vs ADD */}
      <div className="field">
        <label>Type</label>
        <div className="flex gap-8">
          <button
            type="button"
            className={`filter-pill ${form.type === 'SWAP' ? 'active' : ''}`}
            onClick={() => setForm((f) => ({ ...f, type: 'SWAP' }))}
          >
            SWAP
          </button>
          <button
            type="button"
            className={`filter-pill ${form.type === 'ADD' ? 'active' : ''}`}
            onClick={() =>
              setForm((f) => ({ ...f, type: 'ADD', replaces_supply_id: '' }))
            }
          >
            ADD
          </button>
        </div>
        <div className="fs-11 text-muted mt-4">
          {form.type === 'SWAP'
            ? 'SWAP: modifiers replace a recipe ingredient (e.g. Whole Milk → Almond Milk).'
            : 'ADD: modifiers deduct extra inventory on top of the recipe (e.g. extra shot).'}
        </div>
      </div>

      {form.type === 'SWAP' && (
        <Select
          label="Replaces ingredient"
          placeholder="Select supply…"
          options={supplies.map((s) => ({ value: s.id, label: s.name }))}
          value={form.replaces_supply_id}
          onValueChange={(v) =>
            setForm((f) => ({ ...f, replaces_supply_id: v }))
          }
        />
      )}

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
        }}
      >
        <Input
          label="Min selection"
          type="number"
          min="0"
          value={form.min_selection}
          onChange={(e) =>
            setForm((f) => ({ ...f, min_selection: e.target.value }))
          }
        />
        <Input
          label="Max selection"
          type="number"
          min="1"
          value={form.max_selection}
          onChange={(e) =>
            setForm((f) => ({ ...f, max_selection: e.target.value }))
          }
        />
        <Input
          label="Display order"
          type="number"
          min="0"
          value={form.display_order}
          onChange={(e) =>
            setForm((f) => ({ ...f, display_order: e.target.value }))
          }
        />
      </div>

      <div className="field">
        <label className="flex gap-8" style={{ alignItems: 'center', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={form.required}
            onChange={(e) =>
              setForm((f) => ({ ...f, required: e.target.checked }))
            }
          />
          <span className="fs-13">Required — customer must pick from this group</span>
        </label>
      </div>
    </Modal>
  );
}
