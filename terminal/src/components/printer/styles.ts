import type React from 'react';

// ─── Shared constants ────────────────────────────────────────────────────────

export const PRINTER_TYPES = ['epson', 'star', 'tanca', 'daruma', 'brother', 'custom'] as const;

export const CHARACTER_SETS = [
  'PC850_MULTILINGUAL',
  'PC437_USA',
  'PC858_EURO',
  'WPC1252',
  'ISO8859_15_LATIN9',
  'PC860_PORTUGUESE',
  'PC852_LATIN2',
] as const;

export const RECOMMENDATION_PRESETS: Record<
  PrinterRecommendation,
  { label: string; color: string; bg: string }
> = {
  'use-current': { label: 'Ready', color: 'var(--green)', bg: 'rgba(74,140,92,0.12)' },
  'investigate-current': { label: 'Action needed', color: 'var(--red)', bg: 'rgba(196,80,64,0.10)' },
  'switch-primary': { label: 'Switch recommended', color: 'var(--gold)', bg: 'rgba(201,164,92,0.15)' },
  'pick-primary': { label: 'Setup available', color: 'var(--gold)', bg: 'rgba(201,164,92,0.15)' },
  'permission-issue': { label: 'Blocked', color: 'var(--red)', bg: 'rgba(196,80,64,0.10)' },
  'no-printer-available': { label: 'None detected', color: 'var(--text3)', bg: 'rgba(168,152,136,0.12)' },
};

export const STATUS_COLOR: Record<DetectedPrinterStatus, string> = {
  ready: 'var(--green)',
  busy: 'var(--gold)',
  stopped: 'var(--red)',
  attention: 'var(--gold)',
  permission_denied: 'var(--red)',
  unknown: 'var(--text3)',
};

// ─── Style helpers ───────────────────────────────────────────────────────────

export const statusPillStyle = (ok: boolean | null): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  background: ok === null ? 'var(--bg2)' : ok ? 'rgba(74,140,92,0.16)' : 'rgba(196,80,64,0.14)',
  color: ok === null ? 'var(--text3)' : ok ? 'var(--green)' : 'var(--red)',
  border: '1px solid ' + (ok === null ? 'var(--border)' : 'transparent'),
});

export const statusDotStyle = (ok: boolean | null): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: ok === null ? 'var(--text3)' : ok ? 'var(--green)' : 'var(--red)',
});

export const resultBannerStyle = (ok: boolean): React.CSSProperties => ({
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  background: ok ? 'rgba(74,140,92,0.12)' : 'rgba(196,80,64,0.10)',
  color: ok ? 'var(--green)' : 'var(--red)',
});

export const scanRowIconStyle = (
  kind: DetectedPrinterKind,
  isUsb: boolean,
): React.CSSProperties => ({
  width: 30,
  height: 30,
  borderRadius: 6,
  background:
    kind === 'device'
      ? 'rgba(74,140,92,0.14)'
      : isUsb
        ? 'rgba(201,164,92,0.18)'
        : 'rgba(168,152,136,0.18)',
  color:
    kind === 'device'
      ? 'var(--green)'
      : isUsb
        ? '#8a6d2a'
        : 'var(--text2)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  flexShrink: 0,
});

// ─── Static style maps ──────────────────────────────────────────────────────

export const ps: Record<string, React.CSSProperties> = {
  // Card / form
  card: { background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 18 },
  cardHead: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14, gap: 12, flexWrap: 'wrap' },
  cardTitle: { fontFamily: "'Playfair Display', serif", fontSize: 16, fontWeight: 600, color: 'var(--text1)', margin: 0 },
  cardSub: { fontSize: 12, color: 'var(--text3)', marginTop: 2 },
  fieldRow: { display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 },
  field: { display: 'flex', flexDirection: 'column', gap: 6 },
  label: { fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600 },
  input: { height: 42, border: '1px solid var(--border)', borderRadius: 8, padding: '0 12px', background: 'var(--bg2)', color: 'var(--text1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  select: { height: 42, border: '1px solid var(--border)', borderRadius: 8, padding: '0 10px', background: 'var(--bg2)', color: 'var(--text1)', fontSize: 13, outline: 'none', fontFamily: 'inherit' },
  toggleRow: { display: 'flex', alignItems: 'center', gap: 12 },
  toggleLabel: { fontSize: 13, color: 'var(--text1)', fontWeight: 500 },
  cardActions: { display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' },
  hint: { fontSize: 11, color: 'var(--text3)', marginTop: 6, fontStyle: 'italic' },
  addressRow: { display: 'flex', gap: 8, alignItems: 'stretch' },
  driverNote: { marginTop: 8, padding: '8px 12px', borderRadius: 8, background: 'rgba(201,164,92,0.10)', border: '1px solid rgba(201,164,92,0.4)', color: '#8a6d2a', fontSize: 11, lineHeight: 1.45 },

  // Buttons
  primaryBtn: { padding: '10px 18px', borderRadius: 8, background: 'var(--text1)', color: '#fff', fontSize: 13, fontWeight: 600, border: '1px solid var(--text1)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8 },
  ghostBtn: { padding: '10px 18px', borderRadius: 8, background: 'var(--bg2)', color: 'var(--text1)', fontSize: 13, fontWeight: 500, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8 },
  goldBtn: { padding: '10px 18px', borderRadius: 8, background: 'var(--gold)', color: '#2c2420', fontSize: 13, fontWeight: 600, border: '1px solid rgba(44,36,32,0.08)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 40, display: 'inline-flex', alignItems: 'center', gap: 8 },

  // Loading / empty
  loading: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text2)', gap: 12 },
  empty: { padding: 60, textAlign: 'center', color: 'var(--text3)', fontSize: 13 },

  // Recommendation badge (from auto-setup panel)
  badge: { fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', padding: '3px 9px', borderRadius: 999, display: 'inline-flex', alignItems: 'center', gap: 6 },
  reasoning: { fontSize: 12, color: 'var(--text2)', lineHeight: 1.5, marginBottom: 10, background: 'var(--bg2)', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)' },

  // Scan panel
  scanPanel: { marginTop: 10, border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg)', padding: 12 },
  scanHead: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 10 },
  scanTitle: { fontFamily: "'Playfair Display', serif", fontSize: 13, fontWeight: 600, color: 'var(--text1)' },
  scanSub: { fontSize: 11, color: 'var(--text3)', marginTop: 2, fontVariantNumeric: 'tabular-nums' },
  scanActions: { display: 'flex', alignItems: 'center', gap: 12 },
  filterPill: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--bg2)', color: 'var(--text2)' },
  filterPillActive: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderRadius: 999, fontSize: 11, fontWeight: 600, cursor: 'pointer', border: '1px solid var(--text1)', background: 'var(--text1)', color: '#fff' },
  refreshBtn: { padding: '6px 12px', borderRadius: 6, background: 'var(--bg2)', color: 'var(--text1)', fontSize: 11, fontWeight: 600, border: '1px solid var(--border)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 30, display: 'inline-flex', alignItems: 'center', gap: 6 },
  scanList: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 280, overflowY: 'auto' },
  scanEmpty: { padding: '20px 10px', textAlign: 'center', color: 'var(--text3)', fontSize: 12, lineHeight: 1.5 },
  scanErr: { padding: '8px 10px', borderRadius: 8, background: 'rgba(196,80,64,0.10)', border: '1px solid rgba(196,80,64,0.4)', color: 'var(--red)', fontSize: 11 },

  // Scan result row
  row: { display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 8 },
  rowMain: { flex: 1, minWidth: 0 },
  rowLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text1)', display: 'inline-flex', alignItems: 'center', gap: 6 },
  rowMeta: { display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text2)', marginTop: 3, flexWrap: 'wrap' },
  rowNote: { fontSize: 11, color: 'var(--red)', marginTop: 4, lineHeight: 1.4 },
  sourceBadge: { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 999 },
  defaultBadge: { fontSize: 9, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', padding: '1px 6px', borderRadius: 999, background: 'rgba(201,164,92,0.18)', color: '#8a6d2a' },
  statusDot: { width: 7, height: 7, borderRadius: '50%', flexShrink: 0 },
  address: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 10, color: 'var(--text3)', background: 'var(--bg)', padding: '1px 5px', borderRadius: 3, border: '1px solid var(--border)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  sep: { color: 'var(--text3)' },
  useBtn: { padding: '7px 12px', borderRadius: 6, background: 'var(--gold)', color: '#2c2420', fontSize: 12, fontWeight: 600, border: '1px solid rgba(44,36,32,0.08)', cursor: 'pointer', fontFamily: 'inherit', minHeight: 32, flexShrink: 0 },
};
