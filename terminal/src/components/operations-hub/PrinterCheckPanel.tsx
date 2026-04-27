import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getBridge } from '../../platform';
import type { PrinterStatusInfo } from '../../platform/types';
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

const ROLES_PRINTER_SETTINGS: ReadonlySet<string> = new Set(['ADMIN', 'MANAGER']);

const localStyles: Record<string, React.CSSProperties> = {
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '14px 16px',
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    marginBottom: 10,
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
  lastChecked: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 12,
  },
};

interface RowState {
  configured: boolean;
  connected: boolean;
  ip: string;
  port: number;
}

function rowStatus(
  state: RowState,
  t: (k: 'printerCheck.connected' | 'printerCheck.disconnected' | 'printerCheck.notConfigured') => string,
): { color: string; label: string } {
  if (!state.configured) return { color: 'var(--text3)', label: t('printerCheck.notConfigured') };
  if (state.connected) return { color: 'var(--green)', label: t('printerCheck.connected') };
  return { color: 'var(--red)', label: t('printerCheck.disconnected') };
}

export function PrinterCheckPanel({ open, onClose }: PrinterCheckPanelProps) {
  const { t } = useTranslation();
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const openSettings = useUi((s) => s.openSettings);
  const canConfigure = ROLES_PRINTER_SETTINGS.has(role);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const statusQuery = useQuery<PrinterStatusInfo>({
    queryKey: ['printer-status', 'hub'],
    queryFn: async () => {
      const status = await getBridge().print.status();
      setLastChecked(new Date());
      return status;
    },
    enabled: open,
    refetchInterval: open ? 30_000 : false,
    retry: false,
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

  if (!open) return null;

  const status = statusQuery.data;
  const errored = statusQuery.isError;

  return (
    <div style={hubStyles.childScrim} onClick={onClose}>
      <div style={hubStyles.childModal} onClick={(e) => e.stopPropagation()} role="dialog">
        <div style={hubStyles.head}>
          <h2 style={hubStyles.title}>{t('printerCheck.title')}</h2>
          <div style={hubStyles.sub}>{t('printerCheck.subtitle')}</div>
        </div>

        <div style={hubStyles.body}>
          {statusQuery.isLoading && !status ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)' }}>
              <Spinner size={16} /> {t('common.loading')}
            </div>
          ) : errored ? (
            <div style={hubStyles.errBanner}>{t('printerCheck.unavailable')}</div>
          ) : status ? (
            <>
              <PrinterRow
                label={t('printerCheck.kitchen')}
                state={status.kitchen}
                statusLabel={rowStatus(status.kitchen, t).label}
                statusColor={rowStatus(status.kitchen, t).color}
              />
              <PrinterRow
                label={t('printerCheck.receipt')}
                state={status.receipt}
                statusLabel={rowStatus(status.receipt, t).label}
                statusColor={rowStatus(status.receipt, t).color}
              />
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
            onClick={() => statusQuery.refetch()}
            disabled={statusQuery.isFetching}
          >
            {statusQuery.isFetching ? <Spinner size={12} /> : <IconRefresh />}
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
  state: RowState;
  statusLabel: string;
  statusColor: string;
}

function PrinterRow({ label, state, statusLabel, statusColor }: PrinterRowProps) {
  return (
    <div style={localStyles.row}>
      <span style={{ ...localStyles.dot, background: statusColor }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={localStyles.rowLabel}>{label}</div>
        {state.configured && (
          <div style={localStyles.rowMeta}>
            {state.ip || '—'}:{state.port}
          </div>
        )}
      </div>
      <span style={{ ...localStyles.status, color: statusColor }}>{statusLabel}</span>
    </div>
  );
}
