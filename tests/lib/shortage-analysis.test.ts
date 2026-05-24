import { describe, it, expect } from 'vitest';
import { analyzeShortage } from '../../src/lib/shortage-analysis.js';

describe('analyzeShortage — BALANCED', () => {
  it('returns BALANCED when diff is zero', () => {
    const hints = analyzeShortage({ diffCentavos: 0, currency: 'MXN' });
    expect(hints).toEqual([{ code: 'BALANCED', severity: 'info' }]);
  });

  it('treats non-integer zero (e.g. -0) as zero', () => {
    const hints = analyzeShortage({ diffCentavos: -0, currency: 'MXN' });
    expect(hints[0]?.code).toBe('BALANCED');
  });
});

describe('analyzeShortage — single-denomination match (MXN)', () => {
  it('flags a $100 shortage as 1 × $100 bill (single match)', () => {
    const hints = analyzeShortage({ diffCentavos: -10_000, currency: 'MXN' });
    const single = hints.find((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(single).toBeTruthy();
    expect(single?.sign).toBe('short');
    expect(single?.amountCentavos).toBe(10_000);
    expect(single?.parts).toEqual([{ denomCentavos: 10_000, count: 1 }]);
  });

  it('flags a $200 surplus as 1 × $200 bill (single match)', () => {
    const hints = analyzeShortage({ diffCentavos: 20_000, currency: 'MXN' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBeGreaterThanOrEqual(1);
    expect(singles[0]?.sign).toBe('over');
    expect(singles[0]?.parts).toEqual([{ denomCentavos: 20_000, count: 1 }]);
  });

  it('orders matches by fewest pieces first (top 3)', () => {
    // $200 = 1×$200 = 2×$100 = 4×$50 = 10×$20 = ...
    const hints = analyzeShortage({ diffCentavos: -20_000, currency: 'MXN' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBe(3);
    expect(singles[0]?.parts?.[0]?.count).toBe(1);  // 1×$200
    expect(singles[1]?.parts?.[0]?.count).toBe(2);  // 2×$100
    expect(singles[2]?.parts?.[0]?.count).toBe(4);  // 4×$50
  });

  it('caps single matches when count would exceed singleMatchMaxCount', () => {
    // $1 diff. With the default 50 cap, only $1, $2, $0.50 (centavos: 100, 200, 50)
    // would qualify — but 1×$1 fits, 0.5×$2 doesn't divide, 2×$0.50 fits.
    const hints = analyzeShortage({ diffCentavos: -100, currency: 'MXN' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    // Should at least include 1×$1 (count=1) and 2×$0.50 (count=2)
    expect(singles.map((s) => s.parts?.[0]?.count)).toEqual(
      expect.arrayContaining([1, 2]),
    );
  });
});

describe('analyzeShortage — single-denomination match (USD)', () => {
  it('flags a $20 shortage in USD', () => {
    const hints = analyzeShortage({ diffCentavos: -2_000, currency: 'USD' });
    const single = hints.find((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(single?.parts).toEqual([{ denomCentavos: 2_000, count: 1 }]);
  });

  it('flags a $50 surplus as 1 × $50 bill in USD', () => {
    const hints = analyzeShortage({ diffCentavos: 5_000, currency: 'USD' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles[0]?.parts).toEqual([{ denomCentavos: 5_000, count: 1 }]);
  });
});

describe('analyzeShortage — COMBINATION fallback', () => {
  it('decomposes $97 (no single match in MXN) greedily', () => {
    // 9700 centavos = 1×$50 + 2×$20 + 1×$5 + 1×$2 = 5000 + 4000 + 500 + 200
    const hints = analyzeShortage({ diffCentavos: -9_700, currency: 'MXN' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBe(0);
    const combo = hints.find((h) => h.code === 'COMBINATION');
    expect(combo?.sign).toBe('short');
    expect(combo?.parts).toEqual([
      { denomCentavos: 5_000, count: 1 },
      { denomCentavos: 2_000, count: 2 },
      { denomCentavos: 500, count: 1 },
      { denomCentavos: 200, count: 1 },
    ]);
    const total = combo!.parts!.reduce((s, p) => s + p.denomCentavos * p.count, 0);
    expect(total).toBe(9_700);
  });

  it('decomposes $102 as 1×$100 + 1×$2', () => {
    const hints = analyzeShortage({ diffCentavos: 10_200, currency: 'MXN' });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBe(0);
    const combo = hints.find((h) => h.code === 'COMBINATION');
    expect(combo?.parts).toEqual([
      { denomCentavos: 10_000, count: 1 },
      { denomCentavos: 200, count: 1 },
    ]);
  });

  it('decomposes $1234 greedily (no single match)', () => {
    // 123400 = 1×$1000 + 1×$200 + 0×$100 + 0×$50 + 1×$20 + 1×$10 + 0×$5 + 2×$2
    // = 100000 + 20000 + 2000 + 1000 + 400
    const hints = analyzeShortage({ diffCentavos: -123_400, currency: 'MXN' });
    const combo = hints.find((h) => h.code === 'COMBINATION');
    expect(combo).toBeTruthy();
    const total = combo!.parts!.reduce((s, p) => s + p.denomCentavos * p.count, 0);
    expect(total).toBe(123_400);
  });
});

describe('analyzeShortage — escalation thresholds', () => {
  it('stacks ABOVE_NOTIFY_THRESHOLD on top of denomination hints', () => {
    const hints = analyzeShortage({
      diffCentavos: -50_000,
      currency: 'MXN',
      notifyThreshold: 5_000,
    });
    expect(hints.map((h) => h.code)).toEqual(
      expect.arrayContaining([
        'SINGLE_DENOMINATION_MISMATCH',
        'ABOVE_NOTIFY_THRESHOLD',
      ]),
    );
    const notify = hints.find((h) => h.code === 'ABOVE_NOTIFY_THRESHOLD');
    expect(notify?.severity).toBe('error');
  });

  it('omits ABOVE_NOTIFY_THRESHOLD when below threshold', () => {
    const hints = analyzeShortage({
      diffCentavos: -2_000, // $20 shortage
      currency: 'MXN',
      notifyThreshold: 5_000, // $50
    });
    expect(hints.some((h) => h.code === 'ABOVE_NOTIFY_THRESHOLD')).toBe(false);
  });

  it('adds ABOVE_BLOCKING_THRESHOLD only when configured', () => {
    const noBlocking = analyzeShortage({
      diffCentavos: -100_000,
      currency: 'MXN',
      notifyThreshold: 5_000,
    });
    expect(noBlocking.some((h) => h.code === 'ABOVE_BLOCKING_THRESHOLD')).toBe(false);

    const withBlocking = analyzeShortage({
      diffCentavos: -100_000,
      currency: 'MXN',
      notifyThreshold: 5_000,
      blockingThreshold: 50_000, // $500
    });
    expect(withBlocking.some((h) => h.code === 'ABOVE_BLOCKING_THRESHOLD')).toBe(true);
  });

  it('uses the default notify threshold ($50) when none provided', () => {
    const big = analyzeShortage({ diffCentavos: -10_000, currency: 'MXN' });
    expect(big.some((h) => h.code === 'ABOVE_NOTIFY_THRESHOLD')).toBe(true);

    const small = analyzeShortage({ diffCentavos: -2_000, currency: 'MXN' });
    expect(small.some((h) => h.code === 'ABOVE_NOTIFY_THRESHOLD')).toBe(false);
  });
});

describe('analyzeShortage — sign + edge cases', () => {
  it('treats negative diff as short, positive as over', () => {
    expect(analyzeShortage({ diffCentavos: -10_000, currency: 'MXN' })[0]?.sign).toBe(
      'short',
    );
    expect(analyzeShortage({ diffCentavos: 10_000, currency: 'MXN' })[0]?.sign).toBe(
      'over',
    );
  });

  it('falls back to MXN denominations for an unknown currency', () => {
    const hints = analyzeShortage({ diffCentavos: -10_000, currency: 'EUR' });
    const single = hints.find((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(single?.parts).toEqual([{ denomCentavos: 10_000, count: 1 }]);
  });

  it('handles large surpluses (no infinite loop)', () => {
    const hints = analyzeShortage({ diffCentavos: 1_000_000, currency: 'MXN' });
    expect(hints.length).toBeGreaterThan(0);
    // 1,000,000 centavos = 10,000 / 1,000 = 10 × $1,000 bills
    const single = hints.find((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(single?.parts).toEqual([{ denomCentavos: 100_000, count: 10 }]);
  });

  it('respects singleMatchLimit when caller wants fewer suggestions', () => {
    const hints = analyzeShortage({
      diffCentavos: -20_000,
      currency: 'MXN',
      singleMatchLimit: 1,
    });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBe(1);
    expect(singles[0]?.parts?.[0]?.count).toBe(1); // 1×$200 still wins
  });

  it('respects singleMatchMaxCount when caller wants stricter cap', () => {
    // diff = $1, $1 coin → count = 1. $0.50 coin → count = 2. If cap is 1,
    // only the $1 match should appear.
    const hints = analyzeShortage({
      diffCentavos: -100,
      currency: 'MXN',
      singleMatchMaxCount: 1,
    });
    const singles = hints.filter((h) => h.code === 'SINGLE_DENOMINATION_MISMATCH');
    expect(singles.length).toBe(1);
    expect(singles[0]?.parts?.[0]?.count).toBe(1);
  });
});
