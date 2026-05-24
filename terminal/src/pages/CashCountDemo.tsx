/**
 * Standalone demo page for the cash-count flow built in Track A. Exported
 * but NOT routed by `App.tsx` (App.tsx is in the parallel-agent zone). To
 * preview during development, mount this manually from a scratch route or
 * import it into a Storybook-like sandbox.
 *
 * Use case: lets Daniel + reviewers see CashCounter + ShortageAnalyzer
 * working against fake data — switch MXN/USD, dial the "expected" up and
 * down, watch the heuristic land on the right hint. No backend round-trips.
 */

import { useMemo, useState } from 'react';
import { CashCounter, ShortageAnalyzer } from '../components/cash-count';
import { useCashCounter } from '../hooks/useCashCounter';
import {
  breakdownToCentavos,
  formatCurrencyAmount,
} from '../utils/cashCount';
import { analyzeShortage } from '../utils/shortage-analysis';

const wrap: React.CSSProperties = {
  minHeight: '100vh',
  background: 'var(--bg)',
  display: 'grid',
  gridTemplateColumns: '420px minmax(0, 1fr) 360px',
  gap: 20,
  padding: 20,
};

const controlsCard: React.CSSProperties = {
  background: 'var(--bg2)',
  border: '1px solid var(--border)',
  borderRadius: 14,
  padding: 18,
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  alignSelf: 'start',
};

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  color: 'var(--text3)',
  fontWeight: 700,
  marginBottom: 6,
};

const input: React.CSSProperties = {
  width: '100%',
  height: 40,
  padding: '0 10px',
  border: '1px solid var(--border)',
  borderRadius: 8,
  fontSize: 14,
  fontFamily: 'inherit',
  color: 'var(--text1)',
  background: 'var(--bg)',
};

const radioGroup: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const radioBtn = (active: boolean): React.CSSProperties => ({
  flex: 1,
  height: 40,
  borderRadius: 8,
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
  background: active ? 'var(--text1)' : 'var(--bg)',
  color: active ? '#fff' : 'var(--text1)',
  fontFamily: 'inherit',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
});

const summary: React.CSSProperties = {
  background: 'var(--bg)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 13,
  color: 'var(--text2)',
  fontVariantNumeric: 'tabular-nums',
};

export function CashCountDemo() {
  const [currency, setCurrency] = useState<'MXN' | 'USD'>('MXN');
  const [blind, setBlind] = useState(false);
  const [hideSubunits, setHideSubunits] = useState(true);
  const [expectedPesos, setExpectedPesos] = useState('1234.50');
  const [notifyPesos, setNotifyPesos] = useState('50.00');
  const [blockingPesos, setBlockingPesos] = useState('500.00');

  const counter = useCashCounter({ currency, hideSubunits });

  const expectedCentavos = useMemo(() => {
    const n = Number(expectedPesos);
    return Number.isFinite(n) ? Math.round(n * 100) : 0;
  }, [expectedPesos]);
  const notifyThreshold = useMemo(() => {
    const n = Number(notifyPesos);
    return Number.isFinite(n) ? Math.round(n * 100) : 5000;
  }, [notifyPesos]);
  const blockingThreshold = useMemo(() => {
    const n = Number(blockingPesos);
    return Number.isFinite(n) ? Math.round(n * 100) : undefined;
  }, [blockingPesos]);

  const total = breakdownToCentavos(counter.breakdown);
  const diff = total - expectedCentavos;

  const hints = useMemo(
    () =>
      analyzeShortage({
        diffCentavos: diff,
        currency,
        notifyThreshold,
        blockingThreshold,
      }),
    [diff, currency, notifyThreshold, blockingThreshold],
  );

  return (
    <div style={wrap}>
      <aside style={controlsCard}>
        <h2
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 20,
            margin: 0,
            color: 'var(--text1)',
          }}
        >
          Demo controls
        </h2>

        <div>
          <span style={label}>Currency</span>
          <div style={radioGroup}>
            <button
              type="button"
              style={radioBtn(currency === 'MXN')}
              onClick={() => setCurrency('MXN')}
            >
              MXN
            </button>
            <button
              type="button"
              style={radioBtn(currency === 'USD')}
              onClick={() => setCurrency('USD')}
            >
              USD
            </button>
          </div>
        </div>

        <div>
          <span style={label}>Display mode</span>
          <div style={radioGroup}>
            <button
              type="button"
              style={radioBtn(!blind)}
              onClick={() => setBlind(false)}
            >
              Standard
            </button>
            <button
              type="button"
              style={radioBtn(blind)}
              onClick={() => setBlind(true)}
            >
              Blind
            </button>
          </div>
        </div>

        <div>
          <span style={label}>Sub-unit coins</span>
          <div style={radioGroup}>
            <button
              type="button"
              style={radioBtn(hideSubunits)}
              onClick={() => setHideSubunits(true)}
            >
              Hide
            </button>
            <button
              type="button"
              style={radioBtn(!hideSubunits)}
              onClick={() => setHideSubunits(false)}
            >
              Show
            </button>
          </div>
        </div>

        <div>
          <span style={label}>Expected total ({currency})</span>
          <input
            type="text"
            inputMode="decimal"
            style={input}
            value={expectedPesos}
            onChange={(e) => setExpectedPesos(e.target.value)}
          />
        </div>

        <div>
          <span style={label}>Notify threshold ({currency})</span>
          <input
            type="text"
            inputMode="decimal"
            style={input}
            value={notifyPesos}
            onChange={(e) => setNotifyPesos(e.target.value)}
          />
        </div>

        <div>
          <span style={label}>Blocking threshold ({currency})</span>
          <input
            type="text"
            inputMode="decimal"
            style={input}
            value={blockingPesos}
            onChange={(e) => setBlockingPesos(e.target.value)}
          />
        </div>

        <button
          type="button"
          style={radioBtn(false)}
          onClick={() => counter.suggestFromTotal(expectedCentavos)}
        >
          Pre-fill from expected
        </button>
        <button type="button" style={radioBtn(false)} onClick={counter.reset}>
          Reset count
        </button>

        <div style={summary}>
          <span>
            <strong>Total counted:</strong> {formatCurrencyAmount(total, currency)}
          </span>
          <span>
            <strong>Expected:</strong>{' '}
            {formatCurrencyAmount(expectedCentavos, currency)}
          </span>
          <span>
            <strong>Difference:</strong>{' '}
            {formatCurrencyAmount(diff, currency)}
          </span>
        </div>
      </aside>

      <div style={{ minHeight: 0 }}>
        <CashCounter
          currency={currency}
          value={counter.breakdown}
          onChange={counter.applyBreakdown}
          blind={blind}
          expected={expectedCentavos}
          hideSubunits={hideSubunits}
        />
      </div>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2
          style={{
            fontFamily: "'Playfair Display', serif",
            fontSize: 18,
            margin: 0,
            color: 'var(--text1)',
          }}
        >
          Shortage analyzer
        </h2>
        <ShortageAnalyzer
          hints={hints}
          currency={currency}
          onNotifyManager={() => console.log('notify dispatched')}
        />
      </aside>
    </div>
  );
}
