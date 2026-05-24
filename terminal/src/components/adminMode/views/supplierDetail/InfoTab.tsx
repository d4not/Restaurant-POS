// Info tab — the supplier's identity card with a View↔Edit segmented toggle.
//
// In View mode the 7 fields render as label/value pill cards (notes spans the
// full row). The visual language mirrors SupplyInfoView's stat row so the
// terminal feels coherent across entity-detail screens.
//
// In Edit mode the same grid swaps to FieldText/FieldNumber inputs, with a
// sticky footer for Cancel/Save. Form state is owned by the orchestrator
// (SupplierDetailView) so the discard prompt can fire both for the View/Edit
// toggle AND for switching tabs while dirty.

import type { CSSProperties } from 'react';
import { useTranslation } from '../../../../i18n';
import type {
  Supplier,
  SupplierWriteInput,
} from '../../../../api/suppliers';
import {
  FieldNumber,
  FieldText,
  btnPrimary,
  btnSecondary,
  fieldLabel,
  formFooter,
  formGrid,
} from './supplierForm';
import { segmentBtn, segmentBtnOn, segmentWrap } from './segmented';

interface Props {
  supplier: Supplier;
  mode: 'view' | 'edit';
  form: SupplierWriteInput;
  onFormChange: (next: SupplierWriteInput) => void;
  /** Asks the orchestrator to flip modes — orchestrator may run the dirty
   *  guard first. */
  onRequestMode: (next: 'view' | 'edit') => void;
  onSave: () => void;
  saving: boolean;
}

export function InfoTab({
  supplier,
  mode,
  form,
  onFormChange,
  onRequestMode,
  onSave,
  saving,
}: Props) {
  const { t } = useTranslation();

  return (
    <div style={pageBody}>
      <div style={toolbar}>
        <div style={segmentWrap} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'view'}
            style={mode === 'view' ? segmentBtnOn : segmentBtn}
            onClick={() => onRequestMode('view')}
          >
            {t('admin.supplierDetail.mode.view')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'edit'}
            style={mode === 'edit' ? segmentBtnOn : segmentBtn}
            onClick={() => onRequestMode('edit')}
          >
            {t('admin.supplierDetail.mode.edit')}
          </button>
        </div>
      </div>

      {mode === 'view' ? (
        <ViewGrid supplier={supplier} />
      ) : (
        <EditForm
          form={form}
          onFormChange={onFormChange}
          onCancel={() => onRequestMode('view')}
          onSave={onSave}
          saving={saving}
        />
      )}
    </div>
  );
}

// ─── View mode ─────────────────────────────────────────────────────────────

function ViewGrid({ supplier }: { supplier: Supplier }) {
  const { t } = useTranslation();
  const none = t('admin.supplierDetail.value.none');
  const creditLabel =
    supplier.credit_days > 0
      ? t('admin.supplierDetail.value.creditDays').replace(
          '{days}',
          String(supplier.credit_days),
        )
      : t('admin.supplierDetail.value.creditOnDelivery');

  return (
    <div style={viewGridStyle}>
      <PillCard label={t('admin.suppliersList.field.name')} value={supplier.name} />
      <PillCard
        label={t('admin.suppliersList.field.contactName')}
        value={supplier.contact_name || none}
        muted={!supplier.contact_name}
      />
      <PillCard
        label={t('admin.suppliersList.field.phone')}
        value={supplier.phone || none}
        muted={!supplier.phone}
      />
      <PillCard
        label={t('admin.suppliersList.field.email')}
        value={supplier.email || none}
        muted={!supplier.email}
      />
      <PillCard
        label={t('admin.suppliersList.field.address')}
        value={supplier.address || none}
        muted={!supplier.address}
        wide
      />
      <PillCard
        label={t('admin.suppliersList.field.creditDays')}
        value={creditLabel}
      />
      <PillCard
        label={t('admin.suppliersList.field.notes')}
        value={supplier.notes || none}
        muted={!supplier.notes}
        wide
        multiline
      />
    </div>
  );
}

interface PillCardProps {
  label: string;
  value: string;
  muted?: boolean;
  wide?: boolean;
  multiline?: boolean;
}

function PillCard({ label, value, muted, wide, multiline }: PillCardProps) {
  return (
    <div style={{ ...pillCardStyle, ...(wide ? pillCardWide : {}) }}>
      <span style={fieldLabel}>{label}</span>
      <span
        style={{
          ...pillCardValue,
          ...(muted ? pillCardValueMuted : {}),
          ...(multiline ? pillCardValueMultiline : {}),
        }}
      >
        {value}
      </span>
    </div>
  );
}

// ─── Edit mode ─────────────────────────────────────────────────────────────

interface EditFormProps {
  form: SupplierWriteInput;
  onFormChange: (next: SupplierWriteInput) => void;
  onCancel: () => void;
  onSave: () => void;
  saving: boolean;
}

function EditForm({
  form,
  onFormChange,
  onCancel,
  onSave,
  saving,
}: EditFormProps) {
  const { t } = useTranslation();

  function patch(next: Partial<SupplierWriteInput>) {
    onFormChange({ ...form, ...next });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave();
  }

  return (
    <form onSubmit={handleSubmit} style={formInner}>
      <div style={formGrid}>
        <FieldText
          label={t('admin.suppliersList.field.name')}
          value={form.name ?? ''}
          onChange={(v) => patch({ name: v })}
          required
        />
        <FieldText
          label={t('admin.suppliersList.field.contactName')}
          value={form.contact_name ?? ''}
          onChange={(v) => patch({ contact_name: v })}
        />
        <FieldText
          label={t('admin.suppliersList.field.phone')}
          value={form.phone ?? ''}
          onChange={(v) => patch({ phone: v })}
        />
        <FieldText
          label={t('admin.suppliersList.field.email')}
          value={form.email ?? ''}
          onChange={(v) => patch({ email: v })}
          type="email"
        />
        <FieldText
          label={t('admin.suppliersList.field.address')}
          value={form.address ?? ''}
          onChange={(v) => patch({ address: v })}
          fullWidth
        />
        <FieldNumber
          label={t('admin.suppliersList.field.creditDays')}
          value={form.credit_days ?? 0}
          min={0}
          max={365}
          onChange={(v) => patch({ credit_days: v })}
        />
        <FieldText
          label={t('admin.suppliersList.field.notes')}
          value={form.notes ?? ''}
          onChange={(v) => patch({ notes: v })}
          textarea
          fullWidth
        />
      </div>

      <div style={{ ...formFooter, position: 'sticky', bottom: 0 }}>
        <button type="button" style={btnSecondary} onClick={onCancel}>
          {t('admin.supplierDetail.cancel')}
        </button>
        <span style={{ flex: 1 }} />
        <button type="submit" style={btnPrimary} disabled={saving}>
          {saving
            ? t('admin.supplierDetail.saving')
            : t('admin.supplierDetail.save')}
        </button>
      </div>
    </form>
  );
}

// ─── Styles ────────────────────────────────────────────────────────────────

const pageBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 18,
};

const toolbar: CSSProperties = {
  display: 'flex',
  justifyContent: 'flex-end',
};

const viewGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
};

const pillCardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  padding: '14px 18px',
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  minWidth: 0,
};

const pillCardWide: CSSProperties = {
  gridColumn: '1 / -1',
};

const pillCardValue: CSSProperties = {
  fontSize: 15,
  fontWeight: 500,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
  lineHeight: 1.4,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const pillCardValueMultiline: CSSProperties = {
  whiteSpace: 'pre-wrap',
  overflow: 'visible',
  textOverflow: 'clip',
};

const pillCardValueMuted: CSSProperties = {
  color: 'var(--text3)',
  fontWeight: 400,
};

const formInner: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
};
