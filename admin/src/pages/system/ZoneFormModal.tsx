import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { useCreateZone, useUpdateZone } from '../../hooks/useZones';
import type { Zone } from '../../types/operations';

interface Props {
  open: boolean;
  onClose: () => void;
  // null → create; otherwise edit.
  zone: Zone | null;
}

export function ZoneFormModal({ open, onClose, zone }: Props) {
  const createM = useCreateZone();
  const updateM = useUpdateZone();

  const [name, setName] = useState('');
  const [order, setOrder] = useState('0');
  const [error, setError] = useState<string | null>(null);

  // Takeout zones are system-managed singletons. Editing the seeded zone
  // exposes only name + display_order; "kind" is read-only and uncreatable
  // from the form.
  const isTakeoutZone = zone?.kind === 'TAKEOUT';

  useEffect(() => {
    if (!open) return;
    setName(zone?.name ?? '');
    setOrder(String(zone?.display_order ?? 0));
    setError(null);
  }, [open, zone]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Name is required');
      return;
    }
    const orderNum = Number(order);
    if (!Number.isInteger(orderNum) || orderNum < 0) {
      setError('Display order must be a non-negative whole number');
      return;
    }
    try {
      if (zone) {
        await updateM.mutateAsync({
          id: zone.id,
          input: { name: trimmed, display_order: orderNum },
        });
      } else {
        await createM.mutateAsync({ name: trimmed, display_order: orderNum });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const pending = createM.isPending || updateM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={zone ? `Edit zone — ${zone.name}` : 'New zone'}
      size="sm"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={pending}>
            {zone ? 'Save changes' : 'Create zone'}
          </Button>
        </>
      }
    >
      <form onSubmit={submit}>
        {error && <div className="auth-alert mb-12">{error}</div>}
        <Input
          label="Name"
          name="name"
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Indoor / Terrace / Bar Area"
        />
        <Input
          label="Display order"
          name="display_order"
          type="number"
          min="0"
          step="1"
          value={order}
          onChange={(e) => setOrder(e.target.value)}
          hint="Lower numbers show first in the picker. Defaults to 0."
        />
        {isTakeoutZone && (
          <div className="field">
            <label>Type</label>
            <div className="field-hint">
              System-managed Takeout/Delivery zone — name and order can be
              tweaked, but the zone itself is permanent.
            </div>
          </div>
        )}
      </form>
    </Modal>
  );
}
