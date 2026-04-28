import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getPrinterDiagnostics,
  scanPrinters,
  testPrint,
  type DiscoveredPrinter,
  type PrinterDiagnosticEntry,
  type PrinterDiagnostics,
} from '../../api/print';
import { updateSettings } from '../../api/settings';
import { ApiError } from '../../api/client';
import { useUi } from '../../store/ui';
import { useSession } from '../../store/session';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { hubStyles } from './styles';
import { IconRefresh } from './HubIcons';
import { formatTime } from '../../utils/clock';

interface PrinterCheckPanelProps {
  open: boolean;
  onClose: () => void;
}

const ROLES_PRINTER_SETTINGS: ReadonlySet<string> = new Set(['CASHIER', 'MANAGER', 'ADMIN']);

const localStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '14px 16px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    marginBottom: 10,
  },
  rowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
  },
  rowLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  rowMeta: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 2,
    fontVariantNumeric: 'tabular-nums',
  },
  rowMessage: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 6,
    lineHeight: 1.45,
  },
  rowRemedies: {
    margin: '6px 0 0 16px',
    padding: 0,
    fontSize: 12,
    color: 'var(--text2)',
    lineHeight: 1.5,
  },
  rowActions: {
    display: 'flex',
    gap: 6,
    marginTop: 10,
    flexWrap: 'wrap',
  },
  actionBtn: {
    padding: '6px 11px',
    borderRadius: 6,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 32,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: '50%',
    flexShrink: 0,
  },
  status: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  refreshBtn: {
    marginLeft: 'auto',
    padding: '8px 12px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 12,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 36,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  },
  scanWrap: {
    marginTop: 18,
    padding: 14,
    border: '1px dashed var(--border)',
    borderRadius: 10,
    background: 'var(--bg)',
  },
  scanHd: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  scanTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  scanSub: {
    fontSize: 11,
    color: 'var(--text3)',
    letterSpacing: '0.04em',
    fontVariantNumeric: 'tabular-nums',
    marginTop: 2,
  },
  scanList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  scanItem: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 12px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
  },
  scanInfo: {
    flex: 1,
    minWidth: 0,
  },
  scanIp: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  scanHostname: {
    fontSize: 11,
    color: 'var(--text2)',
    marginTop: 2,
  },
  scanLatency: {
    fontSize: 11,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
  },
  scanEmpty: {
    fontSize: 12,
    color: 'var(--text3)',
    padding: '8px 4px',
  },
  lastChecked: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 12,
  },
  toastOk: {
    padding: '8px 12px',
    borderRadius: 8,
    background: 'rgba(74,140,92,0.12)',
    border: '1px solid rgba(74,140,92,0.4)',
    color: 'var(--green)',
    fontSize: 12,
    marginTop: 10,
  },
  toastErr: {
    padding: '8px 12px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.45)',
    color: 'var(--red)',
    fontSize: 12,
    marginTop: 10,
  },
};

function statusForEntry(
  entry: PrinterDiagnosticEntry,
  t: (k: 'printerCheck.connected' | 'printerCheck.disconnected' | 'printerCheck.notConfigured' | 'printerCheck.invalidPort') => string,
): { color: string; label: string } {
  if (entry.code === 'NOT_CONFIGURED') return { color: 'var(--text3)', label: t('printerCheck.notConfigured') };
  if (entry.code === 'INVALID_PORT') return { color: 'var(--red)', label: t('printerCheck.invalidPort') };
  if (entry.connected) return { color: 'var(--green)', label: t('printerCheck.connected') };
  return { color: 'var(--red)', label: t('printerCheck.disconnected') };
}

export function PrinterCheckPanel({ open, onClose }: PrinterCheckPanelProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const openSettings = useUi((s) => s.openSettings);
  const queryClient = useQueryClient();
  const canConfigure = ROLES_PRINTER_SETTINGS.has(role);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [feedback, setFeedback] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const diagnoseQuery = useQuery<PrinterDiagnostics>({
    queryKey: ['printer-diagnose'],
    queryFn: async () => {
      const data = await getPrinterDiagnostics();
      setLastChecked(new Date());
      return data;
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    retry: false,
  });

  const scanMutation = useMutation({
    mutationFn: () => scanPrinters(),
    onError: (err) => {
      setFeedback({
        kind: 'err',
        text: err instanceof ApiError ? err.message : t('printerCheck.scanFailed'),
      });
    },
    onSuccess: () => setFeedback(null),
  });

  const assignMutation = useMutation({
    mutationFn: ({ role: targetRole, ip, port }: { role: 'kitchen' | 'receipt'; ip: string; port: number }) =>
      updateSettings(
        targetRole === 'kitchen'
          ? { printer_kitchen_ip: ip, printer_kitchen_port: String(port) }
          : { printer_receipt_ip: ip, printer_receipt_port: String(port) },
      ),
    onSuccess: async (_data, variables) => {
      setFeedback({
        kind: 'ok',
        text: t(
          variables.role === 'kitchen'
            ? 'printerCheck.assignedKitchen'
            : 'printerCheck.assignedReceipt',
        ).replace('{ip}', variables.ip),
      });
      await queryClient.invalidateQueries({ queryKey: ['printer-diagnose'] });
      await queryClient.invalidateQueries({ queryKey: ['printer-status', 'hub'] });
      await queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (err) =>
      setFeedback({
        kind: 'err',
        text: err instanceof ApiError ? err.message : t('printerCheck.assignFailed'),
      }),
  });

  const testMutation = useMutation({
    mutationFn: (target: 'kitchen' | 'receipt') => testPrint(target),
    onSuccess: (result, target) => {
      if (result.ok) {
        setFeedback({
          kind: 'ok',
          text: t(target === 'kitchen' ? 'printerCheck.testKitchenOk' : 'printerCheck.testReceiptOk'),
        });
      } else {
        setFeedback({
          kind: 'err',
          text: result.error ?? t('printerCheck.testFailed'),
        });
      }
    },
    onError: (err) =>
      setFeedback({
        kind: 'err',
        text: err instanceof ApiError ? err.message : t('printerCheck.testFailed'),
      }),
  });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Reset transient feedback whenever the panel reopens.
  useEffect(() => {
    if (!open) setFeedback(null);
  }, [open]);

  if (!open) return null;

  const data = diagnoseQuery.data;
  const errored = diagnoseQuery.isError;

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.wideChildModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('printerCheck.title')}</h2>
          <div style={hubStyles.sub}>{t('printerCheck.subtitle')}</div>
        </div>

        <div style={hubStyles.body}>
          {diagnoseQuery.isLoading && !data ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> {t('common.loading')}
            </div>
          ) : errored ? (
            <div style={hubStyles.errBanner}>{t('printerCheck.unavailable')}</div>
          ) : data ? (
            <>
              <PrinterRow
                label={t('printerCheck.kitchen')}
                entry={data.kitchen}
                statusInfo={statusForEntry(data.kitchen, t)}
                canConfigure={canConfigure}
                onTest={() => testMutation.mutate('kitchen')}
                isTesting={testMutation.isPending && testMutation.variables === 'kitchen'}
                t={t}
              />
              <PrinterRow
                label={t('printerCheck.receipt')}
                entry={data.receipt}
                statusInfo={statusForEntry(data.receipt, t)}
                canConfigure={canConfigure}
                onTest={() => testMutation.mutate('receipt')}
                isTesting={testMutation.isPending && testMutation.variables === 'receipt'}
                t={t}
              />

              {canConfigure && (
                <div style={localStyles.scanWrap}>
                  <div style={localStyles.scanHd}>
                    <div>
                      <div style={localStyles.scanTitle}>{t('printerCheck.scanTitle')}</div>
                      <div style={localStyles.scanSub}>
                        {scanMutation.data
                          ? t('printerCheck.scanSummary')
                              .replace('{count}', String(scanMutation.data.printers.length))
                              .replace('{scanned}', String(scanMutation.data.scanned))
                              .replace('{subnet}', scanMutation.data.subnet ?? '—')
                          : t('printerCheck.scanHint')}
                      </div>
                    </div>
                    <button
                      type="button"
                      style={localStyles.refreshBtn}
                      onClick={() => scanMutation.mutate()}
                      disabled={scanMutation.isPending}
                    >
                      {scanMutation.isPending ? <Spinner size={12} /> : <IconRefresh />}
                      <span>{t('printerCheck.scan')}</span>
                    </button>
                  </div>

                  {scanMutation.isPending && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)', fontSize: 12 }}>
                      <Spinner size={12} /> {t('printerCheck.scanning')}
                    </div>
                  )}

                  {scanMutation.data && scanMutation.data.printers.length === 0 && !scanMutation.isPending && (
                    <div style={localStyles.scanEmpty}>{t('printerCheck.scanEmpty')}</div>
                  )}

                  {scanMutation.data && scanMutation.data.printers.length > 0 && (
                    <div style={localStyles.scanList}>
                      {scanMutation.data.printers.map((p) => (
                        <ScanItem
                          key={`${p.ip}:${p.port}`}
                          printer={p}
                          onAssign={(targetRole) =>
                            assignMutation.mutate({ role: targetRole, ip: p.ip, port: p.port })
                          }
                          assigning={assignMutation.isPending}
                          t={t}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {feedback && (
                <div style={feedback.kind === 'ok' ? localStyles.toastOk : localStyles.toastErr}>
                  {feedback.text}
                </div>
              )}

              {lastChecked && (
                <div style={localStyles.lastChecked}>
                  {t('printerCheck.lastChecked').replace('{time}', formatTime(lastChecked))}
                </div>
              )}
            </>
          ) : null}
        </div>

        <div style={hubStyles.actions}>
          <button
            type="button"
            style={localStyles.refreshBtn}
            onClick={() => diagnoseQuery.refetch()}
            disabled={diagnoseQuery.isFetching}
          >
            {diagnoseQuery.isFetching ? <Spinner size={12} /> : <IconRefresh />}
            <span>{t('printerCheck.refresh')}</span>
          </button>
          {canConfigure && (
            <button
              type="button"
              style={hubStyles.cancelBtn}
              onClick={() => {
                onClose();
                openSettings();
              }}
            >
              {t('printerCheck.openSettings')}
            </button>
          )}
          <button type="button" style={hubStyles.primaryBtn} onClick={onClose}>
            {t('common.close')}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PrinterRowProps {
  label: string;
  entry: PrinterDiagnosticEntry;
  statusInfo: { color: string; label: string };
  canConfigure: boolean;
  onTest: () => void;
  isTesting: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}

function PrinterRow({ label, entry, statusInfo, canConfigure, onTest, isTesting, t }: PrinterRowProps) {
  return (
    <div style={localStyles.row}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, width: '100%' }}>
        <div style={localStyles.rowHead}>
          <span style={{ ...localStyles.dot, background: statusInfo.color }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={localStyles.rowLabel}>{label}</div>
            {entry.configured && (
              <div style={localStyles.rowMeta}>
                {entry.ip || '—'}:{entry.port}
              </div>
            )}
          </div>
          <span style={{ ...localStyles.status, color: statusInfo.color }}>{statusInfo.label}</span>
        </div>
        <div style={localStyles.rowMessage}>{entry.message}</div>
        {entry.remedies.length > 0 && (
          <ul style={localStyles.rowRemedies}>
            {entry.remedies.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        )}
        {canConfigure && entry.configured && (
          <div style={localStyles.rowActions}>
            <button
              type="button"
              style={localStyles.actionBtn}
              onClick={onTest}
              disabled={isTesting}
            >
              {isTesting && <Spinner size={10} />}
              {t('printerCheck.testPrint')}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface ScanItemProps {
  printer: DiscoveredPrinter;
  onAssign: (role: 'kitchen' | 'receipt') => void;
  assigning: boolean;
  t: ReturnType<typeof useTranslation>['t'];
}

function ScanItem({ printer, onAssign, assigning, t }: ScanItemProps) {
  return (
    <div style={localStyles.scanItem}>
      <div style={localStyles.scanInfo}>
        <div style={localStyles.scanIp}>{printer.ip}:{printer.port}</div>
        {printer.hostname && <div style={localStyles.scanHostname}>{printer.hostname}</div>}
      </div>
      <span style={localStyles.scanLatency}>{printer.latency_ms} ms</span>
      <button
        type="button"
        style={localStyles.actionBtn}
        onClick={() => onAssign('kitchen')}
        disabled={assigning}
      >
        {t('printerCheck.assignKitchen')}
      </button>
      <button
        type="button"
        style={localStyles.actionBtn}
        onClick={() => onAssign('receipt')}
        disabled={assigning}
      >
        {t('printerCheck.assignReceipt')}
      </button>
    </div>
  );
}
