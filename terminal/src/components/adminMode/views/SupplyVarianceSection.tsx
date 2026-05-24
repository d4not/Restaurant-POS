// Supply Info → Count variance section.
//
// Reads /api/v1/supplies/:id/count-variance (only COMPLETED checks). Renders
// each variance row with the signed difference and its cost impact so the
// operator can spot drift over time — a string of small negatives is a
// stronger signal than one outlier.
//
// Difference colour follows the sign: surplus (positive) reads gold to
// distinguish from healthy stock (green), shortage reads red. Cost impact
// uses the same red/gold split because over- and under-counts both cost
// the business something (one in shrink, the other in idle inventory).

import { useMemo, type CSSProperties } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Decimal } from 'decimal.js';
import { Spinner } from '../../Spinner';
import { useTranslation } from '../../../i18n';
import { api } from '../../../api/client';
import type { PageResult } from '../../../api/pagination';
import { formatMoney } from '../../../utils/format';

// ─── Types ──────────────────────────────────────────────────────────────────

type BaseUnit = 'PIECE' | 'BOTTLE' | 'KG' | 'LITER' | 'BAG' | 'BOX' | 'UNIT';
type InventoryCheckType = 'FULL' | 'PARTIAL';

interface VarianceRow {
  id: string;
  expected_qty: string;
  actual_qty: string;
  difference: string;
  difference_cost: string;
  check: {
    id: string;
    date: string;
    completed_at: string | null;
    type: InventoryCheckType;
    storage: { id: string; name: string };
  };
}

interface Props {
  supplyId: string;
  baseUnit: BaseUnit;
}

// ─── Data fetcher ───────────────────────────────────────────────────────────

async function fetchPage(
  supplyId: string,
  cursor: string | undefined,
): Promise<PageResult<VarianceRow>> {
  const sp = new URLSearchParams();
  sp.set('limit', '20');
  if (cursor) sp.set('cursor', cursor);
  return api.get<PageResult<VarianceRow>>(
    `/supplies/${supplyId}/count-variance?${sp.toString()}`,
  );
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

function formatQty(value: string, unit: BaseUnit): string {
  return `${new Decimal(value).toDecimalPlaces(2).toString()} ${
    UNIT_LABEL_SHORT[unit] ?? unit.toLowerCase()
  }`;
}

function signedQty(value: string, unit: BaseUnit) {
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

function signedCost(value: string) {
  const dec = new Decimal(value);
  const zero = dec.isZero();
  const positive = dec.gt(0);
  return {
    text: formatMoney(dec.abs().toDecimalPlaces(0).toNumber()),
    positive,
    zero,
  };
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

// ─── Component ──────────────────────────────────────────────────────────────

export function SupplyVarianceSection({ supplyId, baseUnit }: Props) {
  const { t } = useTranslation();

  const query = useInfiniteQuery({
    queryKey: ['admin', 'supplies', supplyId, 'variance'],
    queryFn: ({ pageParam }) => fetchPage(supplyId, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  const rows = useMemo<VarianceRow[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  if (query.isLoading) {
    return (
      <div style={loaderWrap}>
        <Spinner />
      </div>
    );
  }

  if (query.error) {
    return <p style={errorBanner}>{t('admin.supplyInfo.variance.failed')}</p>;
  }

  if (rows.length === 0) {
    return <p style={emptyHint}>{t('admin.supplyInfo.variance.empty')}</p>;
  }

  return (
    <div style={tableShell}>
      <div style={tableHead}>
        <span>{t('admin.supplyInfo.variance.col.when')}</span>
        <span>{t('admin.supplyInfo.variance.col.storage')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.variance.col.expected')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.variance.col.actual')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.variance.col.difference')}</span>
        <span style={cellRight}>{t('admin.supplyInfo.variance.col.costImpact')}</span>
      </div>

      {rows.map((row) => {
        const diff = signedQty(row.difference, baseUnit);
        const cost = signedCost(row.difference_cost);
        const diffColor = diff.zero
          ? 'var(--text2)'
          : diff.positive
            ? 'var(--gold)'
            : 'var(--red)';
        const costColor = cost.zero
          ? 'var(--text2)'
          : cost.positive
            ? 'var(--gold)'
            : 'var(--red)';
        return (
          <div key={row.id} style={tableRow}>
            <span style={cellWhen}>{formatDate(row.check.date)}</span>
            <span style={cellMuted}>{row.check.storage.name}</span>
            <span style={{ ...cellRight, ...cellNumMuted }}>
              {formatQty(row.expected_qty, baseUnit)}
            </span>
            <span style={{ ...cellRight, ...cellNum }}>
              {formatQty(row.actual_qty, baseUnit)}
            </span>
            <span
              style={{
                ...cellRight,
                ...cellNum,
                color: diffColor,
                fontWeight: 700,
              }}
            >
              {diff.text}
            </span>
            <span
              style={{
                ...cellRight,
                ...cellNum,
                color: costColor,
                fontWeight: 600,
              }}
            >
              {cost.zero ? '—' : cost.text}
            </span>
          </div>
        );
      })}

      {query.hasNextPage && (
        <div style={loadMoreWrap}>
          <button
            type="button"
            style={loadMoreBtn}
            onClick={() => query.fetchNextPage()}
            disabled={query.isFetchingNextPage}
          >
            {query.isFetchingNextPage ? (
              <Spinner size={12} />
            ) : (
              t('admin.supplyInfo.variance.loadMore')
            )}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const COLS = '110px minmax(120px, 1.2fr) 110px 110px 130px 110px';

const tableShell: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 10,
  background: 'var(--bg)',
  overflow: 'hidden',
};

const tableHead: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: COLS,
  gap: 12,
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
  gap: 12,
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

const cellNumMuted: CSSProperties = {
  ...cellNum,
  color: 'var(--text2)',
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

const loadMoreWrap: CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  padding: '12px 16px',
  borderTop: '1px solid var(--border)',
  background: 'var(--bg2)',
};

const loadMoreBtn: CSSProperties = {
  padding: '8px 18px',
  borderRadius: 8,
  border: '1px solid var(--border)',
  background: 'var(--bg)',
  color: 'var(--text1)',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
  fontFamily: 'inherit',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
};
