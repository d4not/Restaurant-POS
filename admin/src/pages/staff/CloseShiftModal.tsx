import { useEffect, useMemo, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { useCloseRegister } from '../../hooks/useRegisters';
import type { CashRegister } from '../../types/operations';
import { formatMoney } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  register: CashRegister;
}

function pesosToCentavos(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 100);
}

export function CloseShiftModal({ open, onClose, register }: Props) {
  const [actualAmount, setActualAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const closeM = useCloseRegister();

  useEffect(() => {
    if (!open) return;
    setActualAmount('');
    setNotes('');
    setError(null);
    setServerError(null);
  }, [open]);

  const expectedCentavos = Number(register.expected_amount);

  // Live difference preview as the user types the counted amount.
  const preview = useMemo(() => {
    const centavos = pesosToCentavos(actualAmount);
    if (centavos === null) return null;
    return { actual: centavos, diff: centavos - expectedCentavos };
  }, [actualAmount, expectedCentavos]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setError(null);
    setServerError(null);

    const centavos = pesosToCentavos(actualAmount);
    if (centavos === null) {
      setError('Enter the amount you physically counted (e.g. 2350.00)');
      return;
    }

    try {
      await closeM.mutateAsync({
        id: register.id,
        input: {
          actual_amount: centavos,
          notes: notes.trim() || undefined,
        },
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not close the shift');
    }
  };

  const pending = closeM.isPending;
  const diffTone =
    preview === null ? '' :
    preview.diff === 0 ? 'text-muted' :
    preview.diff > 0 ? 'text-green' : 'text-red';
  const diffSign = preview && preview.diff > 0 ? '+' : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title="Close shift"
      closeOnOverlay={!pending}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="danger" loading={pending} onClick={submit}>
            Close shift
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
        <div className="detail-grid mb-16">
          <div className="detail-row cols-2">
            <div className="detail-cell">
              <div className="dk">Opening</div>
              <div className="dv">{formatMoney(Number(register.opening_amount))}</div>
            </div>
            <div className="detail-cell">
              <div className="dk">Expected</div>
              <div className="dv gold">{formatMoney(expectedCentavos)}</div>
            </div>
          </div>
        </div>

        <p className="fs-12 text-muted mb-12">
          Count the cash in the drawer right now and enter the total. The
          difference is your over/short for the shift.
        </p>

        <Input
          label="Actual amount counted (MXN)"
          name="actual_amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          min="0"
          value={actualAmount}
          onChange={(e) => setActualAmount(e.target.value)}
          autoFocus
          error={error ?? undefined}
          placeholder={(expectedCentavos / 100).toFixed(2)}
        />

        {preview && (
          <div className="detail-grid mb-16">
            <div className="detail-row cols-2">
              <div className="detail-cell">
                <div className="dk">Actual</div>
                <div className="dv">{formatMoney(preview.actual)}</div>
              </div>
              <div className="detail-cell">
                <div className="dk">Difference</div>
                <div className={`dv ${diffTone}`}>
                  {diffSign}
                  {formatMoney(preview.diff)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="field">
          <label htmlFor="close-notes">Close-out notes (optional)</label>
          <textarea
            id="close-notes"
            name="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
            placeholder="Explain any cash variance if needed"
          />
        </div>
      </form>
    </Modal>
  );
}
