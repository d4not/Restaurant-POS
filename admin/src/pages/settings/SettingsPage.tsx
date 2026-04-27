import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, Table } from '../../components/ui';
import type { TableColumn } from '../../components/ui';
import { Select } from '../../components/forms/Select';
import { Input } from '../../components/forms/Input';
import {
  useCreateTax,
  useDeleteTax,
  useTaxes,
  useUpdateTax,
} from '../../hooks/useTaxes';
import { useSettings, useUpdateSettings } from '../../hooks/useSettings';
import { usePrinterStatus } from '../../hooks/usePrinterStatus';
import {
  usePreferencesStore,
  type Currency,
  type DateFormat,
} from '../../store/preferences';
import type { Tax } from '../../types/menu';
import { formatDate, formatMoney } from '../../utils/format';
import { useTranslation, type Language } from '../../i18n';

const CURRENCY_OPTIONS = [
  { value: 'MXN', label: 'Mexican Peso (MXN)' },
  { value: 'USD', label: 'US Dollar (USD)' },
] as const;

const DATE_FORMAT_OPTIONS = [
  { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY (31/12/2026)' },
  { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY (12/31/2026)' },
] as const;

export function SettingsPage() {
  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <DisplayPreferencesCard />
      <DefaultTaxCard />
      <TakeoutChannelsCard />
      <PrinterSettingsCard />
      <TaxConfigurationCard />
    </div>
  );
}

/* ───────────────── Language picker (lives inside Display preferences) ── */

function LanguagePicker() {
  const { t, language, setLanguage } = useTranslation();
  const [saving, setSaving] = useState<Language | null>(null);

  async function pick(next: string | undefined) {
    if (!next || next === language) return;
    const lang = next as Language;
    setSaving(lang);
    try {
      await setLanguage(lang, { persistRemote: true });
    } finally {
      setSaving(null);
    }
  }

  const options = [
    { value: 'en', label: t('settings.languageEnglish') },
    { value: 'es', label: t('settings.languageSpanish') },
  ];

  return (
    <div className="detail-cell">
      <Select
        label={t('settings.language')}
        options={options}
        value={language}
        onValueChange={pick}
        disabled={saving !== null}
      />
    </div>
  );
}

/* ───────────────── Printers + business identity ─────────── */

const PRINTER_FIELDS = [
  'business_name',
  'business_address',
  'printer_kitchen_ip',
  'printer_kitchen_port',
  'printer_receipt_ip',
  'printer_receipt_port',
  'printer_paper_width',
] as const;
type PrinterField = (typeof PRINTER_FIELDS)[number];

const PAPER_WIDTH_OPTIONS = [
  { value: '80', label: '80mm (48 chars/line)' },
  { value: '58', label: '58mm (32 chars/line)' },
] as const;

function PrinterSettingsCard() {
  const settingsQ = useSettings();
  const updateSettingsM = useUpdateSettings();
  const statusQ = usePrinterStatus();

  const [form, setForm] = useState<Record<PrinterField, string>>({
    business_name: '',
    business_address: '',
    printer_kitchen_ip: '',
    printer_kitchen_port: '9100',
    printer_receipt_ip: '',
    printer_receipt_port: '9100',
    printer_paper_width: '80',
  });
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Pull the server values into the form on first load. Don't clobber user
  // edits on later refetches — same pattern as DefaultTaxCard.
  useEffect(() => {
    if (!settingsQ.data) return;
    if (saveState !== 'idle' && saveState !== 'saved') return;
    setForm({
      business_name: settingsQ.data.business_name ?? '',
      business_address: settingsQ.data.business_address ?? '',
      printer_kitchen_ip: settingsQ.data.printer_kitchen_ip ?? '',
      printer_kitchen_port: settingsQ.data.printer_kitchen_port ?? '9100',
      printer_receipt_ip: settingsQ.data.printer_receipt_ip ?? '',
      printer_receipt_port: settingsQ.data.printer_receipt_port ?? '9100',
      printer_paper_width: settingsQ.data.printer_paper_width ?? '80',
    });
  }, [settingsQ.data, saveState]);

  const dirty = useMemo(() => {
    if (!settingsQ.data) return false;
    return PRINTER_FIELDS.some((k) => (settingsQ.data?.[k] ?? '') !== form[k]);
  }, [form, settingsQ.data]);

  const onChange = (k: PrinterField) => (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setSaveState('idle');
    setErrorMsg(null);
  };

  const onSave = async () => {
    setSaveState('saving');
    setErrorMsg(null);
    try {
      await updateSettingsM.mutateAsync({ ...form });
      setSaveState('saved');
      // Refresh the connection dots so the operator sees the new state right away.
      statusQ.refetch();
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const status = statusQ.data;

  return (
    <Card title="Printers & business identity">
      <p className="fs-12 text-muted mb-12">
        Network printers used for kitchen comandas and customer receipts.
        Tablets call the backend, which then dispatches ESC/POS over TCP to the
        IPs below. Business name + address appear at the top of every receipt.
      </p>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>Business</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Input
          label="Business name"
          value={form.business_name}
          onChange={onChange('business_name')}
          placeholder="e.g. Cafe Central"
        />
        <Input
          label="Business address"
          value={form.business_address}
          onChange={onChange('business_address')}
          placeholder="Street, city"
        />
      </div>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>Kitchen printer</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr auto',
          gap: 12,
          alignItems: 'end',
          marginBottom: 16,
        }}
      >
        <Input
          label="IP address"
          value={form.printer_kitchen_ip}
          onChange={onChange('printer_kitchen_ip')}
          placeholder="192.168.1.50"
        />
        <Input
          label="Port"
          value={form.printer_kitchen_port}
          onChange={onChange('printer_kitchen_port')}
          inputMode="numeric"
          placeholder="9100"
        />
        <PrinterStatusDot
          configured={status?.kitchen.configured ?? false}
          connected={status?.kitchen.connected ?? false}
          loading={statusQ.isLoading}
        />
      </div>

      <h3 className="fs-13 fw-600" style={{ marginBottom: 8 }}>Receipt printer</h3>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 1fr auto',
          gap: 12,
          alignItems: 'end',
          marginBottom: 16,
        }}
      >
        <Input
          label="IP address"
          value={form.printer_receipt_ip}
          onChange={onChange('printer_receipt_ip')}
          placeholder="192.168.1.51"
        />
        <Input
          label="Port"
          value={form.printer_receipt_port}
          onChange={onChange('printer_receipt_port')}
          inputMode="numeric"
          placeholder="9100"
        />
        <PrinterStatusDot
          configured={status?.receipt.configured ?? false}
          connected={status?.receipt.connected ?? false}
          loading={statusQ.isLoading}
        />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <Select
          label="Paper width"
          options={[...PAPER_WIDTH_OPTIONS]}
          value={form.printer_paper_width}
          onValueChange={(v) => {
            setForm((f) => ({ ...f, printer_paper_width: v || '80' }));
            setSaveState('idle');
          }}
        />
        <Button
          variant="ghost"
          onClick={() => statusQ.refetch()}
          disabled={statusQ.isFetching}
        >
          Re-check
        </Button>
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
          Saved — next print will use the new configuration.
        </div>
      )}
      {saveState === 'error' && errorMsg && (
        <div className="auth-alert mt-8">{errorMsg}</div>
      )}
    </Card>
  );
}

function PrinterStatusDot({
  configured,
  connected,
  loading,
}: {
  configured: boolean;
  connected: boolean;
  loading: boolean;
}) {
  let tone: 'green' | 'gold' | 'gray' | 'red' = 'gray';
  let label = 'Not configured';
  if (loading) {
    tone = 'gray';
    label = 'Checking…';
  } else if (!configured) {
    tone = 'gray';
    label = 'Not configured';
  } else if (connected) {
    tone = 'green';
    label = 'Connected';
  } else {
    tone = 'red';
    label = 'Unreachable';
  }
  return (
    <div className="field">
      <label>Status</label>
      <div style={{ paddingTop: 4 }}>
        <Badge tone={tone}>{label}</Badge>
      </div>
    </div>
  );
}

/* ───────────────── Takeout channels ─────────────────────── */

const TAKEOUT_CHANNELS: Array<{
  key: string;
  label: string;
  hint: string;
}> = [
  {
    key: 'takeout_channel_local_active',
    label: 'Local pickup',
    hint: 'Customer waiting at the counter for pickup.',
  },
  {
    key: 'takeout_channel_delivery_local_active',
    label: 'Local delivery',
    hint: "Restaurant's own delivery driver.",
  },
  {
    key: 'takeout_channel_delivery_app_active',
    label: 'Delivery apps',
    hint: 'Uber Eats, DiDi Food, Rappi, etc. (manual entry for now.)',
  },
];

function TakeoutChannelsCard() {
  const settingsQ = useSettings();
  const updateSettingsM = useUpdateSettings();

  // Treat anything that isn't an explicit "false" as enabled — that matches
  // the migration default and keeps behaviour stable if a row is missing.
  function isEnabled(key: string): boolean {
    return settingsQ.data?.[key] !== 'false';
  }

  const onToggle = (key: string) => {
    const next = isEnabled(key) ? 'false' : 'true';
    updateSettingsM.mutate({ [key]: next });
  };

  return (
    <Card title="Takeout / delivery channels">
      <p className="fs-12 text-muted mb-12">
        The Barra/takeout zone in the terminal accepts orders from these
        channels. Disable one to hide it from the picker — open orders on a
        disabled channel keep working until they're settled.
      </p>
      <div style={{ display: 'grid', gap: 8 }}>
        {TAKEOUT_CHANNELS.map((ch) => {
          const enabled = isEnabled(ch.key);
          return (
            <div
              key={ch.key}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto',
                gap: 12,
                alignItems: 'center',
                padding: '12px 14px',
                border: '1px solid var(--border)',
                borderRadius: 8,
                background: enabled ? 'var(--surface)' : 'var(--bg)',
              }}
            >
              <div>
                <div className="fw-600 fs-13">{ch.label}</div>
                <div className="fs-11 text-muted mt-4">{ch.hint}</div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onToggle(ch.key)}
                disabled={updateSettingsM.isPending}
              >
                {enabled ? (
                  <Badge tone="green">Active</Badge>
                ) : (
                  <Badge tone="gray">Disabled</Badge>
                )}
              </button>
            </div>
          );
        })}
      </div>
      {updateSettingsM.isError && (
        <div className="auth-alert mt-8">
          {updateSettingsM.error instanceof Error
            ? updateSettingsM.error.message
            : 'Could not update channel'}
        </div>
      )}
    </Card>
  );
}

/* ───────────────── Default tax (tax-inclusive pricing) ───── */

// Separate card because the concept (which tax applies to products that don't
// override it) and the action (persisting one key in /api/v1/settings) are
// distinct from the Tax CRUD below. Explaining tax-inclusive pricing in plain
// language up-front saves a round of questions from accounting.
function DefaultTaxCard() {
  const taxesQ = useTaxes({ active: true });
  const settingsQ = useSettings();
  const updateSettingsM = useUpdateSettings();

  const [selected, setSelected] = useState<string>('');
  const [saveState, setSaveState] = useState<
    'idle' | 'saving' | 'saved' | 'error'
  >('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Sync local state when the settings query first loads. We intentionally do
  // NOT clobber local edits on every refetch — only on the initial fill.
  useEffect(() => {
    if (!settingsQ.data) return;
    if (saveState !== 'idle' && saveState !== 'saved') return;
    const current = settingsQ.data.default_tax_id ?? '';
    setSelected(current);
  }, [settingsQ.data, saveState]);

  const options = useMemo(() => {
    const taxes = taxesQ.data ?? [];
    return [
      { value: '', label: 'No default (products untaxed unless set individually)' },
      ...taxes.map((t) => ({
        value: t.id,
        label: `${t.name} — ${Number(t.rate).toFixed(2)}%`,
      })),
    ];
  }, [taxesQ.data]);

  const current = settingsQ.data?.default_tax_id ?? '';
  const dirty = selected !== current;

  const onSave = async () => {
    setSaveState('saving');
    setErrorMsg(null);
    try {
      await updateSettingsM.mutateAsync({ default_tax_id: selected });
      setSaveState('saved');
      // Reset the banner after a short beat so repeated edits re-arm it.
      setTimeout(() => setSaveState('idle'), 1500);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  return (
    <Card title="Default tax">
      <p className="fs-12 text-muted mb-12">
        Prices in the menu <strong>include tax</strong>. The system extracts the
        tax portion automatically: a $50 product with IVA 16% gives $43.10 in
        revenue and $6.90 in tax. The default tax applies to any product that
        doesn't set its own.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          gap: 12,
          alignItems: 'end',
        }}
      >
        <Select
          label="Default tax"
          options={options}
          value={selected}
          onValueChange={(v) => {
            setSelected(v);
            setSaveState('idle');
            setErrorMsg(null);
          }}
          disabled={settingsQ.isLoading || taxesQ.isLoading}
        />
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
          Saved — new order lines will use this tax when a product doesn't
          override it.
        </div>
      )}
      {saveState === 'error' && errorMsg && (
        <div className="auth-alert mt-8">{errorMsg}</div>
      )}
    </Card>
  );
}

/* ───────────────── Display preferences ─────────────────── */

function DisplayPreferencesCard() {
  const { t } = useTranslation();
  const { currency, dateFormat, setCurrency, setDateFormat } = usePreferencesStore();
  const preview = 1234567; // 12,345.67 in the chosen currency

  return (
    <Card title={t('settings.tabDisplay')}>
      <div className="detail-grid">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <Select
              label={t('settings.currency')}
              options={[...CURRENCY_OPTIONS]}
              value={currency}
              onValueChange={(v) => v && setCurrency(v as Currency)}
            />
          </div>
          <div className="detail-cell">
            <Select
              label={t('settings.dateFormat')}
              options={[...DATE_FORMAT_OPTIONS]}
              value={dateFormat}
              onValueChange={(v) => v && setDateFormat(v as DateFormat)}
            />
          </div>
        </div>
        <div className="detail-row cols-2">
          <LanguagePicker />
          <div className="detail-cell" />
        </div>
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <div className="dk">Money preview</div>
            <div className="dv gold">{formatMoney(preview)}</div>
          </div>
          <div className="detail-cell">
            <div className="dk">Date preview</div>
            <div className="dv">{formatDate(new Date())}</div>
          </div>
        </div>
      </div>
      <div className="fs-11 text-muted mt-12">
        {t('settings.languageHint')}
      </div>
    </Card>
  );
}

/* ───────────────── Tax configuration ───────────────────── */

function TaxConfigurationCard() {
  const taxesQ = useTaxes();
  const createTax = useCreateTax();
  const updateTax = useUpdateTax();
  const deleteTax = useDeleteTax();

  const [form, setForm] = useState({ name: '', rate: '' });
  const [formError, setFormError] = useState<string | null>(null);

  const taxes = useMemo(() => taxesQ.data ?? [], [taxesQ.data]);

  const onCreate = async () => {
    setFormError(null);
    const rate = Number(form.rate);
    if (!form.name.trim()) {
      setFormError('Name is required');
      return;
    }
    if (!Number.isFinite(rate) || rate < 0) {
      setFormError('Rate must be a non-negative number');
      return;
    }
    try {
      await createTax.mutateAsync({ name: form.name.trim(), rate });
      setForm({ name: '', rate: '' });
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Failed to create');
    }
  };

  const onToggleActive = async (tax: Tax) => {
    try {
      await updateTax.mutateAsync({ id: tax.id, input: { active: !tax.active } });
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Update failed');
    }
  };

  const onDelete = async (tax: Tax) => {
    if (!confirm(`Delete "${tax.name}"? Products using this tax will block the delete.`)) return;
    try {
      await deleteTax.mutateAsync(tax.id);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Delete failed');
    }
  };

  const columns: TableColumn<Tax>[] = [
    {
      key: 'name',
      header: 'Name',
      width: '2fr',
      render: (t) => <span className="fw-600 fs-13">{t.name}</span>,
    },
    {
      key: 'rate',
      header: 'Rate',
      width: '140px',
      render: (t) => <span className="fw-600 fs-13">{Number(t.rate).toFixed(2)}%</span>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '160px',
      render: (t) => (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={(ev) => {
            ev.stopPropagation();
            onToggleActive(t);
          }}
        >
          {t.active ? (
            <Badge tone="green">Active</Badge>
          ) : (
            <Badge tone="gray">Inactive</Badge>
          )}
        </button>
      ),
    },
    {
      key: 'actions',
      header: '',
      width: '120px',
      render: (t) => (
        <div className="flex gap-4" style={{ justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={(ev) => {
              ev.stopPropagation();
              onDelete(t);
            }}
          >
            ✕
          </button>
        </div>
      ),
    },
  ];

  return (
    <Card title="Tax configuration">
      {/* Inline add form */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '2fr 140px auto',
          gap: 12,
          alignItems: 'end',
          marginBottom: 16,
        }}
      >
        <Input
          label="Name"
          placeholder='e.g. "IVA 16%"'
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
        />
        <Input
          label="Rate %"
          type="number"
          step="0.01"
          min="0"
          placeholder="16.00"
          value={form.rate}
          onChange={(e) => setForm((f) => ({ ...f, rate: e.target.value }))}
        />
        <Button
          variant="primary"
          onClick={onCreate}
          loading={createTax.isPending}
          disabled={!form.name.trim() || !form.rate}
        >
          + Add tax
        </Button>
      </div>
      {formError && (
        <div className="auth-alert" style={{ marginBottom: 12 }}>
          {formError}
        </div>
      )}

      {taxes.length === 0 && !taxesQ.isLoading ? (
        <EmptyState
          message="No taxes configured"
          sub="Add a tax (e.g. IVA 16%) so you can assign it to products."
        />
      ) : (
        <Table
          columns={columns}
          rows={taxes}
          getRowKey={(t) => t.id}
          isInitialLoad={taxesQ.isLoading}
          error={taxesQ.error as Error | null}
          emptyMessage="No taxes"
        />
      )}
    </Card>
  );
}
