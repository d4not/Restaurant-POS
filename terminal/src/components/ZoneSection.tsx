import { useState } from 'react';
import { OrderRow } from './OrderRow';
import { type ActiveOrder, type TakeoutChannel } from '../api/orders';
import { formatElapsed, minutesSince } from '../utils/format';
import { useTranslation } from '../i18n';

interface SubBucket {
  channel: TakeoutChannel | 'UNSPECIFIED';
  label: string;
  orders: ActiveOrder[];
}

interface Props {
  zoneName: string;
  orders: ActiveOrder[];
  // Auto-collapse when the zone has no active orders. Caller passes
  // `defaultOpen={orders.length > 0}` so empty zones open closed by default.
  defaultOpen?: boolean;
  // When passed, the section renders inner sub-headers (one per bucket) and
  // ignores `orders` for the body — used for the Takeout zone to split rows
  // by channel (Local Pickup / Local Delivery / Delivery App).
  subBuckets?: SubBucket[];
}

const styles: Record<string, React.CSSProperties> = {
  block: {
    border: '1px solid var(--border)',
    borderRadius: 12,
    overflow: 'hidden',
    background: 'var(--bg2)',
    boxShadow: 'var(--shadow-sm)',
    marginBottom: 12,
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 18px',
    cursor: 'pointer',
    background: '#ede8df',
    userSelect: 'none',
    transition: 'background 0.12s',
  },
  headerOpen: {
    background: '#e4ddd2',
  },
  left: {
    display: 'flex',
    alignItems: 'center',
    gap: 14,
  },
  name: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17,
    fontWeight: 600,
    color: 'var(--text1)',
  },
  meta: {
    fontSize: 12,
    color: 'var(--text2)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 14,
    fontVariantNumeric: 'tabular-nums',
  },
  countPill: {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '3px 10px',
    borderRadius: 999,
    background: 'rgba(201,164,92,0.16)',
    color: 'var(--gold)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  empty: {
    padding: '20px 22px',
    fontSize: 13,
    color: 'var(--text3)',
    fontStyle: 'italic',
    textAlign: 'center',
  },
  subHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 18px',
    background: 'var(--bg)',
    borderTop: '1px solid var(--border)',
    borderBottom: '1px solid var(--border)',
  },
  subLabel: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.14em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  subDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    display: 'inline-block',
  },
  subCount: {
    fontSize: 11,
    color: 'var(--text3)',
    fontVariantNumeric: 'tabular-nums',
  },
};

const CHANNEL_DOT: Record<string, string> = {
  LOCAL: 'var(--gold)',
  DELIVERY_LOCAL: 'var(--green)',
  DELIVERY_APP: 'var(--blue, #2a6ac8)',
  UNSPECIFIED: 'var(--text3)',
};

const arrowStyle = (open: boolean): React.CSSProperties => ({
  fontSize: 12,
  color: 'var(--text3)',
  transition: 'transform 0.2s',
  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
  width: 14,
  display: 'inline-flex',
  justifyContent: 'center',
});

export function ZoneSection({
  zoneName,
  orders,
  defaultOpen = true,
  subBuckets,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(defaultOpen);

  const avgWait = orders.length === 0
    ? 0
    : Math.round(
        orders.reduce((acc, o) => acc + minutesSince(o.created_at), 0) / orders.length,
      );

  return (
    <section style={styles.block}>
      <header
        style={{ ...styles.header, ...(open ? styles.headerOpen : null) }}
        onClick={() => setOpen((v) => !v)}
      >
        <div style={styles.left}>
          <span style={arrowStyle(open)}>▶</span>
          <span style={styles.name}>{zoneName}</span>
          <span style={styles.countPill}>
            {orders.length} {t('orders.zoneActive')}
          </span>
        </div>
        <div style={styles.meta}>
          <span>{t('orders.zoneAvg')} {formatElapsed(avgWait)}</span>
        </div>
      </header>

      {open && (
        <>
          {orders.length === 0 ? (
            <div style={styles.empty}>{t('orders.empty')}</div>
          ) : subBuckets && subBuckets.length > 0 ? (
            subBuckets.map((bucket) => (
              <div key={bucket.channel}>
                <div style={styles.subHeader}>
                  <span style={styles.subLabel}>
                    <span
                      style={{
                        ...styles.subDot,
                        background: CHANNEL_DOT[bucket.channel] ?? 'var(--text3)',
                      }}
                    />
                    {bucket.label}
                  </span>
                  <span style={styles.subCount}>{bucket.orders.length}</span>
                </div>
                {bucket.orders.map((order) => (
                  <OrderRow key={order.id} order={order} />
                ))}
              </div>
            ))
          ) : (
            orders.map((order) => <OrderRow key={order.id} order={order} />)
          )}
        </>
      )}
    </section>
  );
}
