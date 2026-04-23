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
import {
  usePreferencesStore,
  type Currency,
  type DateFormat,
} from '../../store/preferences';
import type { Tax } from '../../types/menu';
import { formatDate, formatMoney } from '../../utils/format';

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
      <TaxConfigurationCard />
    </div>
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
  const { currency, dateFormat, setCurrency, setDateFormat } = usePreferencesStore();
  const preview = 1234567; // 12,345.67 in the chosen currency

  return (
    <Card title="Display preferences">
      <div className="detail-grid">
        <div className="detail-row cols-2">
          <div className="detail-cell">
            <Select
              label="Currency"
              options={[...CURRENCY_OPTIONS]}
              value={currency}
              onValueChange={(v) => v && setCurrency(v as Currency)}
            />
          </div>
          <div className="detail-cell">
            <Select
              label="Date format"
              options={[...DATE_FORMAT_OPTIONS]}
              value={dateFormat}
              onValueChange={(v) => v && setDateFormat(v as DateFormat)}
            />
          </div>
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
        Preferences are stored in this browser. They apply immediately everywhere
        money or dates appear in the admin panel.
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
