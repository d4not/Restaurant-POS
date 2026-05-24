import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { UnifiedScanPanel, type UnifiedScanResult } from './UnifiedScanPanel';
import {
  ps,
  statusPillStyle,
  statusDotStyle,
  resultBannerStyle,
  PRINTER_TYPES,
  CHARACTER_SETS,
  RECOMMENDATION_PRESETS,
} from './styles';

interface PrinterRoleCardProps {
  role: PrinterRole;
  title: string;
  subtitle: string;
  config: PrinterRoleConfig;
  connected: boolean | null;
  onSave: (next: PrinterRoleConfig) => void;
}

export function PrinterRoleCard(props: PrinterRoleCardProps) {
  const { t } = useTranslation();
  const { role, title, subtitle, config, connected, onSave } = props;
  const [draft, setDraft] = useState<PrinterRoleConfig>(config);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);

  const isElectron = Boolean(window.electron?.printer?.resolve);

  const resolveQuery = useQuery({
    queryKey: ['printer-resolve'],
    queryFn: () => window.electron!.printer.resolve(),
    enabled: isElectron,
    staleTime: 30_000,
  });

  useEffect(() => {
    setDraft(config);
  }, [config]);

  const dirty =
    draft.enabled !== config.enabled ||
    draft.type !== config.type ||
    draft.connection !== config.connection ||
    draft.address !== config.address ||
    draft.width !== config.width ||
    draft.characterSet !== config.characterSet;

  async function runTest() {
    if (!window.electron) return;
    setTestResult(null);
    setTesting(true);
    try {
      const result = await window.electron.printer.testPrint(role);
      setTestResult(result);
      if (result.ok) {
        const cfg = await window.electron.printer.getConfig();
        const addr = cfg[role]?.address;
        if (addr) await window.electron.printer.markWorking({ role, address: addr });
      }
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  function handleScanSelect(result: UnifiedScanResult) {
    setDraft({
      ...draft,
      address: result.address,
      connection: result.connection,
      enabled: true,
    });
    setScanOpen(false);
  }

  const plan = resolveQuery.data?.[role]?.plan ?? null;
  const recommendation = plan?.recommendation ?? null;
  const showBadge = isElectron && recommendation && recommendation !== 'use-current';
  const preset = recommendation ? RECOMMENDATION_PRESETS[recommendation] : null;

  return (
    <div style={ps.card}>
      {/* Header */}
      <div style={ps.cardHead}>
        <div>
          <h3 style={ps.cardTitle}>{title}</h3>
          <div style={ps.cardSub}>{subtitle}</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {showBadge && preset && (
            <span
              style={{
                ...ps.badge,
                color: preset.color,
                background: preset.bg,
                border: `1px solid ${preset.color}`,
              }}
            >
              {preset.label}
            </span>
          )}
          <span style={statusPillStyle(config.enabled ? connected : null)}>
            <span style={statusDotStyle(config.enabled ? connected : null)} />
            {!config.enabled
              ? t('settings.printerDisabled')
              : connected === null
                ? t('settings.printerChecking')
                : connected
                  ? t('settings.printerConnected')
                  : t('settings.printerOffline')}
          </span>
        </div>
      </div>

      {/* Resolver reasoning */}
      {isElectron && plan?.reasoning && recommendation !== 'use-current' && (
        <div style={ps.reasoning}>{plan.reasoning}</div>
      )}

      {/* Enable toggle */}
      <div style={ps.toggleRow}>
        <input
          type="checkbox"
          id={`enable-${role}`}
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <label htmlFor={`enable-${role}`} style={ps.toggleLabel}>
          {t('settings.printerEnable').replace('{role}', role)}
        </label>
      </div>

      {/* Connection + Model */}
      <div style={{ ...ps.fieldRow, marginTop: 16 }}>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.connection')}</label>
          <select
            style={ps.select}
            value={draft.connection}
            onChange={(e) =>
              setDraft({ ...draft, connection: e.target.value as PrinterConnection })
            }
          >
            <option value="network">{t('settings.connectionNetwork')}</option>
            <option value="usb">{t('settings.connectionUsb')}</option>
          </select>
        </div>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.printerModel')}</label>
          <select
            style={ps.select}
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as PrinterRoleConfig['type'] })
            }
          >
            {PRINTER_TYPES.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Address */}
      <div style={ps.field}>
        <label style={ps.label}>
          {draft.connection === 'network' ? t('settings.ipLabel') : t('settings.deviceLabel')}
        </label>
        <div style={ps.addressRow}>
          <input
            style={{ ...ps.input, flex: 1, minWidth: 0 }}
            value={draft.address}
            placeholder={
              draft.connection === 'network' ? '192.168.1.100:9100' : '/dev/usb/lp0'
            }
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
          />
        </div>
        <div style={ps.hint}>
          {draft.connection === 'network'
            ? t('settings.printerIpHint')
            : t('settings.devicePathHint')}
        </div>
        {draft.connection === 'usb' && draft.address.startsWith('printer:') && (
          <div style={ps.driverNote}>{t('settings.detectDriverNote')}</div>
        )}
      </div>

      {/* Paper width + Character set */}
      <div style={{ ...ps.fieldRow, marginTop: 12 }}>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.paperWidthChars')}</label>
          <select
            style={ps.select}
            value={draft.width}
            onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
          >
            <option value={32}>32 — 58mm</option>
            <option value={42}>42 — 76mm</option>
            <option value={48}>48 — 80mm</option>
          </select>
        </div>
        <div style={ps.field}>
          <label style={ps.label}>{t('settings.charset')}</label>
          <select
            style={ps.select}
            value={draft.characterSet}
            onChange={(e) => setDraft({ ...draft, characterSet: e.target.value })}
          >
            {CHARACTER_SETS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scan panel */}
      <div style={{ marginTop: 14 }}>
        <button
          type="button"
          style={scanOpen ? ps.primaryBtn : ps.ghostBtn}
          onClick={() => setScanOpen((o) => !o)}
        >
          🔍 {scanOpen ? t('common.close') : t('printers.scanAll')}
        </button>
      </div>
      {scanOpen && (
        <UnifiedScanPanel
          role={role}
          onSelect={handleScanSelect}
        />
      )}

      {/* Actions */}
      <div style={ps.cardActions}>
        <button
          type="button"
          style={ps.primaryBtn}
          onClick={() => onSave(draft)}
          disabled={!dirty}
        >
          {t('settings.saveChanges')}
        </button>
        <button
          type="button"
          style={ps.ghostBtn}
          onClick={() => setDraft(config)}
          disabled={!dirty}
        >
          {t('settings.reset')}
        </button>
        <button
          type="button"
          style={ps.goldBtn}
          onClick={runTest}
          disabled={testing || !config.enabled || !config.address}
        >
          {testing ? <Spinner size={12} /> : '🖨'} {t('printers.testPrint')}
        </button>
      </div>

      {testResult && (
        <div style={resultBannerStyle(testResult.ok)}>
          {testResult.ok
            ? t('printers.testSent')
            : `${t('printers.testFailed')}: ${testResult.error ?? '—'}`}
        </div>
      )}
    </div>
  );
}
