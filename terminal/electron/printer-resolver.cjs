// Printer auto-resolver. Pure logic — no I/O, no Electron, no global state.
//
// Takes the current saved roleConfig plus a freshly-detected printer list and
// returns a plan: did the config still match a real device? If not, which
// candidate should we use, with which ranked alternates as fallbacks?
//
// The plan is consumed by three callers in this app:
//
//   • Auto-pick on first setup — Settings shows a banner suggesting `primary`
//     when no config exists yet and at least one candidate is ready.
//
//   • Auto-fix on print failure — printer.cjs wraps execute() so that when a
//     send fails with NOT_CONFIGURED / UNREACHABLE / ENOENT we retry against
//     `alternatives` before surfacing the error to the renderer.
//
//   • One-click remedy in the hub — PrinterCheckPanel renders `alternatives`
//     as actionable rows the operator can apply.
//
// Single source of truth keeps these three surfaces in agreement.

// Status base score. Higher = more usable right now. A permission-denied
// device CAN be used after the operator fixes the udev/group setup, so it
// still ranks above a stopped device but well below "ready".
const STATUS_SCORES = {
  ready: 100,
  busy: 60,
  unknown: 40,
  attention: 20,
  stopped: 0,
  permission_denied: -50,
};

function statusScore(status) {
  if (typeof status !== 'string') return 0;
  const base = STATUS_SCORES[status];
  return typeof base === 'number' ? base : 0;
}

// Compare a detected candidate against a saved config's address. We try two
// match flavours:
//   • exact      — address string matches verbatim. The strongest signal.
//   • by-name    — saved address is "printer:NAME" and candidate exposes the
//                  same name (or close to it). Handles the Windows case where
//                  the OS reassigned the USBxxx port but kept the printer name.
//   • by-path    — saved address is a raw device path and candidate's address
//                  is the same path. Handles /dev/usb/lp0 swaps on Linux.
function addressMatches(address, candidate) {
  if (!address || !candidate || !candidate.address) return false;
  if (address === candidate.address) return true;
  if (address.startsWith('printer:') && candidate.address.startsWith('printer:')) {
    return address.slice('printer:'.length).toLowerCase() ===
      candidate.address.slice('printer:'.length).toLowerCase();
  }
  return false;
}

// Score a single candidate against the saved/last-working context.
// Returns { score, reasons[] } so the UI can explain *why* this row is on top.
function scoreCandidate(candidate, context) {
  const reasons = [];
  let score = 0;

  const base = statusScore(candidate.status);
  score += base;
  if (base > 0) reasons.push(`status:${candidate.status}`);
  if (base < 0) reasons.push(`status:${candidate.status}(blocked)`);

  if (candidate.kind === 'device') {
    score += 30;
    reasons.push('direct-device');
  } else if (candidate.kind === 'system') {
    score += 10;
  }

  if (candidate.isUsb) {
    score += 50;
    reasons.push('usb');
  }

  if (candidate.isDefault) {
    score += 20;
    reasons.push('os-default');
  }

  if (candidate.canWrite === false) {
    score -= 30;
    reasons.push('no-write-permission');
  }

  // Sticky preference for the last successfully-printing target, then a
  // weaker preference for whatever address the user previously saved (even if
  // it failed — same physical device is the most likely fix).
  if (context.lastWorking && addressMatches(context.lastWorking, candidate)) {
    score += 200;
    reasons.push('last-working');
  } else if (context.currentAddress && addressMatches(context.currentAddress, candidate)) {
    score += 100;
    reasons.push('matches-saved-address');
  }

  return { candidate, score, reasons };
}

function findCurrentMatch(currentAddress, candidates) {
  if (!currentAddress) return null;
  for (const c of candidates) {
    if (addressMatches(currentAddress, c)) return c;
  }
  return null;
}

// Build the plan. `detected` is the result of usb-discovery.listDetectedPrinters
// (an object with `.printers`) — we accept either the wrapper or a bare array
// so callers don't have to peel the wrapper.
function resolvePlan({ currentConfig, detected, lastWorking }) {
  const candidates = Array.isArray(detected)
    ? detected
    : Array.isArray(detected?.printers)
      ? detected.printers
      : [];
  const currentAddress = currentConfig?.address?.trim() || null;
  const context = {
    currentAddress,
    lastWorking: lastWorking || null,
  };

  const scored = candidates
    .map((c) => scoreCandidate(c, context))
    .sort((a, b) => b.score - a.score);

  const currentMatch = findCurrentMatch(currentAddress, candidates);

  // When the saved printer is detected but unhealthy, the "primary" the UI
  // should suggest is the best working replacement — not the broken printer
  // itself. We compute this by stripping the currentMatch from the ranking
  // before reading the top entry.
  const currentNeedsReplacement = currentMatch && currentMatch.status !== 'ready';
  const rankingForPrimary = currentNeedsReplacement
    ? scored.filter((s) => s.candidate !== currentMatch)
    : scored;
  const primary = rankingForPrimary[0]?.candidate ?? null;
  const alternatives = rankingForPrimary
    .slice(1)
    .map((s) => s.candidate);
  const topRankedScore = scored[0]?.score ?? 0;

  let recommendation;
  let reasoning;
  if (candidates.length === 0) {
    recommendation = 'no-printer-available';
    reasoning = currentAddress
      ? `No printers detected. Saved address ${currentAddress} is unreachable.`
      : 'No printers detected and no address saved yet.';
  } else if (currentMatch && currentMatch.status === 'ready') {
    recommendation = 'use-current';
    reasoning = `Saved printer "${currentMatch.label}" is detected and ready.`;
  } else if (currentNeedsReplacement) {
    recommendation = 'investigate-current';
    reasoning = `Saved printer "${currentMatch.label}" is detected but its status is "${currentMatch.status}". ` +
      `Consider switching to "${primary?.label ?? 'a working printer'}" until it recovers.`;
  } else if (primary && topRankedScore < 50) {
    recommendation = 'permission-issue';
    reasoning = `Detected printers all have problems (status / permissions). ` +
      `Top candidate "${primary.label}" needs operator attention before it will print.`;
  } else if (currentAddress && !currentMatch) {
    recommendation = 'switch-primary';
    reasoning = `Saved address ${currentAddress} no longer matches any detected printer. ` +
      `Suggested replacement: "${primary?.label ?? 'unknown'}".`;
  } else {
    recommendation = 'pick-primary';
    reasoning = `No printer configured yet. Suggested: "${primary?.label ?? 'unknown'}".`;
  }

  return {
    currentAddress,
    currentMatch,
    recommendation,
    primary,
    alternatives,
    scoredCandidates: scored,
    reasoning,
  };
}

// Decide what to do when the saved printer config has just failed to print.
// Wraps resolvePlan with the policy on when to auto-retry and when to persist.
//
// Returns:
//   { action: 'no-fallback', plan }                        — nothing to try
//   { action: 'try-fallback', fallbackConfig,              — retry with this,
//     persistOnSuccess, plan }                               persist if true
//
// Policy:
//   • switch-primary    → retry + persist (the saved printer is gone, the user
//                         clearly meant "the printer in front of me" and we
//                         have a better address now).
//   • investigate-current → retry but don't persist (printer still detected,
//                         operator may want to recover the original — making
//                         the swap permanent without their consent surprises
//                         them).
//   • everything else   → no-fallback (no actionable candidate, no point in
//                         retrying since the result will be the same).
function planAutoFix({ currentConfig, detected, lastWorking }) {
  const plan = resolvePlan({ currentConfig, detected, lastWorking });
  const candidate = plan.primary;
  const sameAddress = candidate && candidate.address === currentConfig?.address;
  if (!candidate || sameAddress) {
    return { action: 'no-fallback', plan };
  }
  if (plan.recommendation === 'switch-primary') {
    return {
      action: 'try-fallback',
      fallbackConfig: {
        ...currentConfig,
        address: candidate.address,
        connection: 'usb',
        enabled: true,
      },
      persistOnSuccess: true,
      plan,
    };
  }
  if (plan.recommendation === 'investigate-current') {
    return {
      action: 'try-fallback',
      fallbackConfig: {
        ...currentConfig,
        address: candidate.address,
        connection: 'usb',
        enabled: true,
      },
      persistOnSuccess: false,
      plan,
    };
  }
  return { action: 'no-fallback', plan };
}

module.exports = {
  STATUS_SCORES,
  statusScore,
  addressMatches,
  scoreCandidate,
  findCurrentMatch,
  resolvePlan,
  planAutoFix,
};
