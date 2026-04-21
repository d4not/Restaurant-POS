import { useEffect, useState } from 'react';
import { Button, Modal } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import {
  useDeleteAttendance,
  useLogAttendance,
} from '../../hooks/useAttendance';
import type {
  Attendance,
  AttendanceStatus,
} from '../../types/staff';
import {
  ATTENDANCE_STATUSES,
  attendanceStatusLabel,
} from '../../types/staff';
import { formatDate } from '../../utils/format';

interface Props {
  open: boolean;
  onClose: () => void;
  userId: string;
  /** The day being edited — ISO date string YYYY-MM-DD. */
  date: string;
  /** The existing record for this day, if any. */
  existing?: Attendance;
}

export function AttendanceDayModal({
  open,
  onClose,
  userId,
  date,
  existing,
}: Props) {
  const [status, setStatus] = useState<AttendanceStatus>('PRESENT');
  const [isPaid, setIsPaid] = useState(true);
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [serverError, setServerError] = useState<string | null>(null);

  const logM = useLogAttendance();
  const deleteM = useDeleteAttendance();

  useEffect(() => {
    if (!open) return;
    if (existing) {
      setStatus(existing.status);
      setIsPaid(existing.is_paid);
      setReason(existing.reason ?? '');
      setNotes(existing.notes ?? '');
    } else {
      setStatus('PRESENT');
      setIsPaid(true);
      setReason('');
      setNotes('');
    }
    setServerError(null);
  }, [open, existing]);

  const submit = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    try {
      await logM.mutateAsync({
        user_id: userId,
        date,
        status,
        is_paid: status === 'ABSENT' ? isPaid : undefined,
        reason: reason.trim() || undefined,
        notes: notes.trim() || undefined,
      });
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not save');
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    setServerError(null);
    try {
      await deleteM.mutateAsync(existing.id);
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : 'Could not delete');
    }
  };

  const pending = logM.isPending || deleteM.isPending;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={`Attendance · ${formatDate(date)}`}
      closeOnOverlay={!pending}
      footer={
        <>
          {existing && (
            <Button
              variant="danger"
              onClick={onDelete}
              loading={deleteM.isPending}
              disabled={logM.isPending}
              style={{ marginRight: 'auto' }}
            >
              Clear day
            </Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={logM.isPending}>
            Save
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
          <label htmlFor="att-status">Status</label>
          <select
            id="att-status"
            value={status}
            onChange={(e) => setStatus(e.target.value as AttendanceStatus)}
          >
            {ATTENDANCE_STATUSES.map((s) => (
              <option key={s} value={s}>{attendanceStatusLabel(s)}</option>
            ))}
          </select>
        </div>

        {status === 'ABSENT' && (
          <div className="field">
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={isPaid}
                onChange={(e) => setIsPaid(e.target.checked)}
              />
              Paid absence (e.g. approved sick day)
            </label>
            <div className="fs-11 text-muted mt-4">
              Unpaid absences reduce the weekly net pay proportionally.
            </div>
          </div>
        )}

        <Input
          label="Reason (optional)"
          name="reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Sick, personal, holiday…"
          maxLength={500}
        />

        <div className="field">
          <label htmlFor="att-notes">Notes (optional)</label>
          <textarea
            id="att-notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            maxLength={2000}
          />
        </div>
      </form>
    </Modal>
  );
}
