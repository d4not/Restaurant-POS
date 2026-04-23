import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { useOpenRegister } from '../../hooks/useRegisters';
import { amountToCentavos, moneyLabel } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
}

export function OpenShiftModal({ open, onClose }: Props) {
  const [openingAmount, setOpeningAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const openM = useOpenRegister();

  useEffect(() => {
    if (!open) return;
    setOpeningAmount('');
    setNotes('');
    setError(null);
    setServerError(null);
  }, [open]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setServerError(null);

    const centavos = amountToCentavos(openingAmount);
    if (centavos === null) {
      setError('Enter a non-negative amount (e.g. 500.00)');
      return;
    }

    try {
      await openM.mutateAsync({
        opening_amount: centavos,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not open the shift');
    }
  };

  const pending = openM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Open shift"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Open shift
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
        <p className="fs-12 text-muted mb-12">
          Enter the cash you're placing in the drawer at the start of the shift.
          Orders and cash movements can only be recorded while the shift is open.
        </p>
        <Input
          label={moneyLabel('Opening amount')}
          name="opening_amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={openingAmount}
          onChange={(e) => setOpeningAmount(e.target.value)}
          autoFocus
          error={error ?? undefined}
          placeholder="500.00"
        />
        <div className="field">
          <label htmlFor="shift-notes">Notes (optional)</label>
          <textarea
            id="shift-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="Anything worth noting for the close-out"
          />
        </div>
      </form>
    </Modal>
  );
}
