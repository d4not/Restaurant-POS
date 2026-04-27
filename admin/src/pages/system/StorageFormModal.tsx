import { useEffect, useState } from 'react';
import { Modal, Button } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import {
  useCreateStorage,
  useDeleteStorage,
  useUpdateStorage,
} from '../../hooks/useStorages';
import type { Storage } from '../../types/inventory';

interface Props {
  open: boolean;
  onClose: () => void;
  storage?: Storage | null;
}

interface FormState {
  name: string;
  address: string;
  active: boolean;
}

const EMPTY: FormState = { name: '', address: '', active: true };

function fromStorage(s: Storage): FormState {
  return {
    name: s.name,
    address: s.address ?? '',
    active: s.active,
  };
}

export function StorageFormModal({ open, onClose, storage }: Props) {
  const isEdit = !!storage;
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const createM = useCreateStorage();
  const updateM = useUpdateStorage();
  const deleteM = useDeleteStorage();

  useEffect(() => {
    if (!open) return;
    setForm(storage ? fromStorage(storage) : EMPTY);
    setErrors({});
    setServerError(null);
    setConfirmingDelete(false);
  }, [open, storage]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Name is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    const payload = {
      name: form.name.trim(),
      address: form.address.trim() || undefined,
      active: form.active,
    };

    try {
      if (isEdit && storage) {
        await updateM.mutateAsync({ id: storage.id, input: payload });
      } else {
        await createM.mutateAsync(payload);
      }
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const handleDelete = async () => {
    if (!storage) return;
    try {
      await deleteM.mutateAsync(storage.id);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Delete failed');
      setConfirmingDelete(false);
    }
  };

  const pending = createM.isPending || updateM.isPending || deleteM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit storage' : 'New storage'}
      closeOnOverlay={!pending}
      footer={
        <>
          {isEdit &&
            (confirmingDelete ? (
              <>
                <span
                  className="fs-12 text-red"
                  style={{ alignSelf: 'center', marginRight: 'auto' }}
                >
                  Delete this storage?
                </span>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={handleDelete}
                  loading={deleteM.isPending}
                >
                  Yes, delete
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmingDelete(false)}
                  disabled={deleteM.isPending}
                >
                  Keep it
                </Button>
              </>
            ) : (
              <Button
                variant="ghost"
                onClick={() => setConfirmingDelete(true)}
                disabled={pending}
                style={{ color: 'var(--red)', marginRight: 'auto' }}
              >
                Delete
              </Button>
            ))}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {isEdit ? 'Save changes' : 'Create storage'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {serverError && (
          <div className="auth-alert" style={{ marginBottom: 12 }}>
            {serverError}
          </div>
        )}

        <Input
          label="Name"
          name="name"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          autoFocus
          maxLength={120}
          placeholder="e.g. Bar, Warehouse, Fridge"
          error={errors.name}
        />

        <Input
          label="Address (optional)"
          name="address"
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          maxLength={500}
          placeholder="Floor, room, building reference…"
        />

        <div className="field">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
              style={{ width: 'auto', height: 'auto', cursor: 'pointer' }}
            />
            Active
          </label>
          <div className="fs-11 text-muted mt-4">
            Inactive storages stay in history but disappear from selectors when
            registering purchases, transfers, or write-offs.
          </div>
        </div>
      </form>
    </Modal>
  );
}
