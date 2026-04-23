import { useEffect, useRef, useState } from 'react';

interface Props {
  open: boolean;
  busy?: boolean;
  onSubmit: (reason: string | null) => void;
  onCancel: () => void;
}

/**
 * Modal the waiter sees when they tap "Request Edit" on an order. The reason
 * is optional — the cashier just seeing the flag light up on their terminal
 * is enough in most cases — but a short note ("wrong size on item 2") saves
 * the cashier walking over to ask.
 *
 * Keyboard:
 *   - Enter  → submit (Shift+Enter inserts a newline)
 *   - Escape → cancel
 */
export function RequestEditDialog({ open, busy, onSubmit, onCancel }: Props) {
  const [reason, setReason] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      // next tick — wait for the modal to mount before focusing
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCancel();
        return;
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        if (!busy) onSubmit(reason.trim() || null);
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, busy, reason, onSubmit, onCancel]);

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Request cashier help</h2>
        </div>
        <div className="modal-body">
          <p className="confirm-text">
            The cashier will see this order flagged on their screen and can
            make edits for you. A short note is optional but helpful.
          </p>
          <textarea
            ref={textareaRef}
            className="request-edit-reason"
            placeholder="e.g., Remove item 2, wrong size."
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            disabled={busy}
            rows={4}
          />
        </div>
        <div className="modal-footer">
          <button
            type="button"
            className="btn btn-ghost btn-lg"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary btn-lg"
            onClick={() => onSubmit(reason.trim() || null)}
            disabled={busy}
          >
            {busy ? 'Flagging…' : 'Flag for cashier'}
          </button>
        </div>
      </div>
    </div>
  );
}
