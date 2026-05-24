import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateOrder, type ActiveOrder, type TakeoutChannel } from '../api/orders';
import { ApiError } from '../api/client';
import { useTranslation } from '../i18n';
import { useTakeoutChannelLabel } from './TakeoutChannelPicker';

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
  labelKey: string;
  placeholderKey?: string;
  multiline?: boolean;
  inputMode?: 'text' | 'tel';
}

// Fields shown per channel. Labels & placeholders use i18n keys looked up at
// render time so the panel re-renders when the language switches.
const CHANNEL_FIELDS: Record<TakeoutChannel, FieldDef[]> = {
  LOCAL: [
    { key: 'customer_name', labelKey: 'takeout.customerName', placeholderKey: 'takeout.localNamePh' },
  ],
  DELIVERY_LOCAL: [
    { key: 'customer_name', labelKey: 'takeout.customerName', placeholderKey: 'takeout.deliveryNamePh' },
    { key: 'customer_phone', labelKey: 'takeout.customerPhone', placeholderKey: 'takeout.phonePh', inputMode: 'tel' },
    { key: 'delivery_address', labelKey: 'takeout.address', placeholderKey: 'takeout.addressPh', multiline: true },
    { key: 'delivery_reference', labelKey: 'takeout.references', placeholderKey: 'takeout.referencesPh', multiline: true },
    { key: 'delivery_driver_name', labelKey: 'takeout.driver', placeholderKey: 'takeout.driverPh' },
  ],
  DELIVERY_APP: [
    { key: 'delivery_app', labelKey: 'takeout.app', placeholderKey: 'takeout.appPh' },
    { key: 'delivery_app_order_id', labelKey: 'takeout.appOrder', placeholderKey: 'takeout.appOrderPh' },
    { key: 'customer_name', labelKey: 'takeout.customerName', placeholderKey: 'common.optional' },
  ],
};

type FieldKey = FieldDef['key'];

function readField(order: ActiveOrder, key: FieldKey): string {
  return order[key] ?? '';
}

export function TakeoutCustomerPanel({ order, editable }: Props) {
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const channelLabel = useTakeoutChannelLabel();
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
      setErrorMsg(err instanceof ApiError ? err.message : t('takeout.couldNotSave'));
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
          <span style={styles.label}>{t('takeout.detailsHeader')}</span>
        </div>
        <div style={styles.readonlyMuted}>
          {t('takeout.noChannelSet')}
        </div>
      </div>
    );
  }

  return (
    <div style={styles.panel}>
      <div style={styles.hd}>
        <span style={styles.label}>{t('takeout.channel')}</span>
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
          {channelLabel(channel)}
        </span>
      </div>

      {fields.map((f) => {
        const value = draft[f.key] ?? '';
        if (!editable) {
          return (
            <div key={f.key} style={styles.fieldRow}>
              <span style={styles.fieldLabel}>{t(f.labelKey)}</span>
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
              {t(f.labelKey)}
            </label>
            {f.multiline ? (
              <textarea
                id={`takeout-${f.key}`}
                style={styles.textarea}
                placeholder={f.placeholderKey ? t(f.placeholderKey) : undefined}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onBlur={() => commit(f.key)}
              />
            ) : (
              <input
                id={`takeout-${f.key}`}
                style={styles.input}
                placeholder={f.placeholderKey ? t(f.placeholderKey) : undefined}
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
        {status === 'saving' && t('takeout.saving')}
        {status === 'saved' && t('takeout.saved')}
        {status === 'error' && (errorMsg ?? t('takeout.saveFailed'))}
      </div>
    </div>
  );
}
