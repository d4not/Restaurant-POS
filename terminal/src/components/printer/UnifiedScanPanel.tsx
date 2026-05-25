import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { scanPrinters, type DiscoveredPrinter } from '../../api/print';
import { Spinner } from '../Spinner';
import { useTranslation } from '../../i18n';
import { ps, scanRowIconStyle, STATUS_COLOR } from './styles';

type ScanFilter = 'all' | 'usb' | 'network';

export interface UnifiedScanResult {
  id: string;
  source: 'usb' | 'network' | 'os-spooler';
  label: string;
  address: string;
  connection: 'usb' | 'network';
  status: DetectedPrinterStatus | 'unknown';
  statusColor: string;
  isUsb: boolean;
  isDefault: boolean;
  canWrite: boolean;
  port: string | null;
  note: string | null;
  kind: DetectedPrinterKind | 'network';
  latency?: number;
}

function mergeResults(
  usb: DetectedPrintersResult | null,
  network: DiscoveredPrinter[] | null,
): UnifiedScanResult[] {
  const out: UnifiedScanResult[] = [];

  if (usb) {
    for (const p of usb.printers) {
      out.push({
        id: p.id,
        source: p.kind === 'device' ? 'usb' : 'os-spooler',
        label: p.label,
        address: p.address,
        connection: 'usb',
        status: p.status,
        statusColor: STATUS_COLOR[p.status] ?? 'var(--text3)',
        isUsb: p.isUsb,
        isDefault: p.isDefault,
        canWrite: p.canWrite,
        port: p.port ?? null,
        note: p.note ?? null,
        kind: p.kind,
      });
    }
  }

  if (network) {
    for (const p of network) {
      out.push({
        id: `net:${p.ip}:${p.port}`,
        source: 'network',
        label: p.hostname || `${p.ip}:${p.port}`,
        address: `${p.ip}:${p.port}`,
        connection: 'network',
        status: 'unknown',
        statusColor: 'var(--green)',
        isUsb: false,
        isDefault: false,
        canWrite: true,
        port: String(p.port),
        note: null,
        kind: 'network',
        latency: p.latency_ms,
      });
    }
  }

  out.sort((a, b) => {
    if (a.source !== 'network' && b.source === 'network') return -1;
    if (a.source === 'network' && b.source !== 'network') return 1;
    if (a.isUsb && !b.isUsb) return -1;
    if (!a.isUsb && b.isUsb) return 1;
    return a.label.localeCompare(b.label);
  });

  return out;
}

const SOURCE_BADGE_COLORS: Record<string, { bg: string; color: string }> = {
  usb: { bg: 'rgba(74,140,92,0.14)', color: 'var(--green)' },
  'os-spooler': { bg: 'rgba(201,164,92,0.18)', color: '#8a6d2a' },
  network: { bg: 'rgba(168,152,136,0.18)', color: 'var(--text2)' },
};

interface UnifiedScanPanelProps {
  onSelect: (result: UnifiedScanResult) => void;
}

export function UnifiedScanPanel({ onSelect }: UnifiedScanPanelProps) {
  const { t } = useTranslation();
  const isElectron = Boolean(window.electron?.printer?.listUsb);
  const [filter, setFilter] = useState<ScanFilter>('all');
  const [scanning, setScanning] = useState(false);

  const usbQuery = useQuery({
    queryKey: ['printer-detect'],
    queryFn: () => window.electron!.printer.listUsb(),
    enabled: false,
  });

  const networkMutation = useMutation({
    mutationFn: () => scanPrinters(),
  });

  async function runScan() {
    setScanning(true);
    try {
      const promises: Promise<unknown>[] = [networkMutation.mutateAsync()];
      if (isElectron) promises.push(usbQuery.refetch());
      await Promise.allSettled(promises);
    } finally {
      setScanning(false);
    }
  }

  const merged = mergeResults(
    usbQuery.data ?? null,
    networkMutation.data?.printers ?? null,
  );

  const hasResults = merged.length > 0;
  const visible = merged.filter((r) => {
    if (filter === 'usb') return r.source !== 'network';
    if (filter === 'network') return r.source === 'network';
    return true;
  });

  const usbCount = merged.filter((r) => r.source !== 'network').length;
  const netCount = merged.filter((r) => r.source === 'network').length;

  const btnLabel = t('printers.useAsKitchen');

  return (
    <div style={ps.scanPanel}>
      <div style={ps.scanHead}>
        <div>
          <div style={ps.scanTitle}>{t('printers.scanAll')}</div>
          <div style={ps.scanSub}>
            {hasResults
              ? t('printers.scanSummary')
                  .replace('{usb}', String(usbCount))
                  .replace('{network}', String(netCount))
              : t('printers.scanNetworkHint')}
          </div>
        </div>
        <div style={ps.scanActions}>
          {hasResults && (
            <FilterPills filter={filter} setFilter={setFilter} isElectron={isElectron} />
          )}
          <button
            type="button"
            style={ps.refreshBtn}
            onClick={runScan}
            disabled={scanning}
          >
            {scanning ? <Spinner size={11} /> : '↻'} {t('printers.scanAll')}
          </button>
        </div>
      </div>

      {scanning && !hasResults && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text2)', fontSize: 12 }}>
          <Spinner size={12} /> {t('printers.scanning')}
        </div>
      )}

      {networkMutation.isError && (
        <div style={ps.scanErr}>{t('printers.scanFailed')}</div>
      )}

      {!scanning && hasResults && visible.length === 0 && (
        <div style={ps.scanEmpty}>
          {filter === 'usb'
            ? getPlatformEmptyText(usbQuery.data?.platform, t)
            : t('printers.scanEmptyNetwork')}
        </div>
      )}

      {!scanning && !hasResults && !networkMutation.isPending && networkMutation.data && (
        <div style={ps.scanEmpty}>{t('printers.scanEmpty')}</div>
      )}

      {visible.length > 0 && (
        <div style={ps.scanList}>
          {visible.map((item) => (
            <ScanRow
              key={item.id}
              item={item}
              onSelect={() => onSelect(item)}
              btnLabel={btnLabel}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterPills({
  filter,
  setFilter,
  isElectron,
}: {
  filter: ScanFilter;
  setFilter: (f: ScanFilter) => void;
  isElectron: boolean;
}) {
  const { t } = useTranslation();
  const pills: { key: ScanFilter; label: string }[] = [
    { key: 'all', label: t('printers.filterAll') },
  ];
  if (isElectron) pills.push({ key: 'usb', label: t('printers.filterUsb') });
  pills.push({ key: 'network', label: t('printers.filterNetwork') });

  return (
    <div style={{ display: 'flex', gap: 4 }}>
      {pills.map((p) => (
        <button
          key={p.key}
          type="button"
          style={filter === p.key ? ps.filterPillActive : ps.filterPill}
          onClick={() => setFilter(p.key)}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}

function ScanRow({
  item,
  onSelect,
  btnLabel,
}: {
  item: UnifiedScanResult;
  onSelect: () => void;
  btnLabel: string;
}) {
  const { t } = useTranslation();
  const badgeColor = SOURCE_BADGE_COLORS[item.source] ?? SOURCE_BADGE_COLORS.network;
  const sourceLabel =
    item.source === 'usb'
      ? t('printers.sourceUsb')
      : item.source === 'os-spooler'
        ? t('printers.sourceSpooler')
        : t('printers.sourceNetwork');

  return (
    <div style={ps.row}>
      <div style={scanRowIconStyle(item.kind === 'network' ? 'system' : item.kind as DetectedPrinterKind, item.isUsb)}>
        {item.kind === 'network' ? '◉' : item.kind === 'device' ? '▣' : '▤'}
      </div>
      <div style={ps.rowMain}>
        <div style={ps.rowLabel}>
          {item.label}
          {item.isDefault && (
            <span style={ps.defaultBadge}>{t('printers.default')}</span>
          )}
          <span style={{ ...ps.sourceBadge, background: badgeColor.bg, color: badgeColor.color }}>
            {sourceLabel}
          </span>
        </div>
        <div style={ps.rowMeta}>
          <span style={{ ...ps.statusDot, background: item.statusColor }} />
          {item.port && (
            <>
              <span style={ps.sep}>·</span>
              <span style={{ fontVariantNumeric: 'tabular-nums' }}>{item.port}</span>
            </>
          )}
          <span style={ps.sep}>·</span>
          <code style={ps.address}>{item.address}</code>
          {item.latency != null && (
            <>
              <span style={ps.sep}>·</span>
              <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text3)', fontSize: 11 }}>
                {item.latency} ms
              </span>
            </>
          )}
        </div>
        {item.note && <div style={ps.rowNote}>{item.note}</div>}
      </div>
      <button type="button" style={ps.useBtn} onClick={onSelect}>
        {btnLabel}
      </button>
    </div>
  );
}

function getPlatformEmptyText(
  platform: string | undefined,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (platform === 'win32') return t('printers.detectEmptyWindows');
  if (platform === 'darwin') return t('printers.detectEmptyMac');
  if (platform === 'linux') return t('printers.detectEmptyLinux');
  return t('printers.detectEmptyUsb');
}
