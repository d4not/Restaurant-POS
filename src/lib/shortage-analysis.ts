/**
 * Shortage / surplus analyzer for the cash-counting flow. Given a difference
 * between counted cash and expected cash, suggest which denominations are
 * most likely the culprit.
 *
 * Returns translation-ready hint codes — the UI is responsible for converting
 * `code` + `params` into a human-readable string in the active language. This
 * keeps the helper pure (no `t()` lookups, no React deps) so it stays trivial
 * to unit test and can also be reused server-side from notifications/reports.
 *
 * Heuristics (in order):
 *   1. BALANCED                       — diff is zero.
 *   2. SINGLE_DENOMINATION_MISMATCH   — |diff| is an exact multiple of a single
 *                                       denomination N×D, where N ≤ 50.
 *                                       Top 3 matches, fewest pieces first.
 *   3. COMBINATION                    — no clean single match: greedy
 *                                       largest-first decomposition. Useful for
 *                                       awkward diffs like $97 (= 1×50 + 2×20
 *                                       + 1×5 + 1×2).
 *   4. ABOVE_NOTIFY_THRESHOLD         — |diff| ≥ `notifyThreshold` ⇒ tell the
 *                                       UI to surface a "call your manager"
 *                                       CTA. Stacks with the denomination
 *                                       hints — they don't suppress each other.
 *   5. ABOVE_BLOCKING_THRESHOLD       — |diff| ≥ `blockingThreshold` ⇒ the
 *                                       cashier should not close on their own.
 *   6. MATCHES_NOTHING_OBVIOUS        — fallback when greedy can't decompose
 *                                       (shouldn't happen with the default
 *                                       denomination tables, but documents the
 *                                       contract).
 */

import { getDenominations } from './denominations.js';

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
  // sign is undefined only for BALANCED — every other hint references a
  // non-zero diff. Carry the absolute amount on the hint itself so renderers
  // don't have to thread the original diff through alongside.
  sign?: ShortageSign;
  amountCentavos?: number;
  // Set on SINGLE_DENOMINATION_MISMATCH (1 entry) and COMBINATION (n entries).
  parts?: DenominationPart[];
}

export interface AnalyzeShortageInput {
  diffCentavos: number;
  currency: string;
  notifyThreshold?: number;
  blockingThreshold?: number;
  // Caps the single-denomination heuristic. Counting "the diff is 97 ×
  // $1 coins" is technically correct but useless — at that point you may as
  // well recount the whole drawer. Default 50.
  singleMatchMaxCount?: number;
  // Top-N single-denomination matches to return. Default 3 — past that the
  // suggestions get too noisy to act on.
  singleMatchLimit?: number;
}

const DEFAULT_NOTIFY_THRESHOLD = 5000; // $50.00 in MXN/USD centavos
const DEFAULT_SINGLE_MATCH_MAX_COUNT = 50;
const DEFAULT_SINGLE_MATCH_LIMIT = 3;

export function analyzeShortage(input: AnalyzeShortageInput): ShortageHint[] {
  const diff = input.diffCentavos | 0;

  if (diff === 0) {
    return [{ code: 'BALANCED', severity: 'info' }];
  }

  const sign: ShortageSign = diff < 0 ? 'short' : 'over';
  const abs = Math.abs(diff);
  const denoms = getDenominations(input.currency);

  const maxCount = input.singleMatchMaxCount ?? DEFAULT_SINGLE_MATCH_MAX_COUNT;
  const matchLimit = input.singleMatchLimit ?? DEFAULT_SINGLE_MATCH_LIMIT;
  const notifyThreshold = input.notifyThreshold ?? DEFAULT_NOTIFY_THRESHOLD;
  const blockingThreshold = input.blockingThreshold;

  const hints: ShortageHint[] = [];

  // Single-denomination matches — fewest pieces first.
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

  // Combination fallback — only run when there's no clean single match. The
  // greedy decomposition is "what's the simplest way someone could have
  // miscounted this much?", not the canonical change-making problem.
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

  // Escalation hints stack on top of the denomination hints — the UI can show
  // a yellow "revisa los billetes de $100" row and a red "avisa al gerente"
  // banner at the same time.
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
