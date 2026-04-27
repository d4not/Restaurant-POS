import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Table } from '../../components/ui';
import type { TableColumn, SortState } from '../../components/ui';
import { SearchInput } from '../../components/forms/SearchInput';
import { useProducts } from '../../hooks/useProducts';
import { useProductCategories } from '../../hooks/useProductCategories';
import {
  formatMoney,
  formatPct,
} from '../../utils/format';
import {
  PRODUCT_TYPES,
  type Product,
  type ProductType,
} from '../../types/menu';
import { productTypeTone } from './product-meta';
import { ProductFormModal } from './ProductFormModal';
import { useTranslation } from '../../i18n';

export function ProductsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<ProductType | ''>('');
  const [showInactive, setShowInactive] = useState(false);
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });
  const [modalOpen, setModalOpen] = useState(false);

  const categoriesQ = useProductCategories();

  const filters = useMemo(
    () => ({
      search: search || undefined,
      category_id: categoryId || undefined,
      type: typeFilter || undefined,
      active: showInactive ? undefined : true,
    }),
    [search, categoryId, typeFilter, showInactive],
  );

  const query = useProducts(filters);

  const rows = useMemo<Product[]>(
    () => query.data?.pages.flatMap((p) => p.items) ?? [],
    [query.data],
  );

  const sorted = useMemo(() => {
    const out = [...rows];
    out.sort((a, b) => {
      const mult = sort.dir === 'asc' ? 1 : -1;
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * mult;
        case 'type':
          return a.type.localeCompare(b.type) * mult;
        case 'category':
          return (a.category?.name ?? '').localeCompare(b.category?.name ?? '') * mult;
        case 'price':
          return (Number(a.sell_price ?? 0) - Number(b.sell_price ?? 0)) * mult;
        case 'food_cost':
          return (Number(a.food_cost_pct) - Number(b.food_cost_pct)) * mult;
        default:
          return 0;
      }
    });
    return out;
  }, [rows, sort]);

  // If a product has variants, the base product.sell_price is often null and
  // the displayed price becomes a range across its variants.
  const priceDisplay = (p: Product): string => {
    // PREPARATIONs have no sell_price — show recipe cost so the list still
    // communicates a meaningful number.
    if (p.type === 'PREPARATION') {
      const cost = Number(p.recipe_cost);
      return cost > 0 ? `${formatMoney(cost)} cost` : '—';
    }
    if (p.variants && p.variants.length > 0) {
      const prices = p.variants.map((v) => Number(v.sell_price));
      const min = Math.min(...prices);
      const max = Math.max(...prices);
      if (min === max) return formatMoney(min);
      return `${formatMoney(min)} – ${formatMoney(max)}`;
    }
    return p.sell_price ? formatMoney(p.sell_price) : '—';
  };

  const columns: TableColumn<Product>[] = [
    {
      key: 'name',
      header: t('products.colName'),
      sortable: true,
      width: '2fr',
      render: (p) => (
        <div className="flex gap-8" style={{ alignItems: 'center' }}>
          {p.icon_color && (
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: p.icon_color,
                flexShrink: 0,
              }}
            />
          )}
          <div>
            <div className="fw-600 fs-13">{p.name}</div>
            {p.barcode && (
              <div className="text-muted fs-11">{p.barcode}</div>
            )}
          </div>
        </div>
      ),
    },
    {
      key: 'type',
      header: t('common.type'),
      sortable: true,
      width: '130px',
      render: (p) => <Badge tone={productTypeTone(p.type)}>{p.type}</Badge>,
    },
    {
      key: 'category',
      header: t('common.category'),
      sortable: true,
      width: '1fr',
      render: (p) => (
        <span className="text-muted fs-12">{p.category?.name ?? '—'}</span>
      ),
    },
    {
      key: 'price',
      header: t('common.price'),
      sortable: true,
      width: '140px',
      render: (p) => (
        <span className="fw-600 fs-13">{priceDisplay(p)}</span>
      ),
    },
    {
      key: 'food_cost',
      header: t('products.foodCost'),
      sortable: true,
      width: '120px',
      render: (p) => {
        // Preparations don't have a sell price — food-cost % is undefined.
        if (p.type === 'PREPARATION') {
          return <span className="fs-12 text-muted">—</span>;
        }
        const pct = Number(p.food_cost_pct);
        if (!pct) return <span className="fs-12 text-muted">—</span>;
        // Industry-standard food-cost target for coffee/food is ~30%. Over
        // that we flash a warning so the margin problem is visible at-a-glance.
        const tone = pct > 35 ? 'text-red' : pct > 28 ? 'text-gold' : 'text-green';
        return <span className={`fw-600 fs-13 ${tone}`}>{formatPct(pct)}</span>;
      },
    },
    {
      key: 'status',
      header: t('common.status'),
      width: '110px',
      render: (p) =>
        p.active ? (
          <Badge tone="green">{t('common.active')}</Badge>
        ) : (
          <Badge tone="red">{t('common.inactive')}</Badge>
        ),
    },
  ];

  return (
    <>
      <div className="toolbar">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={t('products.searchPlaceholder')}
        />

        <div style={{ minWidth: 180 }}>
          <select
            className="search-box"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={categoriesQ.isLoading}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {categoriesQ.data?.items.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>

        <div style={{ minWidth: 150 }}>
          <select
            className="search-box"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as ProductType | '')}
            style={{ cursor: 'pointer' }}
          >
            <option value="">{t('common.all')}</option>
            {PRODUCT_TYPES.map((typ) => (
              <option key={typ} value={typ}>
                {typ}
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          className={`filter-pill ${showInactive ? 'active' : ''}`}
          onClick={() => setShowInactive((v) => !v)}
        >
          {showInactive ? `✓ ${t('common.inactive')}` : t('supplies.showInactive')}
        </button>

        <Button variant="primary" onClick={() => setModalOpen(true)}>
          + {t('products.newProduct')}
        </Button>
      </div>

      <Table
        columns={columns}
        rows={sorted}
        getRowKey={(p) => p.id}
        onRowClick={(p) => navigate(`/menu/products/${p.id}`)}
        sort={sort}
        onSortChange={setSort}
        isInitialLoad={query.isLoading}
        error={query.error as Error | null}
        emptyMessage={t('products.empty')}
        emptySub={t('products.subtitle')}
        emptyAction={
          <Button variant="primary" onClick={() => setModalOpen(true)}>
            + {t('products.newProduct')}
          </Button>
        }
        hasMore={!!query.hasNextPage}
        isLoadingMore={query.isFetchingNextPage}
        onLoadMore={() => query.fetchNextPage()}
      />

      <ProductFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onCreated={(p) => navigate(`/menu/products/${p.id}`)}
      />
    </>
  );
}
