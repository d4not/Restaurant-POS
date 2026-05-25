import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from '../../i18n';
import { fetchAllCategories } from '../../api/categories';
import { Spinner } from '../Spinner';
import { TicketTemplateEditor } from './TicketTemplateEditor';
import { ps, PRINTER_TYPES, CHARACTER_SETS } from './styles';
import type { PrinterProfile, CreateProfileInput } from '../../api/printer-profiles';
import type { Printer } from '../../api/printers';
import type { ComandaTemplate, ReceiptTemplate } from '../../types/printer-templates';
import { DEFAULT_COMANDA_TEMPLATE, DEFAULT_RECEIPT_TEMPLATE } from '../../types/printer-templates';

interface Props {
  profile: PrinterProfile | null;
  allProfiles: PrinterProfile[];
  printers: Printer[];
  onSave: (input: CreateProfileInput, categoryIds: string[]) => Promise<boolean>;
  onCancel: () => void;
  saving: boolean;
}

export function PrinterProfileEditor({ profile, allProfiles, printers, onSave, onCancel, saving }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState(profile?.name ?? '');
  const [printerId, setPrinterId] = useState<string | null>(profile?.printer_id ?? null);
  const [inlineMode, setInlineMode] = useState(!profile?.printer_id && Boolean(profile?.address));
  const [connectionType, setConnectionType] = useState<'NETWORK' | 'USB'>(profile?.connection_type ?? 'NETWORK');
  const [address, setAddress] = useState(profile?.address ?? '');
  const [paperWidth, setPaperWidth] = useState(profile?.paper_width ?? 48);
  const [printerModel, setPrinterModel] = useState(profile?.printer_model ?? 'epson');
  const [characterSet, setCharacterSet] = useState(profile?.character_set ?? 'PC850_MULTILINGUAL');
  const [printsComandas, setPrintsComandas] = useState(profile?.prints_comandas ?? true);
  const [printsReceipts, setPrintsReceipts] = useState(profile?.prints_receipts ?? false);
  const [selectedCats, setSelectedCats] = useState<Set<string>>(
    new Set(profile?.categories.map((c) => c.id) ?? []),
  );
  const [editorTab, setEditorTab] = useState<'general' | 'template'>('general');
  const [comandaTemplate, setComandaTemplate] = useState<ComandaTemplate>(
    () => ({ ...DEFAULT_COMANDA_TEMPLATE, ...(profile?.comanda_template ?? {}) }),
  );
  const [receiptTemplate, setReceiptTemplate] = useState<ReceiptTemplate>(
    () => ({ ...DEFAULT_RECEIPT_TEMPLATE, ...(profile?.receipt_template ?? {}) }),
  );

  const categoriesQuery = useQuery({
    queryKey: ['categories-all'],
    queryFn: fetchAllCategories,
    staleTime: 120_000,
  });

  useEffect(() => {
    if (profile) {
      setName(profile.name);
      setPrinterId(profile.printer_id);
      setInlineMode(!profile.printer_id && Boolean(profile.address));
      setConnectionType(profile.connection_type);
      setAddress(profile.address);
      setPaperWidth(profile.paper_width);
      setPrinterModel(profile.printer_model);
      setCharacterSet(profile.character_set);
      setPrintsComandas(profile.prints_comandas);
      setPrintsReceipts(profile.prints_receipts);
      setSelectedCats(new Set(profile.categories.map((c) => c.id)));
      setComandaTemplate({ ...DEFAULT_COMANDA_TEMPLATE, ...(profile.comanda_template ?? {}) });
      setReceiptTemplate({ ...DEFAULT_RECEIPT_TEMPLATE, ...(profile.receipt_template ?? {}) });
    }
  }, [profile]);

  function handleSubmit() {
    const input: CreateProfileInput = {
      name: name.trim(),
      prints_comandas: printsComandas,
      prints_receipts: printsReceipts,
      comanda_template: printsComandas ? comandaTemplate : undefined,
      receipt_template: printsReceipts ? receiptTemplate : undefined,
    };

    if (inlineMode) {
      input.printer_id = null;
      input.connection_type = connectionType;
      input.address = address;
      input.paper_width = paperWidth;
      input.printer_model = printerModel;
      input.character_set = characterSet;
    } else if (printerId) {
      input.printer_id = printerId;
    }

    onSave(input, Array.from(selectedCats));
  }

  function toggleCategory(catId: string) {
    setSelectedCats((prev) => {
      const next = new Set(prev);
      if (next.has(catId)) next.delete(catId);
      else next.add(catId);
      return next;
    });
  }

  const catOwnerMap = new Map<string, string>();
  for (const p of allProfiles) {
    if (p.id === profile?.id) continue;
    for (const c of p.categories) {
      catOwnerMap.set(c.id, p.name);
    }
  }

  const categories = categoriesQuery.data ?? [];
  const canSubmit = name.trim().length > 0 && !saving;
  const showTemplateTabs = printsComandas || printsReceipts;
  const selectedPrinter = printers.find((p) => p.id === printerId) ?? null;

  return (
    <div style={editorRoot}>
      <h3 style={editorTitle}>
        {profile ? t('printers.editProfile') : t('printers.newProfile')}
      </h3>

      {/* Tab navigation */}
      {showTemplateTabs && (
        <div style={tabRow}>
          <button
            type="button"
            style={editorTab === 'general' ? tabActive : tabBtn}
            onClick={() => setEditorTab('general')}
          >
            {t('printers.tabGeneral')}
          </button>
          <button
            type="button"
            style={editorTab === 'template' ? tabActive : tabBtn}
            onClick={() => setEditorTab('template')}
          >
            {t('printers.tabTemplate')}
          </button>
        </div>
      )}

      {/* Template editor tab */}
      {editorTab === 'template' && showTemplateTabs && (
        <>
          <TicketTemplateEditor
            printsComandas={printsComandas}
            printsReceipts={printsReceipts}
            comandaTemplate={comandaTemplate}
            receiptTemplate={receiptTemplate}
            onComandaChange={setComandaTemplate}
            onReceiptChange={setReceiptTemplate}
          />
          <div style={actionsRow}>
            <button type="button" style={ps.primaryBtn} onClick={handleSubmit} disabled={!canSubmit}>
              {saving ? <Spinner size={12} /> : null}
              {profile ? t('settings.saveChanges') : t('printers.createProfile')}
            </button>
            <button type="button" style={ps.ghostBtn} onClick={onCancel}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}

      {editorTab !== 'template' && <>
      {/* Name */}
      <div style={ps.field}>
        <label style={ps.label}>{t('printers.profileName')}</label>
        <input
          style={ps.input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('printers.profileNamePlaceholder')}
        />
      </div>

      {/* Role toggles */}
      <div style={{ ...ps.fieldRow, marginTop: 12 }}>
        <label style={toggleRow}>
          <input
            type="checkbox"
            checked={printsComandas}
            onChange={(e) => setPrintsComandas(e.target.checked)}
            style={checkStyle}
          />
          <span style={ps.toggleLabel}>{t('printers.printsComandas')}</span>
        </label>
        <label style={toggleRow}>
          <input
            type="checkbox"
            checked={printsReceipts}
            onChange={(e) => setPrintsReceipts(e.target.checked)}
            style={checkStyle}
          />
          <span style={ps.toggleLabel}>{t('printers.printsReceipts')}</span>
        </label>
      </div>

      {/* Printer selector */}
      <div style={{ marginTop: 16 }}>
        <label style={ps.label}>{t('printers.linkedPrinter')}</label>

        {!inlineMode && (
          <div style={{ marginTop: 6 }}>
            <select
              style={ps.select}
              value={printerId ?? ''}
              onChange={(e) => setPrinterId(e.target.value || null)}
            >
              <option value="">{t('printers.selectPrinter')}</option>
              {printers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.address || 'no address'})
                </option>
              ))}
            </select>

            {selectedPrinter && (
              <div style={printerPreview}>
                <span style={previewMeta}>{selectedPrinter.connection_type}</span>
                <span style={previewSep}>&middot;</span>
                <span style={previewAddr}>{selectedPrinter.address}</span>
                <span style={previewSep}>&middot;</span>
                <span style={previewMeta}>{selectedPrinter.printer_model}</span>
                <span style={previewSep}>&middot;</span>
                <span style={previewMeta}>
                  {selectedPrinter.paper_width === 32 ? '58mm' : selectedPrinter.paper_width === 42 ? '76mm' : '80mm'}
                </span>
              </div>
            )}
          </div>
        )}

        <label style={inlineToggle}>
          <input
            type="checkbox"
            checked={inlineMode}
            onChange={(e) => {
              setInlineMode(e.target.checked);
              if (e.target.checked) setPrinterId(null);
            }}
            style={checkStyle}
          />
          <span style={{ fontSize: 12, color: 'var(--text2)' }}>{t('printers.inlineConfig')}</span>
        </label>
      </div>

      {/* Inline hardware fields (legacy mode) */}
      {inlineMode && (
        <div style={inlineFields}>
          <div style={ps.fieldRow}>
            <div style={ps.field}>
              <label style={ps.label}>{t('settings.connection')}</label>
              <select
                style={ps.select}
                value={connectionType}
                onChange={(e) => setConnectionType(e.target.value as 'NETWORK' | 'USB')}
              >
                <option value="NETWORK">{t('settings.connectionNetwork')}</option>
                <option value="USB">{t('settings.connectionUsb')}</option>
              </select>
            </div>
            <div style={ps.field}>
              <label style={ps.label}>{t('settings.printerModel')}</label>
              <select
                style={ps.select}
                value={printerModel}
                onChange={(e) => setPrinterModel(e.target.value)}
              >
                {PRINTER_TYPES.map((p) => (
                  <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
                ))}
              </select>
            </div>
          </div>

          <div style={ps.field}>
            <label style={ps.label}>
              {connectionType === 'NETWORK' ? t('settings.ipLabel') : t('settings.deviceLabel')}
            </label>
            <input
              style={ps.input}
              value={address}
              placeholder={connectionType === 'NETWORK' ? '192.168.1.100:9100' : '/dev/usb/lp0'}
              onChange={(e) => setAddress(e.target.value)}
            />
          </div>

          <div style={ps.fieldRow}>
            <div style={ps.field}>
              <label style={ps.label}>{t('settings.paperWidthChars')}</label>
              <select
                style={ps.select}
                value={paperWidth}
                onChange={(e) => setPaperWidth(Number(e.target.value))}
              >
                <option value={32}>32 &mdash; 58mm</option>
                <option value={42}>42 &mdash; 76mm</option>
                <option value={48}>48 &mdash; 80mm</option>
              </select>
            </div>
            <div style={ps.field}>
              <label style={ps.label}>{t('settings.charset')}</label>
              <select
                style={ps.select}
                value={characterSet}
                onChange={(e) => setCharacterSet(e.target.value)}
              >
                {CHARACTER_SETS.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      {/* Category assignment */}
      <div style={{ marginTop: 18 }}>
        <label style={ps.label}>{t('printers.assignCategories')}</label>
        <div style={catGrid}>
          {categoriesQuery.isLoading && <Spinner size={14} />}
          {categories.map((cat) => {
            const selected = selectedCats.has(cat.id);
            const owner = catOwnerMap.get(cat.id);
            return (
              <button
                key={cat.id}
                type="button"
                style={catChipBtn(selected, cat.color)}
                onClick={() => toggleCategory(cat.id)}
              >
                {cat.name}
                {owner && !selected && (
                  <span style={ownerLabel}>({owner})</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Actions */}
      <div style={actionsRow}>
        <button type="button" style={ps.primaryBtn} onClick={handleSubmit} disabled={!canSubmit}>
          {saving ? <Spinner size={12} /> : null}
          {profile ? t('settings.saveChanges') : t('printers.createProfile')}
        </button>
        <button type="button" style={ps.ghostBtn} onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
      </>}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────

const editorRoot: React.CSSProperties = {
  padding: '4px 0',
};

const editorTitle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 16,
  fontWeight: 600,
  color: 'var(--text1)',
  margin: '0 0 16px',
};

const toggleRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  cursor: 'pointer',
};

const checkStyle: React.CSSProperties = {
  width: 18,
  height: 18,
  cursor: 'pointer',
};

const printerPreview: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  padding: '6px 10px',
  borderRadius: 6,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  fontSize: 11,
};

const previewMeta: React.CSSProperties = {
  color: 'var(--text2)',
  textTransform: 'capitalize',
};

const previewAddr: React.CSSProperties = {
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
  color: 'var(--text1)',
  fontSize: 11,
};

const previewSep: React.CSSProperties = {
  color: 'var(--text3)',
};

const inlineToggle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  marginTop: 10,
  cursor: 'pointer',
};

const inlineFields: React.CSSProperties = {
  marginTop: 10,
  padding: '12px 14px',
  borderRadius: 8,
  background: 'var(--bg)',
  border: '1px solid var(--border)',
};

const catGrid: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  marginTop: 8,
  maxHeight: 180,
  overflowY: 'auto',
  padding: '4px 0',
};

const catChipBtn = (selected: boolean, color: string | null): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '5px 10px',
  borderRadius: 999,
  fontSize: 12,
  fontWeight: 500,
  cursor: 'pointer',
  border: selected
    ? `2px solid ${color || 'var(--text1)'}`
    : '1px solid var(--border)',
  background: selected
    ? (color ? `${color}22` : 'rgba(44,36,32,0.06)')
    : 'var(--bg2)',
  color: selected ? 'var(--text1)' : 'var(--text2)',
  fontFamily: 'inherit',
  minHeight: 30,
  transition: 'all 0.12s',
});

const ownerLabel: React.CSSProperties = {
  fontSize: 9,
  color: 'var(--text3)',
  marginLeft: 2,
};

const tabRow: React.CSSProperties = {
  display: 'flex',
  gap: 4,
  marginBottom: 16,
};

const tabBtn: React.CSSProperties = {
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
};

const tabActive: React.CSSProperties = {
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
};

const actionsRow: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 18,
  paddingTop: 14,
  borderTop: '1px solid var(--border)',
};
