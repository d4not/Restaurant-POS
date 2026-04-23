import { useMemo, useState } from 'react';
import type { Product, ProductCategory } from '../../types/api';
import { formatMoney } from '../../utils/format';

interface Props {
  products: Product[];
  categories: ProductCategory[];
  onPickProduct: (product: Product) => void;
}

// Normalise the search query for matching. Lowercase + trim so the matcher
// below doesn't have to repeat the work for every product.
function normalise(s: string): string {
  return s.toLowerCase().trim();
}

// Build a category lookup so we can group products in one pass instead of
// n-squared filtering for each tab.
function bucketByCategory(products: Product[]): Map<string | null, Product[]> {
  const map = new Map<string | null, Product[]>();
  for (const p of products) {
    const key = p.category_id ?? null;
    const bucket = map.get(key) ?? [];
    bucket.push(p);
    map.set(key, bucket);
  }
  return map;
}

export function ProductGrid({ products, categories, onPickProduct }: Props) {
  const [categoryId, setCategoryId] = useState<string | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const sellable = useMemo(
    () =>
      products.filter((p) => p.type !== 'PREPARATION' && p.active),
    [products],
  );

  const bucket = useMemo(() => bucketByCategory(sellable), [sellable]);

  // Pare the tabs down to categories that actually have sellable products —
  // empty categories in the admin database shouldn't add noise to the POS.
  const visibleCategories = useMemo(
    () =>
      categories
        .filter(
          (c) =>
            c.visible_in_pos &&
            (bucket.get(c.id)?.length ?? 0) > 0,
        )
        .sort((a, b) => a.display_order - b.display_order),
    [categories, bucket],
  );

  const needle = normalise(search);
  const displayed = useMemo(() => {
    let list = sellable;
    if (categoryId !== 'ALL') list = bucket.get(categoryId) ?? [];
    if (needle) {
      list = list.filter((p) => normalise(p.name).includes(needle));
    }
    return [...list].sort((a, b) => {
      if (a.display_order !== b.display_order) return a.display_order - b.display_order;
      return a.name.localeCompare(b.name);
    });
  }, [sellable, bucket, categoryId, needle]);

  return (
    <>
      <div className="product-toolbar">
        <input
          className="search-field"
          placeholder="Search products…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <div className="cat-pills">
          <button
            type="button"
            className={`cat-pill ${categoryId === 'ALL' ? 'active' : ''}`}
            onClick={() => setCategoryId('ALL')}
          >
            All
          </button>
          {visibleCategories.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`cat-pill ${categoryId === c.id ? 'active' : ''}`}
              onClick={() => setCategoryId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>

      <div className="product-grid">
        {displayed.length === 0 && (
          <div className="empty" style={{ gridColumn: '1 / -1' }}>
            <div className="icon">🔍</div>
            <div className="title">No products match</div>
          </div>
        )}
        {displayed.map((product) => (
          <button
            key={product.id}
            type="button"
            className="product-card"
            onClick={() => onPickProduct(product)}
          >
            <div className="swatch" style={{ background: product.icon_color ?? 'var(--gold)' }} />
            <div className="name">{product.name}</div>
            <PriceLabel product={product} />
          </button>
        ))}
      </div>
    </>
  );
}

function PriceLabel({ product }: { product: Product }) {
  // Products with variants (sizes) don't have a top-level sell_price, show a
  // range. Packaged products + DISHes without variants use their own price.
  const activeVariants = product.variants.filter((v) => v.active);
  if (activeVariants.length > 0) {
    const prices = activeVariants.map((v) => Number(v.sell_price)).sort((a, b) => a - b);
    const lo = prices[0];
    const hi = prices[prices.length - 1];
    if (lo === hi) return <div className="price">{formatMoney(lo)}</div>;
    return (
      <div className="price-range">
        {formatMoney(lo)} – {formatMoney(hi)}
      </div>
    );
  }
  return <div className="price">{formatMoney(product.sell_price)}</div>;
}
