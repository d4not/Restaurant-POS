import { useState } from 'react';
import { useTranslation } from '../../i18n';
import type { ComandaTemplate, ReceiptTemplate } from '../../types/printer-templates';
import { DEFAULT_COMANDA_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from '../../types/printer-templates';

type Tab = 'comanda' | 'receipt';

interface Props {
  printsComandas: boolean;
  printsReceipts: boolean;
  comandaTemplate: ComandaTemplate;
  receiptTemplate: ReceiptTemplate;
  onComandaChange: (t: ComandaTemplate) => void;
  onReceiptChange: (t: ReceiptTemplate) => void;
}

export function TicketTemplateEditor({
  printsComandas,
  printsReceipts,
  comandaTemplate,
  receiptTemplate,
  onComandaChange,
  onReceiptChange,
}: Props) {
  const { t } = useTranslation();
  const tabs: Tab[] = [];
  if (printsComandas) tabs.push('comanda');
  if (printsReceipts) tabs.push('receipt');

  const defaultTab = tabs[0] ?? 'comanda';
  const [activeTab, setActiveTab] = useState<Tab>(defaultTab);
  const tab = tabs.includes(activeTab) ? activeTab : defaultTab;

  if (tabs.length === 0) {
    return (
      <div style={s.empty}>
        {t('printers.templateNoRoles')}
      </div>
    );
  }

  return (
    <div>
      {tabs.length > 1 && (
        <div style={s.tabRow}>
          {tabs.map((id) => (
            <button
              key={id}
              type="button"
              style={tab === id ? s.tabActive : s.tab}
              onClick={() => setActiveTab(id)}
            >
              {id === 'comanda' ? t('printers.comandas') : t('printers.receipts')}
            </button>
          ))}
        </div>
      )}

      {tab === 'comanda' && (
        <ComandaSection template={comandaTemplate} onChange={onComandaChange} />
      )}
      {tab === 'receipt' && (
        <ReceiptSection template={receiptTemplate} onChange={onReceiptChange} />
      )}
    </div>
  );
}

function ComandaSection({
  template: t,
  onChange,
}: {
  template: ComandaTemplate;
  onChange: (t: ComandaTemplate) => void;
}) {
  const { t: tr } = useTranslation();

  const set = <K extends keyof ComandaTemplate>(key: K, val: ComandaTemplate[K]) =>
    onChange({ ...t, [key]: val });

  return (
    <div style={s.section}>
      {/* Print mode */}
      <SectionLabel text={tr('printers.templatePrintMode')} />
      <div style={s.modeRow}>
        <ModeCard
          active={t.print_mode === 'grouped'}
          title={tr('printers.modeGrouped')}
          desc={tr('printers.modeGroupedDesc')}
          onClick={() => set('print_mode', 'grouped')}
        />
        <ModeCard
          active={t.print_mode === 'per_item'}
          title={tr('printers.modePerItem')}
          desc={tr('printers.modePerItemDesc')}
          onClick={() => set('print_mode', 'per_item')}
        />
        <ModeCard
          active={t.print_mode === 'per_category'}
          title={tr('printers.modePerCategory')}
          desc={tr('printers.modePerCategoryDesc')}
          onClick={() => set('print_mode', 'per_category')}
        />
      </div>

      {/* Sections */}
      <SectionLabel text={tr('printers.templateSections')} />
      <div style={s.toggleGroup}>
        <ToggleRow label={tr('printers.sectionOrderNumber')} value={t.show_order_number} onChange={(v) => set('show_order_number', v)} />
        <ToggleRow label={tr('printers.sectionTable')} value={t.show_table} onChange={(v) => set('show_table', v)} />
        <ToggleRow label={tr('printers.sectionWaiter')} value={t.show_waiter} onChange={(v) => set('show_waiter', v)} />
        <ToggleRow label={tr('printers.sectionTime')} value={t.show_time} onChange={(v) => set('show_time', v)} />
        <ToggleRow label={tr('printers.sectionModifiers')} value={t.show_modifiers} onChange={(v) => set('show_modifiers', v)} />
        <ToggleRow label={tr('printers.sectionNotes')} value={t.show_notes} onChange={(v) => set('show_notes', v)} />
        <ToggleRow label={tr('printers.sectionVoided')} value={t.show_voided} onChange={(v) => set('show_voided', v)} />
      </div>

      {/* Custom text */}
      <SectionLabel text={tr('printers.templateCustomText')} />
      <TextInput
        label={tr('printers.headerText')}
        value={t.header_text}
        placeholder={DEFAULT_COMANDA_TEMPLATE.header_text}
        onChange={(v) => set('header_text', v)}
      />
      <TextInput
        label={tr('printers.footerText')}
        value={t.footer_text}
        placeholder={tr('printers.footerPlaceholder')}
        onChange={(v) => set('footer_text', v)}
      />

      {/* Margins */}
      <SectionLabel text={tr('printers.templateMargins')} />
      <div style={s.marginRow}>
        <MarginStepper label={tr('printers.marginTop')} value={t.margin_top} onChange={(v) => set('margin_top', v)} />
        <MarginStepper label={tr('printers.marginBottom')} value={t.margin_bottom} onChange={(v) => set('margin_bottom', v)} />
      </div>
    </div>
  );
}

function ReceiptSection({
  template: t,
  onChange,
}: {
  template: ReceiptTemplate;
  onChange: (t: ReceiptTemplate) => void;
}) {
  const { t: tr } = useTranslation();

  const set = <K extends keyof ReceiptTemplate>(key: K, val: ReceiptTemplate[K]) =>
    onChange({ ...t, [key]: val });

  return (
    <div style={s.section}>
      {/* Sections */}
      <SectionLabel text={tr('printers.templateSections')} />
      <div style={s.toggleGroup}>
        <ToggleRow label={tr('printers.sectionBusinessName')} value={t.show_business_name} onChange={(v) => set('show_business_name', v)} />
        <ToggleRow label={tr('printers.sectionAddress')} value={t.show_address} onChange={(v) => set('show_address', v)} />
        <ToggleRow label={tr('printers.sectionOrderNumber')} value={t.show_order_number} onChange={(v) => set('show_order_number', v)} />
        <ToggleRow label={tr('printers.sectionDateTime')} value={t.show_datetime} onChange={(v) => set('show_datetime', v)} />
        <ToggleRow label={tr('printers.sectionCashier')} value={t.show_cashier} onChange={(v) => set('show_cashier', v)} />
        <ToggleRow label={tr('printers.sectionTable')} value={t.show_table} onChange={(v) => set('show_table', v)} />
        <ToggleRow label={tr('printers.sectionModifiers')} value={t.show_modifiers} onChange={(v) => set('show_modifiers', v)} />
        <ToggleRow label={tr('printers.sectionSubtotal')} value={t.show_subtotal} onChange={(v) => set('show_subtotal', v)} />
        <ToggleRow label={tr('printers.sectionTax')} value={t.show_tax} onChange={(v) => set('show_tax', v)} />
        <ToggleRow label={tr('printers.sectionDiscount')} value={t.show_discount} onChange={(v) => set('show_discount', v)} />
        <ToggleRow label={tr('printers.sectionTip')} value={t.show_tip} onChange={(v) => set('show_tip', v)} />
        <ToggleRow label={tr('printers.sectionTotal')} value={t.show_total} onChange={(v) => set('show_total', v)} />
        <ToggleRow label={tr('printers.sectionPayments')} value={t.show_payments} onChange={(v) => set('show_payments', v)} />
        <ToggleRow label={tr('printers.sectionChange')} value={t.show_change} onChange={(v) => set('show_change', v)} />
      </div>

      {/* Custom text */}
      <SectionLabel text={tr('printers.templateCustomText')} />
      <TextInput
        label={tr('printers.thankYouText')}
        value={t.thank_you_text}
        placeholder={DEFAULT_RECEIPT_TEMPLATE.thank_you_text}
        onChange={(v) => set('thank_you_text', v)}
      />

      {/* Margins */}
      <SectionLabel text={tr('printers.templateMargins')} />
      <div style={s.marginRow}>
        <MarginStepper label={tr('printers.marginTop')} value={t.margin_top} onChange={(v) => set('margin_top', v)} />
        <MarginStepper label={tr('printers.marginBottom')} value={t.margin_bottom} onChange={(v) => set('margin_bottom', v)} />
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function SectionLabel({ text }: { text: string }) {
  return (
    <div style={s.sectionLabel}>{text}</div>
  );
}

function ToggleRow({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label style={s.toggleRowWrap}>
      <span style={s.toggleText}>{label}</span>
      <button
        type="button"
        style={value ? s.switchOn : s.switchOff}
        onClick={() => onChange(!value)}
        role="switch"
        aria-checked={value}
      >
        <span style={value ? s.switchKnobOn : s.switchKnobOff} />
      </button>
    </label>
  );
}

function ModeCard({
  active,
  title,
  desc,
  onClick,
}: {
  active: boolean;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button type="button" style={active ? s.modeCardActive : s.modeCard} onClick={onClick}>
      <div style={s.modeTitle}>{title}</div>
      <div style={s.modeDesc}>{desc}</div>
    </button>
  );
}

function TextInput({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  return (
    <div style={s.fieldWrap}>
      <label style={s.fieldLabel}>{label}</label>
      <input
        type="text"
        style={s.input}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function MarginStepper({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div style={s.stepperWrap}>
      <span style={s.stepperLabel}>{label}</span>
      <div style={s.stepperControls}>
        <button
          type="button"
          style={s.stepperBtn}
          disabled={value <= 0}
          onClick={() => onChange(Math.max(0, value - 1))}
        >
          -
        </button>
        <span style={s.stepperValue}>{value}</span>
        <button
          type="button"
          style={s.stepperBtn}
          disabled={value >= 5}
          onClick={() => onChange(Math.min(5, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  empty: {
    padding: '40px 20px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
  tabRow: {
    display: 'flex',
    gap: 4,
    marginBottom: 16,
  },
  tab: {
    padding: '10px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text2)',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  tabActive: {
    padding: '10px 18px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    color: '#2c2420',
    background: 'var(--gold)',
    border: '1px solid rgba(44,36,32,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  sectionLabel: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
    marginTop: 16,
    marginBottom: 8,
  },
  toggleGroup: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  toggleRowWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 16px',
    minHeight: 48,
    borderBottom: '1px solid var(--border)',
    cursor: 'pointer',
  },
  toggleText: {
    fontSize: 13,
    fontWeight: 500,
    color: 'var(--text1)',
  },
  switchOff: {
    width: 44,
    height: 26,
    borderRadius: 13,
    background: 'var(--border)',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.15s',
    padding: 0,
  },
  switchOn: {
    width: 44,
    height: 26,
    borderRadius: 13,
    background: 'var(--gold)',
    border: 'none',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
    transition: 'background 0.15s',
    padding: 0,
  },
  switchKnobOff: {
    display: 'block',
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 3,
    left: 3,
    transition: 'left 0.15s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  switchKnobOn: {
    display: 'block',
    width: 20,
    height: 20,
    borderRadius: '50%',
    background: '#fff',
    position: 'absolute',
    top: 3,
    left: 21,
    transition: 'left 0.15s',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  modeRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 8,
  },
  modeCard: {
    padding: '14px 12px',
    borderRadius: 10,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    minHeight: 72,
    transition: 'all 0.12s',
  },
  modeCardActive: {
    padding: '14px 12px',
    borderRadius: 10,
    border: '2px solid var(--gold)',
    background: 'rgba(201,164,92,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    textAlign: 'left',
    minHeight: 72,
    transition: 'all 0.12s',
  },
  modeTitle: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    marginBottom: 4,
  },
  modeDesc: {
    fontSize: 11,
    color: 'var(--text3)',
    lineHeight: 1.4,
  },
  fieldWrap: {
    marginBottom: 10,
  },
  fieldLabel: {
    display: 'block',
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text2)',
    marginBottom: 4,
  },
  input: {
    width: '100%',
    height: 42,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  marginRow: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 12,
  },
  stepperWrap: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 12px',
    minHeight: 44,
  },
  stepperLabel: {
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text2)',
  },
  stepperControls: {
    display: 'flex',
    alignItems: 'center',
    gap: 4,
  },
  stepperBtn: {
    width: 32,
    height: 32,
    borderRadius: 6,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 16,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperValue: {
    minWidth: 24,
    textAlign: 'center',
    fontSize: 14,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    color: 'var(--text1)',
  },
};
