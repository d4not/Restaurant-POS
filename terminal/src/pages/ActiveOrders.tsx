import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchActiveOrders,
  type ActiveOrder,
  type OrderType,
  type TakeoutChannel,
} from '../api/orders';
import { ApiError } from '../api/client';
import { ZoneSection } from '../components/ZoneSection';
import { MetricCard } from '../components/MetricCard';
import { Spinner } from '../components/Spinner';
import { useTranslation } from '../i18n';
import type { TranslationKey } from '../i18n/en';

const TAKEOUT_KEY = '__takeout__';
// Channel sub-buckets render inside the Takeout zone section, not as their own
// top-level zones. Order matters for the visual rhythm — pickup first (most
// common), then own delivery, then 3rd-party apps.
const TAKEOUT_CHANNEL_ORDER: TakeoutChannel[] = [
  'LOCAL',
  'DELIVERY_LOCAL',
  'DELIVERY_APP',
];

const TAKEOUT_CHANNEL_LABEL_KEY: Record<TakeoutChannel, TranslationKey> = {
  LOCAL: 'takeout.channelLocal',
  DELIVERY_LOCAL: 'takeout.channelDeliveryLocal',
  DELIVERY_APP: 'takeout.channelDeliveryApp',
};

type FilterValue = 'ALL' | OrderType;

const FILTERS: { value: FilterValue; labelKey: TranslationKey }[] = [
  { value: 'ALL', labelKey: 'orders.filterAll' },
  { value: 'DINE_IN', labelKey: 'orders.filterDineIn' },
  { value: 'TAKEOUT', labelKey: 'orders.filterTakeout' },
];

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    flex: 1,
    minHeight: 0,
    background: 'var(--bg)',
  },
  head: {
    padding: '22px 32px 14px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 24,
    flexWrap: 'wrap',
  },
  titleBlock: { minWidth: 0 },
  title: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 28,
    fontWeight: 600,
    margin: 0,
    color: 'var(--text1)',
  },
  sub: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 4,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  pulseDot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: 'var(--green)',
    display: 'inline-block',
  },
  toolbar: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    flexWrap: 'wrap',
  },
  search: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '8px 14px',
    minWidth: 240,
    minHeight: 38,
  },
  searchInput: {
    border: 'none',
    outline: 'none',
    background: 'transparent',
    flex: 1,
    fontSize: 13,
    color: 'var(--text1)',
    fontFamily: 'inherit',
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '20px 32px 32px',
  },
  metrics: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 14,
    marginBottom: 22,
  },
  loadingState: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 80,
    gap: 14,
    color: 'var(--text2)',
  },
  errorState: {
    background: 'rgba(196,80,64,0.08)',
    border: '1px solid rgba(196,80,64,0.25)',
    color: 'var(--red)',
    borderRadius: 10,
    padding: '20px 24px',
    fontSize: 13,
    textAlign: 'center',
  },
  empty: {
    padding: 60,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 14,
  },
  footer: {
    flexShrink: 0,
    borderTop: '1px solid var(--border)',
    background: 'var(--bg2)',
    padding: '14px 32px',
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    alignItems: 'center',
    fontSize: 12,
    color: 'var(--text2)',
  },
  footerCell: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  footerNum: {
    fontFamily: "'Playfair Display', serif",
    fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    fontSize: 14,
  },
};

const pillStyle = (active: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 999,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  minHeight: 36,
  fontFamily: 'inherit',
  transition: 'all 0.12s',
});

// A sub-bucket inside the Takeout zone — one per channel. Channels with no
// active orders are dropped entirely so the section header doesn't show three
// "0 active" stripes when only one channel is in use.
export interface TakeoutSubBucket {
  channel: TakeoutChannel | 'UNSPECIFIED';
  label: string;
  orders: ActiveOrder[];
}

interface ZoneBucket {
  key: string;
  name: string;
  orders: ActiveOrder[];
  // Used to sort: dine-in zones first (preserved order), Takeout always last.
  sort: number;
  // Only populated for the Takeout bucket — drives the in-section sub-headers.
  subBuckets?: TakeoutSubBucket[];
}

function buildTakeoutSubBuckets(
  orders: ActiveOrder[],
  channelLabel: (ch: TakeoutChannel) => string,
  otherLabel: string,
): TakeoutSubBucket[] {
  const byChannel = new Map<TakeoutChannel | 'UNSPECIFIED', ActiveOrder[]>();
  for (const o of orders) {
    const ch = o.takeout_channel ?? 'UNSPECIFIED';
    const arr = byChannel.get(ch) ?? [];
    arr.push(o);
    byChannel.set(ch, arr);
  }
  const buckets: TakeoutSubBucket[] = [];
  for (const ch of TAKEOUT_CHANNEL_ORDER) {
    const list = byChannel.get(ch);
    if (list && list.length > 0) {
      buckets.push({ channel: ch, label: channelLabel(ch), orders: list });
    }
  }
  // Legacy / mid-flight rows without a channel still need a home — render them
  // under a generic "Other" sub-header so they don't silently disappear.
  const legacy = byChannel.get('UNSPECIFIED');
  if (legacy && legacy.length > 0) {
    buckets.push({ channel: 'UNSPECIFIED', label: otherLabel, orders: legacy });
  }
  return buckets;
}

function bucketByZone(
  orders: ActiveOrder[],
  takeoutLabel: string,
  channelLabel: (ch: TakeoutChannel) => string,
  otherLabel: string,
): ZoneBucket[] {
  const map = new Map<string, ZoneBucket>();
  let counter = 0;
  for (const o of orders) {
    const isTakeout = o.order_type === 'TAKEOUT' || !o.table;
    const key = isTakeout ? TAKEOUT_KEY : o.table!.zone.id;
    const name = isTakeout ? takeoutLabel : o.table!.zone.name;
    let bucket = map.get(key);
    if (!bucket) {
      bucket = {
        key,
        name,
        orders: [],
        sort: isTakeout ? Number.MAX_SAFE_INTEGER : counter++,
      };
      map.set(key, bucket);
    }
    bucket.orders.push(o);
  }
  const out = [...map.values()].sort((a, b) => a.sort - b.sort);
  const takeout = out.find((b) => b.key === TAKEOUT_KEY);
  if (takeout) takeout.subBuckets = buildTakeoutSubBuckets(takeout.orders, channelLabel, otherLabel);
  return out;
}

function filterOrders(orders: ActiveOrder[], filter: FilterValue, search: string): ActiveOrder[] {
  const tokens = search.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return orders.filter((o) => {
    if (filter !== 'ALL' && o.order_type !== filter) return false;
    if (tokens.length === 0) return true;

    // Per-item match: every token must appear in the same line's
    // product + variant + modifiers + notes text. This is what makes
    // "latte mediano leche entera" actually find lattes-medium-with-whole-milk
    // rather than any order that happens to contain those words scattered.
    for (const item of o.items) {
      if (item.voided_at) continue;
      const itemText = [
        item.product.name,
        item.variant?.name ?? '',
        ...item.modifiers.map((m) => m.name),
        item.notes ?? '',
      ]
        .join(' ')
        .toLowerCase();
      if (tokens.every((tok) => itemText.includes(tok))) return true;
    }

    // Fallback: order-level fields. Lets "table 5" / waiter name / order #
    // keep working with the same input box.
    const orderText = [
      String(o.order_number),
      o.user.name,
      o.table?.zone.name ?? '',
      o.table ? `table ${o.table.number}` : '',
      o.customer_name ?? '',
      o.notes ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return tokens.every((tok) => orderText.includes(tok));
  });
}

export function ActiveOrders() {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<FilterValue>('ALL');
  const [search, setSearch] = useState('');

  const { data, isLoading, error, isFetching, dataUpdatedAt } = useQuery({
    queryKey: ['orders', 'active'],
    queryFn: fetchActiveOrders,
    // Live polling while the cashier is on this view. 10s matches the spec;
    // we leave staleTime at 5s so background refetches don't churn.
    refetchInterval: 10_000,
    refetchIntervalInBackground: false,
  });

  const orders = data ?? [];
  const visible = useMemo(() => filterOrders(orders, filter, search), [orders, filter, search]);
  const buckets = useMemo(
    () =>
      bucketByZone(
        visible,
        t('orders.takeoutZone'),
        (ch) => t(TAKEOUT_CHANNEL_LABEL_KEY[ch]),
        t('orders.takeoutOther'),
      ),
    [visible, t],
  );

  const summary = useMemo(() => {
    const total = orders.length;
    const attention = orders.filter((o) => o.needs_attention).length;
    const pendingPayment = orders.filter((o) => o.items.length > 0 && o.payments.length === 0).length;
    return { total, attention, pendingPayment };
  }, [orders]);

  return (
    <div style={styles.root}>
      <header style={styles.head}>
        <div style={styles.titleBlock}>
          <h1 style={styles.title}>{t('orders.title')}</h1>
          <div style={styles.sub}>
            <span style={styles.pulseDot} />
            {t('orders.realtimeOverview')}
            {isFetching && (
              <span style={{ marginLeft: 8 }}>
                <Spinner size={12} />
              </span>
            )}
            {dataUpdatedAt > 0 && !isFetching && (
              <span style={{ marginLeft: 8, color: 'var(--text3)' }}>
                · {t('orders.updated')} {new Date(dataUpdatedAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
        <div style={styles.toolbar}>
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              style={pillStyle(filter === f.value)}
              onClick={() => setFilter(f.value)}
            >
              {t(f.labelKey)}
            </button>
          ))}
          <div style={styles.search}>
            <span style={{ color: 'var(--text3)', fontSize: 13 }}>⌕</span>
            <input
              style={styles.searchInput}
              placeholder={t('orders.searchActive')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </header>

      <div style={styles.body}>
        <div style={styles.metrics}>
          <MetricCard
            label={t('orders.metricActive')}
            value={summary.total.toString()}
            hint={
              filter !== 'ALL'
                ? `${visible.length} ${t('orders.matchFilter')}`
                : undefined
            }
          />
          <MetricCard
            label={t('orders.metricNeedsAttention')}
            value={summary.attention.toString()}
            tone={summary.attention > 0 ? 'red' : 'default'}
            hint={summary.attention > 0 ? t('orders.waitersFlagged') : undefined}
          />
        </div>

        {isLoading && (
          <div style={styles.loadingState}>
            <Spinner size={26} />
            <div>{t('orders.loadingActive')}</div>
          </div>
        )}

        {error && (
          <div style={styles.errorState}>
            {error instanceof ApiError ? error.message : t('orders.failedLoad')}
          </div>
        )}

        {!isLoading && !error && buckets.length === 0 && (
          <div style={styles.empty}>
            {orders.length === 0
              ? t('orders.noActiveNow')
              : t('orders.noneMatchFilter')}
          </div>
        )}

        {buckets.map((bucket) => (
          <ZoneSection
            key={bucket.key}
            zoneName={bucket.name}
            orders={bucket.orders}
            subBuckets={bucket.subBuckets}
            defaultOpen={bucket.orders.length > 0}
          />
        ))}
      </div>

      <footer style={styles.footer}>
        <div style={styles.footerCell}>
          <span style={styles.footerNum}>{summary.total}</span>
          <span>{t('orders.activeShort')}</span>
        </div>
        <div style={{ ...styles.footerCell, justifyContent: 'center' }}>
          <span style={styles.footerNum}>{summary.pendingPayment}</span>
          <span>{t('orders.pendingPayment')}</span>
        </div>
        <div style={{ ...styles.footerCell, justifyContent: 'flex-end' }} />
      </footer>
    </div>
  );
}
