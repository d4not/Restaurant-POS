import { useEffect, useMemo, useState } from 'react';
import { Button, Card } from '../../components/ui';
import { Input } from '../../components/forms/Input';
import { Select } from '../../components/forms/Select';
import { useSettings, useUpdateSettings } from '../../hooks/useSettings';

/**
 * Cash-handling preferences card — extends the global Settings page with
 * the knobs the new denomination-counter close flow reads. Backend keys are
 * declared in `src/modules/settings/schema.ts` (Track A); the close UI in
 * the terminal will consume them once Track B wires up.
 *
 * Money values are stored as centavos strings (the settings table is opaque
 * key→string). Validate on save so a typo doesn't silently store "abc".
 */

const FIELDS = [
  'cash_variance_notify_threshold',
  'cash_variance_blocking_threshold',
  'cash_count_hide_subunits',
  'cash_count_default_blind_mode',
  'notifications_enabled',
  'notifications_quiet_hours_start',
  'notifications_quiet_hours_end',
] as const;
type Field = (typeof FIELDS)[number];

type FormState = Record<Field, string>;

const DEFAULTS: FormState = {
  cash_variance_notify_threshold: '5000',     // $50.00
  cash_variance_blocking_threshold: '50000',  // $500.00
  cash_count_hide_subunits: 'true',
  cash_count_default_blind_mode: 'false',
  notifications_enabled: 'false',
  notifications_quiet_hours_start: '22:00',
  notifications_quiet_hours_end: '07:00',
};

const BOOL_OPTIONS = [
  { value: 'false', label: 'Off' },
  { value: 'true', label: 'On' },
];

function pesosToCentavosStr(pesos: string): string {
  // Accept "50", "50.00", "50,00". Reject anything else.
  const cleaned = pesos.trim().replace(',', '.');
  if (cleaned === '' || cleaned === '.') return '';
  const n = Number(cleaned);
  if (!Number.isFinite(n) || n < 0) return '';
  return String(Math.round(n * 100));
}

function centavosToPesosStr(centavos: string): string {
  const n = Number(centavos);
  if (!Number.isFinite(n)) return '';
  return (n / 100).toFixed(2);
}

function isValidHHmm(s: string): boolean {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s)) return false;
  return true;
}

export function CashHandlingCard() {
  const settingsQ = useSettings();
  const updateM = useUpdateSettings();

  const [form, setForm] = useState<FormState>(DEFAULTS);
  // Pesos copies for the money fields — what the operator types — distinct
  // from the centavos string the backend stores.
  const [notifyPesos, setNotifyPesos] = useState<string>('50.00');
  const [blockingPesos, setBlockingPesos] = useState<string>('500.00');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!settingsQ.data) return;
    if (saveState !== 'idle' && saveState !== 'saved') return;
    const next: FormState = { ...DEFAULTS };
    for (const k of FIELDS) {
      const v = settingsQ.data[k];
      if (v !== undefined) next[k] = v;
    }
    setForm(next);
    setNotifyPesos(centavosToPesosStr(next.cash_variance_notify_threshold));
    setBlockingPesos(centavosToPesosStr(next.cash_variance_blocking_threshold));
  }, [settingsQ.data, saveState]);

  const dirty = useMemo(() => {
    if (!settingsQ.data) return false;
    for (const k of FIELDS) {
      const server = settingsQ.data[k] ?? DEFAULTS[k];
      if (server !== form[k]) return true;
    }
    return false;
  }, [form, settingsQ.data]);

  const onChangeMoney =
    (field: 'cash_variance_notify_threshold' | 'cash_variance_blocking_threshold', setter: (s: string) => void) =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      setter(raw);
      const centavos = pesosToCentavosStr(raw);
      if (centavos !== '') {
        setForm((f) => ({ ...f, [field]: centavos }));
        setErrorMsg(null);
      }
      setSaveState('idle');
    };

  const onChangeBool = (field: Field) => (value: string | undefined) => {
    if (value !== 'true' && value !== 'false') return;
    setForm((f) => ({ ...f, [field]: value }));
    setSaveState('idle');
  };

  const onChangeTime =
    (field: 'notifications_quiet_hours_start' | 'notifications_quiet_hours_end') =>
    (e: React.ChangeEvent<HTMLInputElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setSaveState('idle');
    };

  const onSave = async () => {
    if (pesosToCentavosStr(notifyPesos) === '') {
      setErrorMsg('Notify threshold must be a non-negative amount.');
      setSaveState('error');
      return;
    }
    if (pesosToCentavosStr(blockingPesos) === '') {
      setErrorMsg('Blocking threshold must be a non-negative amount.');
      setSaveState('error');
      return;
    }
    const notify = Number(form.cash_variance_notify_threshold);
    const blocking = Number(form.cash_variance_blocking_threshold);
    if (blocking < notify) {
      setErrorMsg('Blocking threshold should be at or above the notify threshold.');
      setSaveState('error');
      return;
    }
    if (!isValidHHmm(form.notifications_quiet_hours_start)) {
      setErrorMsg('Quiet-hours start must be in HH:mm format (e.g. 22:00).');
      setSaveState('error');
      return;
    }
    if (!isValidHHmm(form.notifications_quiet_hours_end)) {
      setErrorMsg('Quiet-hours end must be in HH:mm format (e.g. 07:00).');
      setSaveState('error');
      return;
    }

    setSaveState('saving');
    setErrorMsg(null);
    try {
      await updateM.mutateAsync({ ...form });
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <Card title="Cash handling & alerts">
      <p className="fs-12 text-muted mb-12">
        Drives the new denomination-counter close flow and the manager
        notifications dispatched on each shift close. Money fields are stored
        as integer centavos under the hood; type the amount in pesos / dollars
        and we'll convert.
      </p>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>
        Variance thresholds
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Input
          label="Notify manager when variance ≥"
          value={notifyPesos}
          onChange={onChangeMoney('cash_variance_notify_threshold', setNotifyPesos)}
          inputMode="decimal"
          placeholder="50.00"
          hint="Above this, the cashier is prompted to flag the close for review."
        />
        <Input
          label="Block close when variance ≥"
          value={blockingPesos}
          onChange={onChangeMoney('cash_variance_blocking_threshold', setBlockingPesos)}
          inputMode="decimal"
          placeholder="500.00"
          hint="Above this, only a manager+ can finalise the close (force-close with reason)."
        />
      </div>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>
        Counter UI behaviour
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Select
          label="Hide sub-unit coins"
          options={BOOL_OPTIONS}
          value={form.cash_count_hide_subunits}
          onValueChange={onChangeBool('cash_count_hide_subunits')}
        />
        <Select
          label="Default to blind close"
          options={BOOL_OPTIONS}
          value={form.cash_count_default_blind_mode}
          onValueChange={onChangeBool('cash_count_default_blind_mode')}
        />
      </div>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>
        Notifications
      </h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 12,
          alignItems: 'end',
          marginBottom: 8,
        }}
      >
        <Select
          label="Notifications enabled"
          options={BOOL_OPTIONS}
          value={form.notifications_enabled}
          onValueChange={onChangeBool('notifications_enabled')}
        />
        <Input
          label="Quiet hours start"
          value={form.notifications_quiet_hours_start}
          onChange={onChangeTime('notifications_quiet_hours_start')}
          placeholder="22:00"
        />
        <Input
          label="Quiet hours end"
          value={form.notifications_quiet_hours_end}
          onChange={onChangeTime('notifications_quiet_hours_end')}
          placeholder="07:00"
        />
      </div>

      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          gap: 8,
          marginTop: 12,
        }}
      >
        <Button
          variant="primary"
          onClick={onSave}
          loading={saveState === 'saving'}
          disabled={!dirty || settingsQ.isLoading}
        >
          Save
        </Button>
      </div>

      {saveState === 'saved' && (
        <div className="fs-11 mt-8" style={{ color: 'var(--green)' }}>
          Saved — the close flow will read these on the next shift.
        </div>
      )}
      {saveState === 'error' && errorMsg && (
        <div className="auth-alert mt-8" style={{ color: 'var(--red)' }}>
          {errorMsg}
        </div>
      )}
    </Card>
  );
}
