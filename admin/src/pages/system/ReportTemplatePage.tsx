import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card } from '../../components/ui';
import { useSettings, useUpdateSettings } from '../../hooks/useSettings';
import { useTranslation } from '../../i18n';
import { getDefaultReportTemplateCss } from '../../api/print';
import {
  fetchDailyReportPrintHtml,
  listDailyReports,
} from '../../api/daily-reports';

/* Backend keys — keep in sync with src/modules/settings/schema.ts → SETTING_KEYS.
 * Listed here as a const so a typo on the admin side surfaces at compile time
 * via the `keyof typeof KEYS` indexing below. */
const KEYS = {
  customCss: 'report_custom_css',
  customHeaderHtml: 'report_custom_header_html',
  customFooterHtml: 'report_custom_footer_html',
  showCash: 'report_show_cash',
  showSales: 'report_show_sales',
  showPayments: 'report_show_payments',
  showShifts: 'report_show_shifts',
  showProducts: 'report_show_products',
  showAlerts: 'report_show_alerts',
  showVerification: 'report_show_verification',
} as const;

/* Section toggles. The order here drives the order of the checkbox row in
 * the UI, which mirrors the order sections render in the printed report. */
const SECTIONS = [
  { key: 'cash', settingKey: KEYS.showCash, labelKey: 'reportTemplate.section.cash' },
  { key: 'sales', settingKey: KEYS.showSales, labelKey: 'reportTemplate.section.sales' },
  { key: 'payments', settingKey: KEYS.showPayments, labelKey: 'reportTemplate.section.payments' },
  { key: 'shifts', settingKey: KEYS.showShifts, labelKey: 'reportTemplate.section.shifts' },
  { key: 'products', settingKey: KEYS.showProducts, labelKey: 'reportTemplate.section.products' },
  { key: 'alerts', settingKey: KEYS.showAlerts, labelKey: 'reportTemplate.section.alerts' },
  { key: 'verification', settingKey: KEYS.showVerification, labelKey: 'reportTemplate.section.verification' },
] as const;

type SectionKey = (typeof SECTIONS)[number]['key'];

interface FormState {
  css: string;
  headerHtml: string;
  footerHtml: string;
  visibility: Record<SectionKey, boolean>;
}

function emptyForm(): FormState {
  return {
    css: '',
    headerHtml: '',
    footerHtml: '',
    visibility: {
      cash: true, sales: true, payments: true, shifts: true,
      products: true, alerts: true, verification: true,
    },
  };
}

/**
 * "Plantilla del corte Z" — the report template editor. Lets an ADMIN
 * rewrite the bundled CSS, swap in custom header/footer HTML, or hide
 * individual sections of the printable corte. Each knob persists as a
 * Settings row that the backend renderer reads on every print.
 *
 * Design choices:
 *  - Single page, vertical scroll (no tabs). The editor is rare-use; the
 *    operator wants everything visible at once when they do open it.
 *  - The CSS textarea is huge and monospaced — it's the load-bearing knob.
 *    Initial load fills it with the bundled default so they can edit it
 *    rather than start from scratch.
 *  - Save writes one PATCH /settings call with every key. Empty strings
 *    are sent so the backend's "empty ≡ unset, fall back to default"
 *    rule applies (no need for a separate "clear" action).
 *  - Preview opens the most recent CLOSED corte Z in a new tab using the
 *    SAVED settings. We don't render with the in-progress draft — saving
 *    first matches the operator's mental model ("commit, then verify").
 */
export function ReportTemplatePage() {
  const { t } = useTranslation();
  const settingsQ = useSettings();
  const updateSettingsM = useUpdateSettings();

  const [form, setForm] = useState<FormState>(emptyForm);
  const [defaultCss, setDefaultCss] = useState<string>('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Pull the bundled CSS once on mount. We use it for the "Reset" button
  // and as the placeholder when the user hasn't customised yet (so the
  // textarea isn't empty on first visit).
  useEffect(() => {
    let cancelled = false;
    getDefaultReportTemplateCss()
      .then(({ css }) => {
        if (cancelled) return;
        setDefaultCss(css);
        // If the form CSS hasn't been seeded from settings yet (still empty)
        // and no override is stored either, prefill with the default.
        setForm((f) => {
          if (f.css.trim().length > 0) return f;
          const stored = settingsQ.data?.[KEYS.customCss] ?? '';
          return stored.trim().length > 0 ? f : { ...f, css };
        });
      })
      .catch((err) => {
        if (!cancelled) setErrorMsg(err instanceof Error ? err.message : 'Could not load default CSS');
      });
    return () => { cancelled = true; };
    // settingsQ.data is intentionally omitted — we only want to seed once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prime the form from server values on first settings load. Don't clobber
  // an in-progress edit on a refetch (same pattern the other Settings cards use).
  useEffect(() => {
    if (!settingsQ.data) return;
    if (saveState !== 'idle' && saveState !== 'saved') return;
    const data = settingsQ.data;
    setForm((prev) => ({
      // Stored CSS wins. If empty AND we already loaded the default, fall
      // back to the default so the textarea is never blank on first paint.
      css: data[KEYS.customCss] ?? (prev.css || defaultCss),
      headerHtml: data[KEYS.customHeaderHtml] ?? '',
      footerHtml: data[KEYS.customFooterHtml] ?? '',
      visibility: {
        cash: data[KEYS.showCash] !== 'false',
        sales: data[KEYS.showSales] !== 'false',
        payments: data[KEYS.showPayments] !== 'false',
        shifts: data[KEYS.showShifts] !== 'false',
        products: data[KEYS.showProducts] !== 'false',
        alerts: data[KEYS.showAlerts] !== 'false',
        verification: data[KEYS.showVerification] !== 'false',
      },
    }));
  }, [settingsQ.data, defaultCss, saveState]);

  const dirty = useMemo(() => {
    if (!settingsQ.data) return false;
    const data = settingsQ.data;
    if ((data[KEYS.customCss] ?? '') !== form.css) return true;
    if ((data[KEYS.customHeaderHtml] ?? '') !== form.headerHtml) return true;
    if ((data[KEYS.customFooterHtml] ?? '') !== form.footerHtml) return true;
    for (const sec of SECTIONS) {
      const stored = (data[sec.settingKey] ?? 'true') !== 'false';
      if (stored !== form.visibility[sec.key]) return true;
    }
    return false;
  }, [form, settingsQ.data]);

  const onToggleSection = (key: SectionKey) => {
    setForm((f) => ({ ...f, visibility: { ...f.visibility, [key]: !f.visibility[key] } }));
    setSaveState('idle');
    setErrorMsg(null);
  };

  const onChangeText = (field: 'css' | 'headerHtml' | 'footerHtml') =>
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setForm((f) => ({ ...f, [field]: e.target.value }));
      setSaveState('idle');
      setErrorMsg(null);
    };

  const onResetCss = () => {
    if (!defaultCss) return;
    if (!confirm(t('reportTemplate.resetCssConfirm'))) return;
    setForm((f) => ({ ...f, css: defaultCss }));
    setSaveState('idle');
    setErrorMsg(null);
  };

  const onSave = async () => {
    setSaveState('saving');
    setErrorMsg(null);
    // Send the CSS empty when it matches the bundled default — keeps the
    // settings row clean and means the renderer goes straight to PRINT_STYLES
    // without a runtime string compare on every print.
    const cssToSave = form.css.trim() === defaultCss.trim() ? '' : form.css;
    const patch: Record<string, string> = {
      [KEYS.customCss]: cssToSave,
      [KEYS.customHeaderHtml]: form.headerHtml,
      [KEYS.customFooterHtml]: form.footerHtml,
    };
    for (const sec of SECTIONS) {
      patch[sec.settingKey] = form.visibility[sec.key] ? 'true' : 'false';
    }
    try {
      await updateSettingsM.mutateAsync(patch);
      setSaveState('saved');
      setTimeout(() => setSaveState('idle'), 1800);
    } catch (err) {
      setSaveState('error');
      setErrorMsg(err instanceof Error ? err.message : 'Save failed');
    }
  };

  // Preview reuses the same about:blank dance as DailyReportDetail so the
  // print preview's URL header reads about:blank instead of leaking a blob URL.
  const onPreview = async () => {
    if (dirty) {
      // Force a save first — preview always reflects the persisted template.
      await onSave();
    }
    setPreviewing(true);
    setErrorMsg(null);
    const w = window.open('', '_blank');
    if (!w) {
      setPreviewing(false);
      setErrorMsg('Pop-up blocked. Allow pop-ups for this site to preview.');
      return;
    }
    try {
      const page = await listDailyReports({ status: 'CLOSED', limit: 1 });
      const latest = page.items[0];
      if (!latest) {
        w.close();
        setErrorMsg(t('reportTemplate.previewMissing'));
        return;
      }
      const html = await fetchDailyReportPrintHtml(latest.id);
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      w.close();
      setErrorMsg(err instanceof Error ? err.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <h1 style={{ fontFamily: "'Playfair Display', serif", fontSize: 22, marginBottom: 4 }}>
          {t('reportTemplate.title')}
        </h1>
        <p className="fs-13 text-muted">{t('reportTemplate.subtitle')}</p>
        <div
          className="mt-12"
          style={{
            padding: '10px 14px',
            border: '1px solid var(--gold)',
            background: 'rgba(201,164,92,0.08)',
            borderRadius: 6,
            fontSize: 12,
            color: 'var(--text2)',
          }}
        >
          ⚠ {t('reportTemplate.warning')}
        </div>
      </Card>

      {/* ── Section toggles ──────────────────────────────────────── */}
      <Card title={t('reportTemplate.sectionsLabel')}>
        <p className="fs-12 text-muted mb-12">{t('reportTemplate.sectionsHint')}</p>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 8,
          }}
        >
          {SECTIONS.map((sec) => {
            const enabled = form.visibility[sec.key];
            return (
              <label
                key={sec.key}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  padding: '10px 12px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: enabled ? 'var(--surface)' : 'var(--bg)',
                  cursor: 'pointer',
                  userSelect: 'none',
                }}
              >
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => onToggleSection(sec.key)}
                  style={{ width: 16, height: 16, cursor: 'pointer' }}
                />
                <span className="fs-13 fw-600">{t(sec.labelKey)}</span>
                {!enabled && (
                  <span style={{ marginLeft: 'auto' }}>
                    <Badge tone="gray">off</Badge>
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </Card>

      {/* ── Custom header / footer HTML ──────────────────────────── */}
      <Card>
        <div className="field">
          <label>{t('reportTemplate.headerHtmlLabel')}</label>
          <textarea
            value={form.headerHtml}
            onChange={onChangeText('headerHtml')}
            placeholder={'<header class="hdr">…</header>'}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 90,
              padding: '8px 10px',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 12,
              border: '1px solid var(--border2)',
              borderRadius: 4,
              background: 'var(--bg)',
              resize: 'vertical',
            }}
          />
          <div className="fs-11 text-muted mt-4">{t('reportTemplate.headerHtmlHint')}</div>
        </div>

        <div className="field" style={{ marginBottom: 0 }}>
          <label>{t('reportTemplate.footerHtmlLabel')}</label>
          <textarea
            value={form.footerHtml}
            onChange={onChangeText('footerHtml')}
            placeholder={'<footer class="ftr">…</footer>'}
            spellCheck={false}
            style={{
              width: '100%',
              minHeight: 90,
              padding: '8px 10px',
              fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
              fontSize: 12,
              border: '1px solid var(--border2)',
              borderRadius: 4,
              background: 'var(--bg)',
              resize: 'vertical',
            }}
          />
          <div className="fs-11 text-muted mt-4">{t('reportTemplate.footerHtmlHint')}</div>
        </div>
      </Card>

      {/* ── CSS editor ───────────────────────────────────────────── */}
      <Card
        title={t('reportTemplate.cssLabel')}
        actions={
          <Button variant="ghost" onClick={onResetCss} disabled={!defaultCss}>
            {t('reportTemplate.resetCss')}
          </Button>
        }
      >
        <p className="fs-12 text-muted mb-12">{t('reportTemplate.cssHint')}</p>
        <textarea
          value={form.css}
          onChange={onChangeText('css')}
          spellCheck={false}
          style={{
            width: '100%',
            minHeight: 480,
            padding: '12px 14px',
            fontFamily: 'ui-monospace, Menlo, Consolas, monospace',
            fontSize: 12,
            lineHeight: 1.45,
            border: '1px solid var(--border2)',
            borderRadius: 4,
            background: 'var(--bg)',
            color: 'var(--text)',
            resize: 'vertical',
            tabSize: 2,
          }}
        />
      </Card>

      {/* ── Action bar ───────────────────────────────────────────── */}
      <Card>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr auto auto',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <div className="fs-12 text-muted">{t('reportTemplate.previewHint')}</div>
          <Button variant="ghost" onClick={onPreview} loading={previewing}>
            {t('reportTemplate.preview')}
          </Button>
          <Button
            variant="primary"
            onClick={onSave}
            loading={saveState === 'saving'}
            disabled={!dirty || settingsQ.isLoading}
          >
            {t('reportTemplate.save')}
          </Button>
        </div>
        {saveState === 'saved' && (
          <div className="fs-11 mt-8" style={{ color: 'var(--green)' }}>
            ✓ {t('reportTemplate.saved')}
          </div>
        )}
        {errorMsg && (
          <div className="auth-alert mt-8">{errorMsg}</div>
        )}
      </Card>
    </div>
  );
}
