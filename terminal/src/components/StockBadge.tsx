import type { AvailabilityStatus } from '../api/stock';

interface StockBadgeProps {
  status: AvailabilityStatus;
  size?: 'sm' | 'md';
}

/**
 * Compact corner badge for low/out states. Renders `!` in gold for low, `✕`
 * in red for out, nothing for available/unknown. Position is the parent's
 * responsibility (use `position: relative` on the card and wrap this in an
 * absolutely-positioned span).
 */
export function StockBadge({ status, size = 'sm' }: StockBadgeProps) {
  if (status === 'available') return null;

  const dim = size === 'md' ? 26 : 20;
  const fontSize = size === 'md' ? 14 : 12;
  const isOut = status === 'out' || status === 'unknown';
  const bg = isOut ? 'var(--red, #c45040)' : 'var(--gold, #c9a45c)';
  const glyph = isOut ? '✕' : '!';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: dim,
        height: dim,
        borderRadius: '50%',
        background: bg,
        color: '#fff',
        fontSize,
        fontWeight: 700,
        lineHeight: 1,
        boxShadow: '0 1px 2px rgba(44,36,32,0.18)',
      }}
    >
      {glyph}
    </span>
  );
}
