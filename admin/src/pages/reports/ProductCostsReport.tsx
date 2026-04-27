import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge, Button, Card, EmptyState, KPICard, Table } from '../../components/ui';
import type { TableColumn, BadgeTone } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import {
  useProductAnalysis,
  useProductCostsReport,
} from '../../hooks/useReports';
import type { ProductCostRow } from '../../api/reports';
import { formatMoney, formatNumber } from '../../utils/format';
import { daysAgoYMD, toIsoDayEnd, toIsoDayStart, todayYMD } from './date-range';
import { useTranslation } from '../../i18n';

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
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [activeOnly, setActiveOnly] = useState(true);
  const [search, setSearch] = useState('');
  const [bucket, setBucket] = useState<'all' | 'good' | 'watch' | 'bad'>('all');
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

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
      header: t('productCosts.colProduct'),
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
      header: t('products.tabVariants'),
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
      header: t('common.type'),
      width: '100px',
      render: (r) => (
        <Badge tone={r.type === 'DISH' ? 'gold' : 'gray'}>{r.type}</Badge>
      ),
    },
    {
      key: 'cost',
      header: t('productCosts.colRecipeCost'),
      width: '120px',
      render: (r) => (
        <span className="fs-13">{formatMoney(r.recipe_cost)}</span>
      ),
    },
    {
      key: 'price',
      header: t('productCosts.colSellPrice'),
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
      header: t('productCosts.colFoodCostPct'),
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
      header: t('productCosts.colMargin'),
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
          onRowClick={(r) => setExpandedKey((cur) => (cur === r.key ? null : r.key))}
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

      {expandedKey && (() => {
        const row = filtered.find((r) => r.key === expandedKey);
        if (!row) return null;
        return (
          <ProductAnalysisPanel
            key={row.product_id}
            productId={row.product_id}
            productName={row.product_name}
            recipeCost={row.recipe_cost}
            onClose={() => setExpandedKey(null)}
            onOpenProduct={() => navigate(`/menu/products/${row.product_id}`)}
          />
        );
      })()}
    </>
  );
}

/* ──────────────── Product analysis panel ──────────────── */

interface AnalysisPanelProps {
  productId: string;
  productName: string;
  recipeCost: number;
  onClose: () => void;
  onOpenProduct: () => void;
}

function ProductAnalysisPanel({
  productId,
  productName,
  recipeCost,
  onClose,
  onOpenProduct,
}: AnalysisPanelProps) {
  const [fromYMD, setFromYMD] = useState(() => daysAgoYMD(30));
  const [toYMD, setToYMD] = useState(() => todayYMD());

  const from = toIsoDayStart(fromYMD) ?? '';
  const to = toIsoDayEnd(toYMD) ?? '';

  const q = useProductAnalysis({ product_id: productId, from, to });

  const modifierData = useMemo(
    () =>
      (q.data?.modifier_usage ?? [])
        .slice(0, 5)
        .map((m) => ({ label: m.modifier_name, value: m.times_used })),
    [q.data],
  );

  const variantData = useMemo(
    () =>
      (q.data?.variant_sales ?? []).map((v) => ({
        label: v.variant_name,
        value: Number(v.total_revenue),
      })),
    [q.data],
  );

  const ingredientsCost = useMemo(() => {
    return (q.data?.ingredients_used ?? []).reduce(
      (s, r) => s + Number(r.total_cost),
      0,
    );
  }, [q.data]);

  const modifierRevenue = useMemo(() => {
    return (q.data?.modifier_usage ?? []).reduce(
      (s, r) => s + Number(r.extra_revenue),
      0,
    );
  }, [q.data]);

  const totalRevenue = useMemo(() => {
    return (q.data?.variant_sales ?? []).reduce(
      (s, r) => s + Number(r.total_revenue),
      0,
    );
  }, [q.data]);

  return (
    <Card
      className="mt-16"
      title={
        <>
          Analysis · <span className="text-muted fw-600">{productName}</span>
        </>
      }
      actions={
        <div className="flex gap-8">
          <Button variant="ghost" size="sm" onClick={onOpenProduct}>
            Open product
          </Button>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ✕ Close
          </Button>
        </div>
      }
    >
      <div className="toolbar" style={{ marginTop: 0, marginBottom: 12 }}>
        <div className="field" style={{ margin: 0 }}>
          <label className="fs-11" style={{ marginBottom: 4 }}>From</label>
          <input
            type="date"
            value={fromYMD}
            onChange={(e) => setFromYMD(e.target.value)}
          />
        </div>
        <div className="field" style={{ margin: 0 }}>
          <label className="fs-11" style={{ marginBottom: 4 }}>To</label>
          <input
            type="date"
            value={toYMD}
            onChange={(e) => setToYMD(e.target.value)}
          />
        </div>
      </div>

      {q.isLoading ? (
        <div className="loading-block">
          <span className="spinner" />
          Loading…
        </div>
      ) : q.error ? (
        <EmptyState icon="⚠" message="Couldn't load analysis" sub={(q.error as Error).message} />
      ) : (
        <>
          {/* Cost breakdown KPIs */}
          <div className="kpi-grid mb-16" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <KPICard
              accent
              label="Revenue"
              value={formatMoney(totalRevenue)}
              sub={`${q.data?.variant_sales.length ?? 0} variant(s) sold`}
            />
            <KPICard
              label="Modifier revenue"
              value={formatMoney(modifierRevenue)}
              sub="extra charges"
            />
            <KPICard
              label="Recipe cost"
              value={formatMoney(recipeCost)}
              sub="cached per unit"
            />
            <KPICard
              label="Ingredients used"
              value={formatMoney(ingredientsCost)}
              valueColor={ingredientsCost > totalRevenue ? 'red' : undefined}
              sub="from SALE movements"
            />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <div>
              <div className="fs-12 fw-600 text-muted mb-8">
                Variant sales (revenue)
              </div>
              {variantData.length === 0 ? (
                <EmptyState message="No sales in this window" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={variantData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="var(--text3)"
                      tick={{ fontSize: 11, fill: 'var(--text2)' }}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--text3)"
                      tick={{ fontSize: 11, fill: 'var(--text2)' }}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                      tickFormatter={(v) => formatMoney(Number(v))}
                      width={90}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--gold-bg)' }}
                      contentStyle={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border2)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--text)',
                      }}
                      formatter={(v) => [formatMoney(Number(v)), 'Revenue']}
                    />
                    <Bar dataKey="value" fill="var(--gold)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div>
              <div className="fs-12 fw-600 text-muted mb-8">
                Top modifiers (times used)
              </div>
              {modifierData.length === 0 ? (
                <EmptyState message="No modifiers used" />
              ) : (
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart
                    data={modifierData}
                    margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                    <XAxis
                      dataKey="label"
                      stroke="var(--text3)"
                      tick={{ fontSize: 11, fill: 'var(--text2)' }}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                    />
                    <YAxis
                      stroke="var(--text3)"
                      tick={{ fontSize: 11, fill: 'var(--text2)' }}
                      axisLine={{ stroke: 'var(--border)' }}
                      tickLine={false}
                      width={40}
                    />
                    <Tooltip
                      cursor={{ fill: 'var(--gold-bg)' }}
                      contentStyle={{
                        background: 'var(--surface)',
                        border: '1px solid var(--border2)',
                        borderRadius: 6,
                        fontSize: 12,
                        color: 'var(--text)',
                      }}
                    />
                    <Bar dataKey="value" fill="var(--green)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Ingredients used detail */}
          {q.data && q.data.ingredients_used.length > 0 && (
            <div className="mt-16">
              <div className="fs-12 fw-600 text-muted mb-8">
                Ingredients deducted ({q.data.ingredients_used.length})
              </div>
              <div className="table-wrap">
                <div
                  className="table-head"
                  style={{ gridTemplateColumns: '2fr 140px 140px 140px' }}
                >
                  <div>Supply</div>
                  <div style={{ textAlign: 'right' }}>Quantity</div>
                  <div style={{ textAlign: 'right' }}>Unit</div>
                  <div style={{ textAlign: 'right' }}>Total cost</div>
                </div>
                {q.data.ingredients_used.map((ing, i) => (
                  <div
                    key={ing.supply_id}
                    className={`table-row ${i % 2 === 0 ? 'even' : 'odd'}`}
                    style={{
                      gridTemplateColumns: '2fr 140px 140px 140px',
                      cursor: 'default',
                    }}
                  >
                    <div className="fw-600 fs-13">{ing.supply_name}</div>
                    <div className="fs-13" style={{ textAlign: 'right' }}>
                      {formatNumber(ing.total_quantity, 4)}
                    </div>
                    <div className="fs-12 text-muted" style={{ textAlign: 'right' }}>
                      {ing.unit.toLowerCase()}
                    </div>
                    <div className="fw-600 fs-13" style={{ textAlign: 'right' }}>
                      {formatMoney(ing.total_cost)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
