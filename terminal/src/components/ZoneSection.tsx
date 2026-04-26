import { useState } from 'react';
import { OrderRow } from './OrderRow';
import { type ActiveOrder } from '../api/orders';
import { formatElapsed, minutesSince } from '../utils/format';

interface Props {
  zoneName: string;
  orders: ActiveOrder[];
  // Auto-collapse when the zone has no active orders. Caller passes
  // `defaultOpen={orders.length > 0}` so empty zones open closed by default.
  defaultOpen?: boolean;
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

export function ZoneSection({ zoneName, orders, defaultOpen = true }: Props) {
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
            {orders.length} active
          </span>
        </div>
        <div style={styles.meta}>
          <span>avg {formatElapsed(avgWait)}</span>
        </div>
      </header>

      {open && (
        <>
          {orders.length === 0 ? (
            <div style={styles.empty}>No active orders in this zone.</div>
          ) : (
            orders.map((order) => <OrderRow key={order.id} order={order} />)
          )}
        </>
      )}
    </section>
  );
}
