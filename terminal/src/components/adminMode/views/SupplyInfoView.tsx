// Supply · Info — full-page read-only summary for one supply.
//
// Replaces the right-hand drawer that SuppliesListView used to open. The
// information density grows over time: stock by storage is live, the other
// four sections (movements, suppliers, consumers, variance) render a
// "Coming soon" stub until their endpoints land in fase 2.
//
// Backend touch points
//   GET /api/v1/supplies/:id              — header, stats, status
//   GET /api/v1/supplies/:id/stocks       — Stock by storage section
//
// Layout
//   AdminViewShell (Back · "Supply detail" · subtitle · Edit · Delete actions)
//   └─ Body
//       ├─ Stat row (avg cost · last cost · total stock)
//       ├─ Stock by storage           — live
//       ├─ Recent movements           — Coming soon
//       ├─ Suppliers                  — Coming soon
//       ├─ Used by                    — Coming soon
//       └─ Count variance             — Coming soon

import { useMemo, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { AdminViewShell } from './AdminViewShell';
import { SupplyMovementsSection } from './SupplyMovementsSection';
import { SupplySuppliersSection } from './SupplySuppliersSection';
import { SupplyConsumersSection } from './SupplyConsumersSection';
import { SupplyVarianceSection } from './SupplyVarianceSection';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { listStorages } from '../../../api/storages';
import { formatMoney } from '../../../utils/format';

// ─── Types (kept local so this file isn't coupled to the list view's) ──────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
type ContentUnit = 'ML' | 'L' | 'G' | 'KG' | 'OZ' | 'FL_OZ';

interface SupplyDetail {
  id: string;
  name: string;
  barcode: string | null;
  base_unit: BaseUnit;
  content_per_unit: string | null;
  content_unit: ContentUnit | null;
  average_cost: string;
  last_cost: string;
  category_id: string;
  active: boolean;
  deleted_at: string | null;
  category?: { id: string; name: string } | null;
}

interface SupplyStockRow {
  id: string;
  storage_id: string;
  quantity: string;
  min_stock: string | null;
  storage?: { id: string; name: string; active: boolean } | null;
}

interface Props {
  supplyId: string;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

// ─── Data fetchers ──────────────────────────────────────────────────────────

async function fetchSupply(id: string): Promise<SupplyDetail> {
  return api.get<SupplyDetail>(`/supplies/${id}`);
}

async function fetchStocks(id: string): Promise<SupplyStockRow[]> {
  const out: SupplyStockRow[] = [];
  let cursor: string | null = null;
  do {
    const sp = new URLSearchParams();
    sp.set('limit', '100');
    if (cursor) sp.set('cursor', cursor);
    const page = await api.get<PageResult<SupplyStockRow>>(
      `/supplies/${id}/stocks?${sp.toString()}`,
    );
    out.push(...page.items);
    cursor = page.nextCursor;
    if (out.length >= 500) break;
  } while (cursor);
  return out;
}

// ─── Display helpers ────────────────────────────────────────────────────────

const UNIT_LABEL_SHORT: Record<BaseUnit, string> = {
  PIECE: 'pc',
  BOTTLE: 'btl',
  KG: 'kg',
  LITER: 'L',
  BAG: 'bag',
  BOX: 'box',
  UNIT: 'un',
};

function formatQty(value: Decimal | string | number, unit: BaseUnit): string {
  const dec = value instanceof Decimal ? value : new Decimal(value);
  return `${dec.toDecimalPlaces(2).toString()} ${UNIT_LABEL_SHORT[unit] ?? unit.toLowerCase()}`;
}

function interpolate(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => String(vars[key] ?? ''));
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyInfoView({ supplyId, onBack, onEdit, onDelete }: Props) {
  const { t } = useTranslation();

  const supplyQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'detail'],
    queryFn: () => fetchSupply(supplyId),
    staleTime: 15_000,
  });

  const stocksQuery = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'stocks'],
    queryFn: () => fetchStocks(supplyId),
    staleTime: 15_000,
  });

  const storagesQuery = useQuery({
    queryKey: ['admin', 'storages', 'active'],
    queryFn: () => listStorages({ active: true }),
    staleTime: 5 * 60_000,
  });

  const supply = supplyQuery.data;
  const stocks = stocksQuery.data ?? [];

  const storageNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of storagesQuery.data ?? []) m.set(s.id, s.name);
    return m;
  }, [storagesQuery.data]);

  const totalStock = useMemo(
    () => stocks.reduce((acc, r) => acc.add(new Decimal(r.quantity)), new Decimal(0)),
    [stocks],
  );

  const isActive = supply ? supply.active && supply.deleted_at === null : false;

  const subtitle = supply
    ? interpolate(t('admin.supplyInfo.subtitle'), {
        category: supply.category?.name ?? '—',
        unit: supply.base_unit,
      })
    : '';

  return (
    <AdminViewShell
      titleKey="admin.supplyInfo.title"
      onBack={onBack}
      headerActions={
        supply ? (
          <div style={headerActionRow}>
            <span style={subtitlePill}>{subtitle}</span>
            <span
              style={{
                ...statusBadge,
                ...(isActive ? statusBadgeOk : statusBadgeOff),
              }}
            >
              {isActive
                ? t('admin.supplyInfo.status.active')
                : t('admin.supplyInfo.status.inactive')}
            </span>
            <button type="button" onClick={onEdit} style={btnGhostSm}>
              {t('admin.supplyInfo.editAction')}
            </button>
            <button type="button" onClick={onDelete} style={btnDangerSm}>
              {t('admin.supplyInfo.deleteAction')}
            </button>
          </div>
        ) : null
      }
    >
      {supplyQuery.isLoading && (
        <div style={loaderWrap}>
          <Spinner />
        </div>
      )}

      {supplyQuery.error && (
        <p style={errorBanner}>{t('admin.supplyInfo.failed')}</p>
      )}

      {supply && (
        <div style={pageBody}>
          {/* Identity row: name + barcode */}
          <header style={identityBlock}>
            <h2 style={identityName}>{supply.name}</h2>
            <p style={identityBarcode}>
              <span style={identityBarcodeLabel}>
                {t('admin.supplyInfo.barcodeLabel')}
              </span>
              <span style={identityBarcodeValue}>
                {supply.barcode ?? t('admin.supplyInfo.noBarcode')}
              </span>
            </p>
          </header>

          {/* Stat row */}
          <div style={statRow}>
            <StatCell
              label={t('admin.supplyInfo.stat.avgCost')}
              value={formatMoney(supply.average_cost)}
            />
            <StatCell
              label={t('admin.supplyInfo.stat.lastCost')}
              value={formatMoney(supply.last_cost)}
            />
            <StatCell
              label={t('admin.supplyInfo.stat.totalStock')}
              value={
                stocksQuery.isLoading
                  ? '…'
                  : stocks.length === 0
                    ? '—'
                    : formatQty(totalStock, supply.base_unit)
              }
            />
          </div>

          {/* Stock by storage — live */}
          <Section title={t('admin.supplyInfo.section.stocks')}>
            {stocksQuery.isLoading ? (
              <div style={loaderWrap}>
                <Spinner />
              </div>
            ) : stocks.length === 0 ? (
              <p style={emptyHint}>{t('admin.supplyInfo.stockEmpty')}</p>
            ) : (
              <div style={storageList}>
                {stocks.map((s) => {
                  const qty = new Decimal(s.quantity);
                  const min = s.min_stock ? new Decimal(s.min_stock) : null;
                  const isLow = min !== null && qty.lte(min);
                  const isWarn = !isLow && min !== null && qty.lte(min.mul(1.25));
                  const color = isLow
                    ? 'var(--red)'
                    : isWarn
                      ? 'var(--gold)'
                      : 'var(--green)';
                  const storageName =
                    s.storage?.name ?? storageNameById.get(s.storage_id) ?? '—';
                  return (
                    <div key={s.id} style={storageRow}>
                      <span style={storageRowName}>
                        <span style={dot(color)} aria-hidden="true" />
                        {storageName}
                      </span>
                      <span style={storageRowQty}>
                        {formatQty(qty, supply.base_unit)}
                      </span>
                      <span style={storageRowMin}>
                        {min !== null
                          ? interpolate(t('admin.supplyInfo.minStock'), {
                              value: formatQty(min, supply.base_unit),
                            })
                          : ''}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </Section>

          <Section title={t('admin.supplyInfo.section.movements')}>
            <SupplyMovementsSection
              supplyId={supply.id}
              baseUnit={supply.base_unit}
            />
          </Section>
          <Section title={t('admin.supplyInfo.section.suppliers')}>
            <SupplySuppliersSection
              supplyId={supply.id}
              baseUnit={supply.base_unit}
            />
          </Section>
          <Section title={t('admin.supplyInfo.section.consumers')}>
            <SupplyConsumersSection supplyId={supply.id} />
          </Section>
          <Section title={t('admin.supplyInfo.section.variance')}>
            <SupplyVarianceSection
              supplyId={supply.id}
              baseUnit={supply.base_unit}
            />
          </Section>
        </div>
      )}
    </AdminViewShell>
  );
}

// ─── Subcomponents ──────────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  children: React.ReactNode;
}
function Section({ title, children }: SectionProps) {
  return (
    <section style={sectionBlock}>
      <h3 style={sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}

interface StatCellProps {
  label: string;
  value: string;
}
function StatCell({ label, value }: StatCellProps) {
  return (
    <div style={statCellStyle}>
      <span style={statLabel}>{label}</span>
      <span style={statValue}>{value}</span>
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const pageBody: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 24,
  paddingBottom: 32,
};

const headerActionRow: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
};

const subtitlePill: CSSProperties = {
  padding: '6px 12px',
  borderRadius: 999,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text2)',
  fontSize: 11,
  letterSpacing: '0.04em',
  fontWeight: 500,
};

const statusBadge: CSSProperties = {
  display: 'inline-block',
  padding: '4px 11px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
};

const statusBadgeOk: CSSProperties = {
  background: 'rgba(74,140,92,0.12)',
  color: 'var(--green)',
  border: '1px solid rgba(74,140,92,0.30)',
};

const statusBadgeOff: CSSProperties = {
  background: 'rgba(168,152,136,0.16)',
  color: 'var(--text2)',
  border: '1px solid rgba(168,152,136,0.36)',
};

const btnGhostSm: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg2)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};

const btnDangerSm: CSSProperties = {
  padding: '8px 16px',
  borderRadius: 8,
  border: '1px solid rgba(196,80,64,0.30)',
  background: 'transparent',
  color: 'var(--red)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 36,
};

const identityBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  paddingBottom: 4,
};

const identityName: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 30,
  fontWeight: 600,
  margin: 0,
  color: 'var(--text1)',
  letterSpacing: '-0.005em',
  lineHeight: 1.1,
};

const identityBarcode: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  margin: 0,
  fontSize: 11,
  color: 'var(--text3)',
};

const identityBarcodeLabel: CSSProperties = {
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  fontWeight: 700,
};

const identityBarcodeValue: CSSProperties = {
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '0.02em',
};

const statRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
  gap: 14,
  padding: '20px 24px',
  border: '1px dashed var(--border)',
  borderRadius: 14,
  background: 'rgba(201,164,92,0.05)',
};

const statCellStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  minWidth: 0,
};

const statLabel: CSSProperties = {
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
};

const statValue: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 22,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  letterSpacing: '-0.005em',
  lineHeight: 1.2,
};

const sectionBlock: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const sectionTitle: CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  margin: 0,
};

const storageList: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  overflow: 'hidden',
  background: 'var(--bg)',
};

const storageRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  alignItems: 'center',
  gap: 14,
  padding: '12px 18px',
  borderBottom: '1px solid var(--border)',
  fontSize: 13,
  background: 'var(--bg2)',
};

const storageRowName: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 10,
  color: 'var(--text1)',
  fontWeight: 500,
};

const storageRowQty: CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  color: 'var(--text1)',
  fontVariantNumeric: 'tabular-nums',
  textAlign: 'right',
};

const storageRowMin: CSSProperties = {
  fontSize: 11,
  color: 'var(--text3)',
  letterSpacing: '0.04em',
  fontVariantNumeric: 'tabular-nums',
  minWidth: 72,
  textAlign: 'right',
};

function dot(color: string): CSSProperties {
  return {
    display: 'inline-block',
    width: 9,
    height: 9,
    borderRadius: '50%',
    background: color,
  };
}

const loaderWrap: CSSProperties = {
  padding: 32,
  display: 'flex',
  justifyContent: 'center',
};

const emptyHint: CSSProperties = {
  fontSize: 12,
  color: 'var(--text3)',
  padding: '14px 16px',
  border: '1px dashed var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  margin: 0,
};

const errorBanner: CSSProperties = {
  padding: '14px 18px',
  borderRadius: 10,
  fontSize: 13,
  background: 'rgba(196,80,64,0.10)',
  color: 'var(--red)',
  border: '1px solid rgba(196,80,64,0.30)',
};

