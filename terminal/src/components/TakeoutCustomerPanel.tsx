import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateOrder, type ActiveOrder, type TakeoutChannel } from '../api/orders';
import { ApiError } from '../api/client';
import { TAKEOUT_CHANNEL_LABEL } from '../api/settings';

interface Props {
  order: ActiveOrder;
  // PAID/CANCELLED orders shouldn't accept edits — the parent passes false to
  // render a read-only view.
  editable: boolean;
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  hd: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    marginBottom: 10,
  },
  label: {
    fontSize: 10,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  pill: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '4px 10px',
    borderRadius: 999,
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text2)',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginTop: 10,
  },
  fieldLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text2)',
    letterSpacing: '0.04em',
  },
  input: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    minHeight: 38,
  },
  textarea: {
    width: '100%',
    padding: '9px 11px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13,
    fontFamily: 'inherit',
    outline: 'none',
    resize: 'vertical' as const,
    minHeight: 56,
  },
  readonly: {
    fontSize: 13,
    color: 'var(--text1)',
    padding: '4px 0',
  },
  readonlyMuted: {
    fontSize: 13,
    color: 'var(--text3)',
    fontStyle: 'italic',
  },
  status: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 8,
    height: 14,
  },
  statusOk: { color: 'var(--green)' },
  statusErr: { color: 'var(--red)' },
};

const dotColor: Record<TakeoutChannel, string> = {
  LOCAL: 'var(--gold)',
  DELIVERY_LOCAL: 'var(--green)',
  DELIVERY_APP: 'var(--blue, #2a6ac8)',
};

interface FieldDef {
  key:
    | 'customer_name'
    | 'customer_phone'
    | 'delivery_address'
    | 'delivery_reference'
    | 'delivery_driver_name'
    | 'delivery_app'
    | 'delivery_app_order_id';
  label: string;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'text' | 'tel';
}

// Fields shown per channel. Empty string means "show but not required".
const CHANNEL_FIELDS: Record<TakeoutChannel, FieldDef[]> = {
  LOCAL: [
    { key: 'customer_name', label: 'Customer name', placeholder: 'Pickup under what name?' },
  ],
  DELIVERY_LOCAL: [
    { key: 'customer_name', label: 'Customer name', placeholder: 'Who placed the order' },
    { key: 'customer_phone', label: 'Phone', placeholder: '+52 555 …', inputMode: 'tel' },
    { key: 'delivery_address', label: 'Address', placeholder: 'Street, number, city', multiline: true },
    { key: 'delivery_reference', label: 'References', placeholder: 'Cross streets, building, gate code…', multiline: true },
    { key: 'delivery_driver_name', label: 'Driver', placeholder: 'Who is taking it' },
  ],
  DELIVERY_APP: [
    { key: 'delivery_app', label: 'App', placeholder: 'Uber Eats, DiDi Food, Rappi…' },
    { key: 'delivery_app_order_id', label: 'App order #', placeholder: 'Reference shown by the app' },
    { key: 'customer_name', label: 'Customer name', placeholder: 'Optional' },
  ],
};

type FieldKey = FieldDef['key'];

function readField(order: ActiveOrder, key: FieldKey): string {
  return order[key] ?? '';
}

export function TakeoutCustomerPanel({ order, editable }: Props) {
  const queryClient = useQueryClient();
  const channel = order.takeout_channel;

  // Local draft state — we patch the server on blur (or after a short debounce
  // for textareas) so each keystroke isn't a round-trip.
  const fields = channel ? CHANNEL_FIELDS[channel] : [];
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const f of fields) out[f.key] = readField(order, f.key);
    return out;
  });
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync local draft when the order's server-side fields change (refetch,
  // optimistic update from elsewhere, etc.). We compare to the LAST known
  // server value so user-in-progress edits aren't clobbered mid-typing.
  const lastSyncedRef = useRef<Record<string, string>>({ ...draft });
  useEffect(() => {
    setDraft((prev) => {
      const next = { ...prev };
      for (const f of fields) {
        const server = readField(order, f.key);
        const lastSynced = lastSyncedRef.current[f.key] ?? '';
        // If the user hasn't edited this field locally (draft matches the
        // previously-synced server value), pull in the new server value.
        if (prev[f.key] === lastSynced) next[f.key] = server;
        lastSyncedRef.current[f.key] = server;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    order.id,
    order.customer_name,
    order.customer_phone,
    order.delivery_address,
    order.delivery_reference,
    order.delivery_driver_name,
    order.delivery_app,
    order.delivery_app_order_id,
  ]);

  const saveMutation = useMutation({
    mutationFn: (payload: Record<string, string | null>) =>
      updateOrder(order.id, payload),
    onSuccess: () => {
      setStatus('saved');
      setErrorMsg(null);
      queryClient.invalidateQueries({ queryKey: ['orders', 'active'] });
      queryClient.invalidateQueries({ queryKey: ['order', order.id] });
      // Reset the indicator after a short beat so future edits re-arm it.
      setTimeout(() => setStatus((s) => (s === 'saved' ? 'idle' : s)), 1500);
    },
    onError: (err) => {
      setStatus('error');
      setErrorMsg(err instanceof ApiError ? err.message : 'Could not save');
    },
  });

  function commit(key: FieldKey) {
    const value = draft[key] ?? '';
    const serverValue = readField(order, key);
    if (value === serverValue) return; // nothing changed
    setStatus('saving');
    setErrorMsg(null);
    // Empty becomes null to keep the DB clean; backend's nullifyBlank handles
    // either path, but sending null is more explicit.
    saveMutation.mutate({ [key]: value.trim() === '' ? null : value });
  }

  if (!channel) {
    return (
      <div style={styles.panel}>
        <div style={styles.hd}>
          <span style={styles.label}>Takeout details</span>
        </div>
        <div style={styles.readonlyMuted}>
          No channel set on this order.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.hd}>
        <span style={styles.label}>Channel</span>
        <span style={styles.pill}>
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: dotColor[channel],
              display: 'inline-block',
            }}
          />
          {TAKEOUT_CHANNEL_LABEL[channel]}
        </span>
      </div>

      {fields.map((f) => {
        const value = draft[f.key] ?? '';
        if (!editable) {
          return (
            <div key={f.key} style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{f.label}</span>
              <span style={value ? styles.readonly : styles.readonlyMuted}>
                {value || '—'}
              </span>
            </div>
          );
        }
        const onChange = (v: string) => setDraft((d) => ({ ...d, [f.key]: v }));
        return (
          <div key={f.key} style={styles.fieldRow}>
            <label style={styles.fieldLabel} htmlFor={`takeout-${f.key}`}>
              {f.label}
            </label>
            {f.multiline ? (
              <textarea
                id={`takeout-${f.key}`}
                style={styles.textarea}
                placeholder={f.placeholder}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => commit(f.key)}
              />
            ) : (
              <input
                id={`takeout-${f.key}`}
                style={styles.input}
                placeholder={f.placeholder}
                value={value}
                inputMode={f.inputMode}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => commit(f.key)}
              />
            )}
          </div>
        );
      })}

      <div
        style={{
          ...styles.status,
          ...(status === 'saved' ? styles.statusOk : null),
          ...(status === 'error' ? styles.statusErr : null),
        }}
      >
        {status === 'saving' && 'Saving…'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && (errorMsg ?? 'Save failed')}
      </div>
    </div>
  );
}
