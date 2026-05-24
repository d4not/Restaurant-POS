/**
 * Renders the output of `analyzeShortage` as a stack of actionable cards.
 * Each hint becomes one card; severity drives the colour (info=green,
 * warning=gold, error=red). The "notify manager" hint also wires a callback
 * the parent can use to dispatch a notification.
 *
 * Stateless and prop-driven on purpose: the analyzer lives in
 * `terminal/src/utils/shortage-analysis.ts` (mirrors `src/lib/`), this just
 * paints the result. That keeps the rendering decoupled from the heuristics
 * so a future tweak to the heuristics needs no UI work.
 */

import { useCashCountT } from './i18n';
import { formatCurrencyAmount } from '../../utils/cashCount';
import type { ShortageHint } from '../../utils/shortage-analysis';

export interface ShortageAnalyzerProps {
  hints: ShortageHint[];
  currency: string;
  onNotifyManager?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

const list: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const cardBase: React.CSSProperties = {
  borderRadius: 12,
  padding: '14px 16px',
  border: '1px solid',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const severityStyle: Record<string, React.CSSProperties> = {
  info: {
    background: 'rgba(74,140,92,0.08)',
    borderColor: 'rgba(74,140,92,0.3)',
    color: 'var(--green)',
  },
  warning: {
    background: 'rgba(201,164,92,0.10)',
    borderColor: 'rgba(201,164,92,0.4)',
    color: '#7a5c3a',
  },
  error: {
    background: 'rgba(196,80,64,0.08)',
    borderColor: 'rgba(196,80,64,0.4)',
    color: 'var(--red)',
  },
};

const titleStyle: React.CSSProperties = {
  fontFamily: "'Playfair Display', serif",
  fontSize: 15,
  fontWeight: 600,
  margin: 0,
};

const detailStyle: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--text2)',
  margin: 0,
  lineHeight: 1.45,
};

const notifyButton: React.CSSProperties = {
  alignSelf: 'flex-start',
  marginTop: 8,
  padding: '10px 16px',
  borderRadius: 10,
  background: 'var(--red)',
  color: '#fff',
  fontSize: 13,
  fontWeight: 600,
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'inherit',
  minHeight: 40,
};

function summariseParts(
  parts: { denomCentavos: number; count: number }[] | undefined,
  currency: string,
): string {
  if (!parts || parts.length === 0) return '';
  return parts
    .map((p) => `${p.count}×${formatCurrencyAmount(p.denomCentavos, currency)}`)
    .join(' + ');
}

export function ShortageAnalyzer(props: ShortageAnalyzerProps) {
  const { hints, currency, onNotifyManager, className, style } = props;
  const t = useCashCountT();

  if (hints.length === 0) return null;

  return (
    <div className={className} style={{ ...list, ...style }}>
      {hints.map((h, idx) => {
        const sev = severityStyle[h.severity] ?? severityStyle.warning!;
        return (
          <div key={`${h.code}-${idx}`} style={{ ...cardBase, ...sev }}>
            <h4 style={titleStyle}>{renderTitle(h, currency, t)}</h4>
            <p style={detailStyle}>{renderDetail(h, currency, t)}</p>
            {h.code === 'ABOVE_NOTIFY_THRESHOLD' && onNotifyManager && (
              <button type="button" style={notifyButton} onClick={onNotifyManager}>
                {t('cashCount.notify')}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function renderTitle(
  hint: ShortageHint,
  currency: string,
  t: ReturnType<typeof useCashCountT>,
): string {
  switch (hint.code) {
    case 'BALANCED':
      return t('cashCount.hint.balanced.title');
    case 'SINGLE_DENOMINATION_MISMATCH': {
      const part = hint.parts?.[0];
      if (!part) return '';
      const denom = formatCurrencyAmount(part.denomCentavos, currency);
      return hint.sign === 'over'
        ? t('cashCount.hint.singleOver.title', { count: part.count, denom })
        : t('cashCount.hint.singleShort.title', { count: part.count, denom });
    }
    case 'COMBINATION':
      return t('cashCount.hint.combo.title');
    case 'ABOVE_NOTIFY_THRESHOLD':
      return t('cashCount.hint.notify.title');
    case 'ABOVE_BLOCKING_THRESHOLD':
      return t('cashCount.hint.blocking.title');
    case 'MATCHES_NOTHING_OBVIOUS':
      return t('cashCount.hint.unknown.title');
    default:
      return hint.code;
  }
}

function renderDetail(
  hint: ShortageHint,
  currency: string,
  t: ReturnType<typeof useCashCountT>,
): string {
  switch (hint.code) {
    case 'BALANCED':
      return t('cashCount.hint.balanced.detail');
    case 'SINGLE_DENOMINATION_MISMATCH':
      return t('cashCount.hint.single.detail');
    case 'COMBINATION':
      return t('cashCount.hint.combo.detail', {
        summary: summariseParts(hint.parts, currency),
      });
    case 'ABOVE_NOTIFY_THRESHOLD':
      return t('cashCount.hint.notify.detail', {
        amount: formatCurrencyAmount(hint.amountCentavos ?? 0, currency),
      });
    case 'ABOVE_BLOCKING_THRESHOLD':
      return t('cashCount.hint.blocking.detail', {
        amount: formatCurrencyAmount(hint.amountCentavos ?? 0, currency),
      });
    case 'MATCHES_NOTHING_OBVIOUS':
      return t('cashCount.hint.unknown.detail', {
        amount: formatCurrencyAmount(hint.amountCentavos ?? 0, currency),
      });
    default:
      return '';
  }
}
