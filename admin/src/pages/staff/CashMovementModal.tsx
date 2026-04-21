import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { useCreateCashMovement } from '../../hooks/useRegisters';
import type { CashMovementType } from '../../types/operations';

interface Props {
  open: boolean;
  onClose: () => void;
  registerId: string;
}

function pesosToCentavos(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.round(num * 100);
}

export function CashMovementModal({ open, onClose, registerId }: Props) {
  const [type, setType] = useState<CashMovementType>('CASH_IN');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; reason?: string }>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const mutation = useCreateCashMovement();

  useEffect(() => {
    if (!open) return;
    setType('CASH_IN');
    setAmount('');
    setReason('');
    setErrors({});
    setServerError(null);
  }, [open]);

  const validate = () => {
    const e: typeof errors = {};
    if (pesosToCentavos(amount) === null) e.amount = 'Enter a positive amount';
    if (!reason.trim()) e.reason = 'Reason is required';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setServerError(null);

    try {
      await mutation.mutateAsync({
        registerId,
        input: {
          type,
          amount: pesosToCentavos(amount)!,
          reason: reason.trim(),
        },
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not record the movement');
    }
  };

  const pending = mutation.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Record cash movement"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            Record
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

        <div className="field">
          <label>Type</label>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className={`filter-pill ${type === 'CASH_IN' ? 'active' : ''}`}
              onClick={() => setType('CASH_IN')}
            >
              Cash in
            </button>
            <button
              type="button"
              className={`filter-pill ${type === 'CASH_OUT' ? 'active' : ''}`}
              onClick={() => setType('CASH_OUT')}
            >
              Cash out
            </button>
          </div>
          <p className="fs-11 text-muted mt-4">
            {type === 'CASH_IN'
              ? 'Adds cash to the drawer (e.g. tips deposited, change float top-up).'
              : 'Removes cash from the drawer (e.g. petty-cash purchases, float to safe).'}
          </p>
        </div>

        <Input
          label="Amount (MXN)"
          name="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          error={errors.amount}
          placeholder="0.00"
          autoFocus
        />

        <Input
          label="Reason"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={500}
          error={errors.reason}
          placeholder={type === 'CASH_IN' ? 'e.g. Tips' : 'e.g. Petty cash — milk run'}
        />
      </form>
    </Modal>
  );
}
