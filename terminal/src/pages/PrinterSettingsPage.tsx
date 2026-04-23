import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToastStore } from '../store/toast';
import { defaultPathForRole, useSessionStore } from '../store/session';
import { useKeyboardShortcut } from '../hooks/useKeyboardShortcut';
import type {
  InterfaceType,
  PrinterBrand,
  PrinterConfig,
  PrinterKind,
  PrinterResult,
  PrinterStore,
} from '../types/electron';

const BRANDS: PrinterBrand[] = ['EPSON', 'STAR', 'TANCA', 'DARUMA', 'BROTHER', 'CUSTOM'];

// 58mm paper is 32 chars, 80mm is 42 or 48. We only expose the common widths
// — custom rolls can be typed in via the "Other" field if it ever comes up.
const WIDTHS = [32, 42, 48];

export function PrinterSettingsPage() {
  const navigate = useNavigate();
  const pushToast = useToastStore((s) => s.push);
  const user = useSessionStore((s) => s.user);

  // Escape takes the user back to their home screen so they don't have to
  // reach for the menu just to exit.
  useKeyboardShortcut('Escape', () => {
    if (user) navigate(defaultPathForRole(user.role));
    else navigate('/');
  });
  const [config, setConfig] = useState<PrinterStore | null>(null);
  const [status, setStatus] = useState<Record<PrinterKind, PrinterResult | null>>({
    receipt: null,
    kitchen: null,
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});

  const refreshConfig = useCallback(async () => {
    if (!window.electron) return;
    const fresh = await window.electron.getPrinterConfig();
    setConfig(fresh);
  }, []);

  useEffect(() => {
    void refreshConfig();
  }, [refreshConfig]);

  if (!window.electron) {
    return (
      <div className="page">
        <header className="page-header">
          <div className="title">
            <div className="crumb">System</div>
            <h1>Printers</h1>
          </div>
          <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
            Back
          </button>
        </header>
        <div className="empty">
          <div className="icon">🖨️</div>
          <div className="title">Printer bridge unavailable</div>
          <div>Printer configuration is only available inside the desktop terminal app.</div>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="page">
        <div className="empty">
          <div className="title">Loading printer settings…</div>
        </div>
      </div>
    );
  }

  async function updateField(kind: PrinterKind, patch: Partial<PrinterConfig>) {
    if (!window.electron) return;
    const next = await window.electron.setPrinterConfig(kind, patch);
    setConfig((prev) => (prev ? { ...prev, [kind]: next } : prev));
  }

  async function probe(kind: PrinterKind) {
    if (!window.electron) return;
    setBusy((b) => ({ ...b, [`probe:${kind}`]: true }));
    try {
      const res = await window.electron.probePrinter(kind);
      setStatus((s) => ({ ...s, [kind]: res }));
    } finally {
      setBusy((b) => ({ ...b, [`probe:${kind}`]: false }));
    }
  }

  async function testPrint(kind: PrinterKind) {
    if (!window.electron) return;
    setBusy((b) => ({ ...b, [`test:${kind}`]: true }));
    try {
      const res = await window.electron.printTestPage(kind);
      setStatus((s) => ({ ...s, [kind]: res }));
      if (res.ok) pushToast(`Test page sent to the ${kind} printer`, 'success');
      else pushToast(`${kind} printer: ${res.message ?? 'unknown error'}`, 'error');
    } finally {
      setBusy((b) => ({ ...b, [`test:${kind}`]: false }));
    }
  }

  return (
    <div className="printer-settings">
      <header className="page-header" style={{ marginBottom: 4 }}>
        <div className="title">
          <div className="crumb">System</div>
          <h1>Printers</h1>
        </div>
        <button type="button" className="btn btn-ghost" onClick={() => navigate(-1)}>
          Back
        </button>
      </header>

      <PrinterCard
        kind="receipt"
        title="Receipt Printer"
        hint="Usually at the bar — prints customer receipts after payment."
        config={config.receipt}
        status={status.receipt}
        busy={busy}
        onPatch={(patch) => updateField('receipt', patch)}
        onProbe={() => probe('receipt')}
        onTest={() => testPrint('receipt')}
      />
      <PrinterCard
        kind="kitchen"
        title="Kitchen Printer"
        hint="Usually in the kitchen — prints comandas when waiters send orders."
        config={config.kitchen}
        status={status.kitchen}
        busy={busy}
        onPatch={(patch) => updateField('kitchen', patch)}
        onProbe={() => probe('kitchen')}
        onTest={() => testPrint('kitchen')}
      />
    </div>
  );
}

interface CardProps {
  kind: PrinterKind;
  title: string;
  hint: string;
  config: PrinterConfig;
  status: PrinterResult | null;
  busy: Record<string, boolean>;
  onPatch: (patch: Partial<PrinterConfig>) => void;
  onProbe: () => void;
  onTest: () => void;
}

function PrinterCard({
  kind,
  title,
  hint,
  config,
  status,
  busy,
  onPatch,
  onProbe,
  onTest,
}: CardProps) {
  // Surface the current interface as a single string. Users on Linux point at
  // /dev/usb/lp0; on Windows it's "printer:NAME" or similar. We don't split
  // USB into sub-fields because the exact shape varies by driver.
  const interfacePlaceholder =
    config.interface_type === 'NETWORK'
      ? 'tcp://192.168.1.100:9100'
      : '/dev/usb/lp0  or  printer:EPSON_TM_T88';

  return (
    <section className="printer-card">
      <h2>
        <span>{title}</span>
        <label className="flex-center gap-8" style={{ fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(e) => onPatch({ enabled: e.target.checked })}
          />
          <span>Enabled</span>
        </label>
      </h2>
      <p className="text-mute" style={{ fontSize: 13 }}>
        {hint}
      </p>

      <div className="field-row">
        <div className="field-label">Connection</div>
        <div className="segmented">
          {(['NETWORK', 'USB'] as InterfaceType[]).map((t) => (
            <button
              key={t}
              type="button"
              className={config.interface_type === t ? 'active' : ''}
              onClick={() => onPatch({ interface_type: t })}
            >
              {t === 'NETWORK' ? 'Network (TCP)' : 'USB'}
            </button>
          ))}
        </div>
      </div>

      <div className="field-row">
        <div className="field-label">Address</div>
        <input
          className="field-input"
          value={config.interface}
          placeholder={interfacePlaceholder}
          onChange={(e) => onPatch({ interface: e.target.value })}
          spellCheck={false}
          autoComplete="off"
        />
      </div>

      <div className="field-row">
        <div className="field-label">Driver</div>
        <select
          className="field-input"
          value={config.type}
          onChange={(e) => onPatch({ type: e.target.value as PrinterBrand })}
        >
          {BRANDS.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>
      </div>

      <div className="field-row">
        <div className="field-label">Paper width</div>
        <div className="segmented">
          {WIDTHS.map((w) => (
            <button
              key={w}
              type="button"
              className={config.width === w ? 'active' : ''}
              onClick={() => onPatch({ width: w })}
            >
              {w} chars {w === 32 ? '(58mm)' : '(80mm)'}
            </button>
          ))}
        </div>
      </div>

      <div className="printer-footer">
        <span
          className={`printer-status ${status ? (status.ok ? 'ok' : 'err') : ''}`}
          title={status?.message ?? undefined}
        >
          {status
            ? status.ok
              ? '● Connected'
              : `● ${status.message ?? 'Not reachable'}`
            : '○ Unknown status'}
        </span>
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onProbe}
          disabled={busy[`probe:${kind}`]}
        >
          {busy[`probe:${kind}`] ? 'Checking…' : 'Check connection'}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={onTest}
          disabled={!config.enabled || busy[`test:${kind}`]}
        >
          {busy[`test:${kind}`] ? 'Printing…' : 'Print test page'}
        </button>
      </div>
    </section>
  );
}
