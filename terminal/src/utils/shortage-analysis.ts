/**
 * Mirror of `src/lib/shortage-analysis.ts` for the terminal renderer. Pure
 * function — kept here (rather than imported from the backend tree) so the
 * terminal vite project has zero cross-folder imports. Keep in sync with the
 * backend copy; the canonical unit-test suite lives at
 * `tests/lib/shortage-analysis.test.ts`.
 *
 * The renderer uses this synchronously during cash counting so hints update
 * as the cashier hits the +/- steppers. Server-side, the backend uses the
 * same logic to seed notification payloads.
 */

import { getTerminalDenominations } from './cashCount';

export type ShortageSign = 'short' | 'over';
export type ShortageSeverity = 'info' | 'warning' | 'error';

export type ShortageHintCode =
  | 'BALANCED'
  | 'SINGLE_DENOMINATION_MISMATCH'
  | 'COMBINATION'
  | 'ABOVE_NOTIFY_THRESHOLD'
  | 'ABOVE_BLOCKING_THRESHOLD'
  | 'MATCHES_NOTHING_OBVIOUS';

export interface DenominationPart {
  denomCentavos: number;
  count: number;
}

export interface ShortageHint {
  code: ShortageHintCode;
  severity: ShortageSeverity;
  sign?: ShortageSign;
  amountCentavos?: number;
  parts?: DenominationPart[];
}

export interface AnalyzeShortageInput {
  diffCentavos: number;
  currency: string;
  notifyThreshold?: number;
  blockingThreshold?: number;
  singleMatchMaxCount?: number;
  singleMatchLimit?: number;
}

const DEFAULT_NOTIFY_THRESHOLD = 5000;
const DEFAULT_SINGLE_MATCH_MAX_COUNT = 50;
const DEFAULT_SINGLE_MATCH_LIMIT = 3;

export function analyzeShortage(input: AnalyzeShortageInput): ShortageHint[] {
  const diff = input.diffCentavos | 0;

  if (diff === 0) {
    return [{ code: 'BALANCED', severity: 'info' }];
  }

  const sign: ShortageSign = diff < 0 ? 'short' : 'over';
  const abs = Math.abs(diff);
  const denoms = getTerminalDenominations(input.currency);

  const maxCount = input.singleMatchMaxCount ?? DEFAULT_SINGLE_MATCH_MAX_COUNT;
  const matchLimit = input.singleMatchLimit ?? DEFAULT_SINGLE_MATCH_LIMIT;
  const notifyThreshold = input.notifyThreshold ?? DEFAULT_NOTIFY_THRESHOLD;
  const blockingThreshold = input.blockingThreshold;

  const hints: ShortageHint[] = [];

  const singles = denoms
    .filter((d) => d > 0 && abs % d === 0)
    .map((d) => ({ denom: d, count: abs / d }))
    .filter(({ count }) => count > 0 && count <= maxCount)
    .sort((a, b) => a.count - b.count)
    .slice(0, matchLimit);

  for (const { denom, count } of singles) {
    hints.push({
      code: 'SINGLE_DENOMINATION_MISMATCH',
      severity: 'warning',
      sign,
      amountCentavos: abs,
      parts: [{ denomCentavos: denom, count }],
    });
  }

  if (singles.length === 0) {
    const combo = greedyCombo(abs, denoms);
    if (combo.length > 0) {
      hints.push({
        code: 'COMBINATION',
        severity: 'warning',
        sign,
        amountCentavos: abs,
        parts: combo,
      });
    } else {
      hints.push({
        code: 'MATCHES_NOTHING_OBVIOUS',
        severity: 'warning',
        sign,
        amountCentavos: abs,
      });
    }
  }

  if (abs >= notifyThreshold) {
    hints.push({
      code: 'ABOVE_NOTIFY_THRESHOLD',
      severity: 'error',
      sign,
      amountCentavos: abs,
    });
  }
  if (blockingThreshold !== undefined && abs >= blockingThreshold) {
    hints.push({
      code: 'ABOVE_BLOCKING_THRESHOLD',
      severity: 'error',
      sign,
      amountCentavos: abs,
    });
  }

  return hints;
}

function greedyCombo(
  amount: number,
  denoms: number[],
): DenominationPart[] {
  const sorted = [...denoms].sort((a, b) => b - a);
  const parts: DenominationPart[] = [];
  let rem = amount;
  for (const d of sorted) {
    if (d <= 0) continue;
    if (rem >= d) {
      const count = Math.floor(rem / d);
      parts.push({ denomCentavos: d, count });
      rem -= count * d;
    }
    if (rem === 0) break;
  }
  return rem === 0 ? parts : [];
}
