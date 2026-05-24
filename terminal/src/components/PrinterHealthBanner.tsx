// Topbar banner shown when the Electron printer monitor detects an actionable
// problem. Click → opens the auto-setup panel as a portal modal. Renders
// nothing when healthy / monitor unavailable, so the topbar isn't crowded for
// the common case where everything is wired up correctly.
//
// Strings are English-hardcoded — i18n is heavily edited in a parallel branch
// (terminal/src/i18n/{en,es}.ts), so the keys land later as part of the merge.

import { useState } from 'react';
import { usePrinterHealth } from '../hooks/usePrinterHealth';
import { PrinterAutoSetupPanel } from './operations-hub/PrinterAutoSetupPanel';

const styles: Record<string, React.CSSProperties> = {
  banner: {
    background: '#c45040',
    color: '#fff',
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.02em',
    textAlign: 'center',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    borderBottom: '1px solid rgba(0,0,0,0.12)',
    cursor: 'pointer',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#fff',
    opacity: 0.9,
    flexShrink: 0,
  },
  message: {
    display: 'inline-block',
    maxWidth: 720,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  cta: {
    background: 'rgba(255,255,255,0.18)',
    border: '1px solid rgba(255,255,255,0.35)',
    color: '#fff',
    padding: '4px 10px',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
};

const ROLE_LABEL: Record<PrinterRole, string> = {
  receipt: 'Receipt',
  kitchen: 'Kitchen',
};

const ROOT_CAUSE_LABEL: Record<PrinterRecommendation, string> = {
  'investigate-current': 'unhealthy',
  'switch-primary': 'unreachable',
  'permission-issue': 'permission denied',
  'pick-primary': 'not configured',
  'no-printer-available': 'no printer detected',
  'use-current': 'ok',
};

function summarise(issues: Extract<ReturnType<typeof usePrinterHealth>, { kind: 'unhealthy' }>['issues']) {
  if (issues.length === 1) {
    const i = issues[0];
    return `${ROLE_LABEL[i.role]} printer ${ROOT_CAUSE_LABEL[i.recommendation]}${
      i.primaryLabel ? ` — switch to ${i.primaryLabel}?` : ''
    }`;
  }
  const roles = issues.map((i) => ROLE_LABEL[i.role]).join(' + ');
  return `${roles} printers need attention`;
}

export function PrinterHealthBanner() {
  const health = usePrinterHealth();
  const [panelOpen, setPanelOpen] = useState(false);

  if (health.kind !== 'unhealthy') return null;
  return (
    <>
      <div
        style={styles.banner}
        role="alert"
        aria-live="polite"
        onClick={() => setPanelOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setPanelOpen(true);
          }
        }}
        tabIndex={0}
      >
        <span style={styles.dot} />
        <span style={styles.message}>{summarise(health.issues)}</span>
        <span style={styles.cta}>Fix</span>
      </div>
      <PrinterAutoSetupPanel open={panelOpen} onClose={() => setPanelOpen(false)} />
    </>
  );
}
