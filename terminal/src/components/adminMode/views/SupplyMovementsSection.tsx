// Supply Info → Movements section.
//
// Reads /api/v1/supplies/:id/movements (cursor-paginated, default 20). Renders
// the audit trail with a coloured type chip and a +/- signed quantity. Older
// pages are appended on demand via a single "Load older" button — the file
// stays scoped to one supply so background invalidation can be cheap.
//
// `quantity` is already signed in the database (e.g. TRANSFER_OUT writes a
// negative number, PURCHASE writes positive). We trust that sign for the
// colour cue rather than encoding the direction here as well.

import { type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import type { TranslationKey } from '../../../i18n/en';
import { api } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { formatMoneyPlain } from '../../../utils/format';

// ─── Types (mirroring the backend payload) ─────────────────────────────────

type StockMovementType =
  | 'PURCHASE'
  | 'SALE'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'WRITE_OFF'
  | 'ADJUSTMENT'
  | 'MANUFACTURE';

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';

interface MovementRow {
  id: string;
  type: StockMovementType;
  quantity: string;
  unit_cost: string;
  reference_type: string;
  reference_id: string;
  created_at: string;
  storage: { id: string; name: string } | null;
}

interface Props {
  supplyId: string;
  baseUnit: BaseUnit;
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

// SupplyInfoView treats this as a glance-level summary, not a full audit log.
// Cap at the last 3 entries — the deep history lives in the standalone
// Stock movements admin view.
const RECENT_LIMIT = 3;

async function fetchRecent(supplyId: string): Promise<MovementRow[]> {
  const sp = new URLSearchParams();
  sp.set('limit', String(RECENT_LIMIT));
  const page = await api.get<PageResult<MovementRow>>(
    `/supplies/${supplyId}/movements?${sp.toString()}`,
  );
  return page.items.slice(0, RECENT_LIMIT);
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

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const ms = Date.now() - date.getTime();
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d ago`;
  return date.toLocaleDateString();
}

function typeChipStyle(type: StockMovementType): CSSProperties {
  // Cool greens for inbound, warm reds for outbound, neutral for adjustments.
  switch (type) {
    case 'PURCHASE':
    case 'TRANSFER_IN':
    case 'MANUFACTURE':
      return chipInbound;
    case 'SALE':
    case 'TRANSFER_OUT':
    case 'WRITE_OFF':
      return chipOutbound;
    case 'ADJUSTMENT':
    default:
      return chipNeutral;
  }
}

function typeKey(type: StockMovementType): TranslationKey {
  return `admin.supplyInfo.movements.type.${type}` as TranslationKey;
}

function signedQty(value: string, unit: BaseUnit): { text: string; positive: boolean; zero: boolean } {
  const dec = new Decimal(value);
  const zero = dec.isZero();
  const positive = dec.gt(0);
  const abs = dec.abs().toDecimalPlaces(2).toString();
  const sign = zero ? '' : positive ? '+' : '−';
  return {
    text: `${sign}${abs} ${UNIT_LABEL_SHORT[unit] ?? unit.toLowerCase()}`,
    positive,
    zero,
  };
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyMovementsSection({ supplyId, baseUnit }: Props) {
  const { t } = useTranslation();

  const query = useQuery({
    queryKey: ['admin', 'supplies', supplyId, 'movements', 'recent'],
    queryFn: () => fetchRecent(supplyId),
    staleTime: 30_000,
  });

  const rows: MovementRow[] = query.data ?? [];

  if (query.isLoading) {
    return (
      <div style={loaderWrap}>
        <Spinner />
      </div>
    );
  }

  if (query.error) {
    return <p style={errorBanner}>{t('admin.supplyInfo.movements.failed')}</p>;
  }

  if (rows.length === 0) {
    return <p style={emptyHint}>{t('admin.supplyInfo.movements.empty')}</p>;
  }

  return (
    <div style={tableShell}>
      <div style={tableHead}>
        <span>{t('admin.supplyInfo.movements.col.when')}</span>
        <span>{t('admin.supplyInfo.movements.col.type')}</span>
        <span>{t('admin.supplyInfo.movements.col.storage')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.movements.col.quantity')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.movements.col.unitCost')}</span>
      </div>

      {rows.map((row) => {
        const qty = signedQty(row.quantity, baseUnit);
        const qtyColor = qty.zero
          ? 'var(--text2)'
          : qty.positive
            ? 'var(--green)'
            : 'var(--red)';
        return (
          <div key={row.id} style={tableRow}>
            <span style={cellWhen} title={new Date(row.created_at).toLocaleString()}>
              {formatRelativeDate(row.created_at)}
            </span>
            <span>
              <span style={{ ...chipBase, ...typeChipStyle(row.type) }}>
                {t(typeKey(row.type))}
              </span>
            </span>
            <span style={cellMuted}>{row.storage?.name ?? '—'}</span>
            <span style={{ ...cellRight, ...cellNum, color: qtyColor, fontWeight: 600 }}>
              {qty.text}
            </span>
            <span style={{ ...cellRight, ...cellNum }}>
              {formatMoneyPlain(row.unit_cost)}
            </span>
          </div>
        );
      })}

    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const COLS = 'minmax(110px, 1fr) minmax(110px, 1fr) minmax(120px, 1.2fr) 130px 120px';

const tableShell: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 14,
  padding: '10px 16px',
  fontSize: 10,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  background: 'var(--bg2)',
  borderBottom: '1px solid var(--border)',
};

const tableRow: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 14,
  alignItems: 'center',
  padding: '11px 16px',
  borderTop: '1px solid var(--border)',
  fontSize: 13,
  color: 'var(--text1)',
  minHeight: 44,
};

const cellRight: CSSProperties = {
  textAlign: 'right',
};

const cellNum: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: "'Playfair Display', serif",
  fontSize: 14,
};

const cellWhen: CSSProperties = {
  fontSize: 12,
  color: 'var(--text2)',
  letterSpacing: '0.02em',
};

const cellMuted: CSSProperties = {
  color: 'var(--text2)',
  fontSize: 13,
};

const chipBase: CSSProperties = {
  display: 'inline-block',
  padding: '3px 10px',
  borderRadius: 999,
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  border: '1px solid',
};

const chipInbound: CSSProperties = {
  background: 'rgba(74,140,92,0.10)',
  color: 'var(--green)',
  borderColor: 'rgba(74,140,92,0.30)',
};

const chipOutbound: CSSProperties = {
  background: 'rgba(196,80,64,0.08)',
  color: 'var(--red)',
  borderColor: 'rgba(196,80,64,0.28)',
};

const chipNeutral: CSSProperties = {
  background: 'rgba(168,152,136,0.14)',
  color: 'var(--text2)',
  borderColor: 'rgba(168,152,136,0.34)',
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
  margin: 0,
};

const loaderWrap: CSSProperties = {
  padding: 32,
  display: 'flex',
  justifyContent: 'center',
};
