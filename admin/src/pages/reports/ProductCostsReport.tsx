import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Card, KPICard, Table } from '../../components/ui';
import type { TableColumn, BadgeTone } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useProductCostsReport } from '../../hooks/useReports';
import type { ProductCostRow } from '../../api/reports';
import { formatMoney, formatNumber } from '../../utils/format';

/**
 * Flattened row — one per product (no variants) OR one per variant (the
 * product contributes its metadata only). Display logic treats them the same,
 * but variants inherit their product's category/name for readability.
 */
interface FlatRow {
  key: string;
  product_id: string;
  product_name: string;
  variant_name: string | null;
  type: 'PRODUCT' | 'DISH';
  category_name: string | null;
  sell_price: number | null;
  recipe_cost: number;
  food_cost_pct: number;
  markup: number;
  active: boolean;
}

function foodCostTone(pct: number): BadgeTone {
  if (pct < 25) return 'green';
  if (pct <= 35) return 'gold';
  return 'red';
}

function flatten(rows: ProductCostRow[]): FlatRow[] {
  const out: FlatRow[] = [];
  for (const p of rows) {
    if (p.variants.length === 0) {
      out.push({
        key: p.product_id,
        product_id: p.product_id,
        product_name: p.product_name,
        variant_name: null,
        type: p.type,
        category_name: p.category_name,
        sell_price: p.sell_price == null ? null : Number(p.sell_price),
        recipe_cost: Number(p.recipe_cost),
        food_cost_pct: Number(p.food_cost_pct),
        markup: Number(p.markup),
        active: p.active,
      });
      continue;
    }
    for (const v of p.variants) {
      out.push({
        key: `${p.product_id}:${v.variant_id}`,
        product_id: p.product_id,
        product_name: p.product_name,
        variant_name: v.variant_name,
        type: p.type,
        category_name: p.category_name,
        sell_price: Number(v.sell_price),
        recipe_cost: Number(v.recipe_cost),
        food_cost_pct: Number(v.food_cost_pct),
        markup:
          Number(v.recipe_cost) > 0
            ? Number(v.sell_price) / Number(v.recipe_cost)
            : 0,
        active: v.active,
      });
    }
  }
  return out;
}

export function ProductCostsReport() {
  const navigate = useNavigate();
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<'all' | 'good' | 'watch' | 'bad'>('all');

  const query = useProductCostsReport(activeOnly);

  const flat = useMemo<FlatRow[]>(
    () => flatten(query.data?.rows ?? []),
    [query.data],
  );

  const filtered = useMemo<FlatRow[]>(() => {
    const needle = search.trim().toLowerCase();
    return flat.filter((r) => {
      if (needle) {
        const name = [r.product_name, r.variant_name ?? '', r.category_name ?? '']
          .join(' ')
          .toLowerCase();
        if (!name.includes(needle)) return false;
      }
      switch (bucket) {
        case 'good':  return r.food_cost_pct < 25;
        case 'watch': return r.food_cost_pct >= 25 && r.food_cost_pct <= 35;
        case 'bad':   return r.food_cost_pct > 35;
        default:      return true;
      }
    });
  }, [flat, search, bucket]);

  /* ── KPIs (across the current filter) ─────────────────── */

  const counts = useMemo(() => {
    let good = 0, watch = 0, bad = 0;
    for (const r of flat) {
      if (r.food_cost_pct < 25) good++;
      else if (r.food_cost_pct <= 35) watch++;
      else bad++;
    }
    return { good, watch, bad, total: flat.length };
  }, [flat]);

  const avgFoodCost = useMemo(() => {
    if (filtered.length === 0) return 0;
    const priced = filtered.filter((r) => (r.sell_price ?? 0) > 0);
    if (priced.length === 0) return 0;
    return priced.reduce((s, r) => s + r.food_cost_pct, 0) / priced.length;
  }, [filtered]);

  /* ── Table columns ────────────────────────────────────── */

  const columns: TableColumn<FlatRow>[] = [
    {
      key: 'product',
      header: 'Product',
      width: '2fr',
      render: (r) => (
        <div>
          <div className="fw-600 fs-13">{r.product_name}</div>
          <div className="fs-11 text-muted">
            {r.category_name ?? 'Uncategorized'}
          </div>
        </div>
      ),
    },
    {
      key: 'variant',
      header: 'Variant',
      width: '1fr',
      render: (r) =>
        r.variant_name ? (
          <span className="fs-13">{r.variant_name}</span>
        ) : (
          <span className="fs-12 text-muted">—</span>
        ),
    },
    {
      key: 'type',
      header: 'Type',
      width: '100px',
      render: (r) => (
        <Badge tone={r.type === 'DISH' ? 'gold' : 'gray'}>{r.type}</Badge>
      ),
    },
    {
      key: 'cost',
      header: 'Recipe cost',
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(r.recipe_cost)}</span>
      ),
    },
    {
      key: 'price',
      header: 'Sell price',
      width: '120px',
      render: (r) =>
        r.sell_price == null ? (
          <span className="fs-12 text-muted">—</span>
        ) : (
          <span className="fw-600 fs-13">{formatMoney(r.sell_price)}</span>
        ),
    },
    {
      key: 'food_cost',
      header: 'Food cost',
      width: '130px',
      render: (r) => {
        if (!r.sell_price) return <span className="fs-12 text-muted">—</span>;
        return (
          <Badge tone={foodCostTone(r.food_cost_pct)}>
            {formatNumber(r.food_cost_pct, 1)}%
          </Badge>
        );
      },
    },
    {
      key: 'markup',
      header: 'Markup',
      width: '100px',
      render: (r) =>
        r.markup > 0 ? (
          <span className="fs-13">×{formatNumber(r.markup, 2)}</span>
        ) : (
          <span className="fs-12 text-muted">—</span>
        ),
    },
  ];

  return (
    <>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
        <KPICard
          accent
          label="Average food cost"
          value={
            avgFoodCost > 0 ? `${formatNumber(avgFoodCost, 1)}%` : '—'
          }
          sub={
            filtered.length > 0
              ? `${filtered.length} line${filtered.length === 1 ? '' : 's'} in view`
              : 'Awaiting data'
          }
        />
        <KPICard
          label="Healthy"
          value={counts.good}
          valueColor="green"
          sub="< 25% food cost"
        />
        <KPICard
          label="Watch"
          value={counts.watch}
          valueColor="gold"
          sub="25%–35% food cost"
        />
        <KPICard
          label="Over target"
          value={counts.bad}
          valueColor="red"
          sub="> 35% food cost"
        />
      </div>

      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search by product, variant, or category…"
        />

        <button
          type="button"
          className={`filter-pill ${bucket === 'all' ? 'active' : ''}`}
          onClick={() => setBucket('all')}
        >
          All
        </button>
        <button
          type="button"
          className={`filter-pill ${bucket === 'good' ? 'active' : ''}`}
          onClick={() => setBucket('good')}
        >
          Healthy
        </button>
        <button
          type="button"
          className={`filter-pill ${bucket === 'watch' ? 'active' : ''}`}
          onClick={() => setBucket('watch')}
        >
          Watch
        </button>
        <button
          type="button"
          className={`filter-pill ${bucket === 'bad' ? 'active' : ''}`}
          onClick={() => setBucket('bad')}
        >
          Over target
        </button>

        <button
          type="button"
          className={`filter-pill ${!activeOnly ? 'active' : ''}`}
          onClick={() => setActiveOnly((v) => !v)}
        >
          {activeOnly ? 'Show inactive' : '✓ Inactive visible'}
        </button>
      </div>

      <Card>
        <Table
          columns={columns}
          rows={filtered}
          getRowKey={(r) => r.key}
          onRowClick={(r) => navigate(`/menu/products/${r.product_id}`)}
          isInitialLoad={query.isLoading}
          error={query.error as Error | null}
          emptyMessage={
            search || bucket !== 'all'
              ? 'No products match this filter'
              : 'No products yet'
          }
          emptySub={
            search || bucket !== 'all'
              ? 'Try clearing filters or widening the range.'
              : 'Add products with recipes to see costs here.'
          }
        />
      </Card>
    </>
  );
}
