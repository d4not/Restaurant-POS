/* POS Terminal Design Reference — extracted from wireframe */
/* Use these exact CSS variables, colors, spacing, and component styles */

/* === DESIGN TOKENS === */
:root {
  --bg:       rgb(245, 240, 232);
  --bg2:      #fff;
  --text1:    #2c2420;
  --text2:    #6b5e54;
  --text3:    #a89888;
  --gold:     #c9a45c;
  --green:    #4a8c5c;
  --red:      #c45040;
  --border:   #e2dcd4;
  --sidebar:  #2c2420;
  --shadow-sm: 0 1px 2px rgba(44,36,32,0.04);
  --shadow:    0 2px 8px rgba(44,36,32,0.06);
  --shadow-lg: 0 8px 32px rgba(44,36,32,0.12);
}
body {
  font-family: 'DM Sans', system-ui, sans-serif;
  background: var(--bg);
  color: var(--text1);
  font-size: 14px;
}
h1, h2, h3, h4, .serif {
  font-family: 'Playfair Display', Georgia, serif;
  font-weight: 600;
}


/* === // Order History view === */
const histStyles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  head: {
    padding: '22px 32px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  title: { fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600, margin: 0 },
  sub: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },

  toolbar: {
    display: 'flex', gap: 12, padding: '14px 32px',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
  },
  search: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '13px 14px',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    width: 300,
  },
  searchInput: { border: 'none', outline: 'none', background: 'transparent', flex: 1, fontSize: 14 },

  tabs: { display: 'flex', gap: 4, marginLeft: 12 },
  tab: (active) => ({
    padding: '12px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600,
    color: active ? 'var(--text1)' : 'var(--text2)',
    background: active ? 'var(--bg2)' : 'transparent',
    border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
    cursor: 'pointer',
    minHeight: 44,
  }),

  body: { flex: 1, minHeight: 0, overflowY: 'auto', padding: '20px 32px' },

  metricRow: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 22 },
  metric: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '16px 18px',
  },
  metricLabel: { fontSize: 11, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text3)', fontWeight: 600 },
  metricValue: { fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600, color: 'var(--text1)', marginTop: 6, fontVariantNumeric: 'tabular-nums' },
  metricDelta: { fontSize: 12, color: 'var(--green)', marginTop: 2, fontWeight: 500 },

  table: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
    boxShadow: 'var(--shadow-sm)',
  },
  th: {
    display: 'grid',
    gridTemplateColumns: '110px 90px 110px 70px 90px 1fr 100px 110px 60px',
    columnGap: 18,
    padding: '14px 22px',
    fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', fontWeight: 600,
    color: 'var(--text3)',
    background: 'var(--bg)',
    borderBottom: '1px solid var(--border)',
  },
  tr: {
    display: 'grid',
    gridTemplateColumns: '110px 90px 110px 70px 90px 1fr 100px 110px 60px',
    columnGap: 18,
    padding: '20px 22px',
    fontSize: 14,
    color: 'var(--text1)',
    borderBottom: '1px solid var(--border)',
    alignItems: 'center',
    cursor: 'pointer',
    transition: 'background 0.12s',
  },
  cellMuted: { color: 'var(--text2)' },
  cellNum: { fontVariantNumeric: 'tabular-nums', textAlign: 'right' },
  paymentTag: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 12, color: 'var(--text2)',
  },
};

/* === // Top bar — horizontal nav with brand, primary nav tabs, status, hamburger === */
const topbarStyles = {
  root: {
    display: 'grid',
    gridTemplateColumns: '1fr auto 1fr',
    alignItems: 'center',
    height: 72,
    background: 'var(--sidebar)',
    color: '#e8ddd0',
    padding: '0 20px',
    flexShrink: 0,
    borderBottom: '1px solid rgba(0,0,0,0.2)',
    gap: 20,
  },
  leftGroup: {
    display: 'flex', alignItems: 'center', gap: 20,
    height: '100%',
    minWidth: 0,
  },
  rightGroup: {
    display: 'flex', alignItems: 'center', gap: 20,
    height: '100%',
    justifyContent: 'flex-end',
    minWidth: 0,
  },
  brandWrap: {
    display: 'flex', alignItems: 'center', gap: 12,
    paddingRight: 20,
    borderRight: '1px solid rgba(232,221,208,0.1)',
    height: '100%',
  },
  brand: {
    width: 38, height: 38,
    borderRadius: 8,
    background: 'linear-gradient(135deg, #c9a45c 0%, #a8843f 100%)',
    color: '#2c2420',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 20,
    fontWeight: 700,
  },
  brandText: {
    display: 'flex', flexDirection: 'column', lineHeight: 1.1,
  },
  brandName: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17, fontWeight: 600, color: '#fff',
  },
  brandSub: {
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.45)',
    marginTop: 2,
  },

  navList: { display: 'flex', gap: 4, alignItems: 'center', justifyContent: 'center', height: '100%' },
  navItem: (active) => ({
    display: 'inline-flex', alignItems: 'center', gap: 10,
    padding: '12px 20px',
    borderRadius: 10,
    color: active ? '#2c2420' : 'rgba(232,221,208,0.78)',
    background: active ? 'var(--gold)' : 'transparent',
    fontSize: 14,
    fontWeight: 600,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    transition: 'all 0.15s',
    cursor: 'pointer',
    minHeight: 44,
  }),

  spacer: { flex: 1 },

  statusGroup: {
    display: 'flex', alignItems: 'center', gap: 18,
    fontSize: 12, color: 'rgba(232,221,208,0.6)',
    whiteSpace: 'nowrap',
  },
  statusItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },

  iconBtn: {
    width: 48, height: 48, borderRadius: 10,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'rgba(232,221,208,0.06)',
    color: '#e8ddd0',
    transition: 'background 0.15s',
    cursor: 'pointer',
    position: 'relative',
    flexShrink: 0,
  },
  bellDot: {
    position: 'absolute', top: 8, right: 9,
    width: 8, height: 8, borderRadius: '50%',
    background: 'var(--gold)',
    border: '2px solid var(--sidebar)',
  },

  user: {
    display: 'flex', alignItems: 'center', gap: 10,
    paddingLeft: 16,
    borderLeft: '1px solid rgba(232,221,208,0.1)',
    height: '100%',
    flexShrink: 0,
  },
  avatar: {
    width: 36, height: 36,
    borderRadius: '50%',
    background: 'linear-gradient(135deg, #6b5e54, #2c2420)',
    color: '#e8ddd0',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontWeight: 600,
    fontSize: 13,
    border: '1px solid rgba(232,221,208,0.12)',
  },
  userText: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 },
  userName: { fontSize: 13, fontWeight: 600, color: '#fff', whiteSpace: 'nowrap' },
  userMeta: { fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'rgba(232,221,208,0.5)', marginTop: 2, whiteSpace: 'nowrap' },

  // Hamburger drawer (top-anchored)
  scrim: {
    position: 'fixed', inset: 0,
    background: 'rgba(44,36,32,0.32)',
    zIndex: 40,
  },
  drawer: {
    position: 'fixed',
    top: 76, left: 12,
    width: 320,
    background: '#1f1814',
    color: '#e8ddd0',
    borderRadius: 14,
    boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
    zIndex: 50,
    overflow: 'hidden',
    border: '1px solid rgba(232,221,208,0.08)',
  },
  drawerHead: {
    padding: '20px 22px 16px',
    borderBottom: '1px solid rgba(232,221,208,0.08)',
  },
  drawerTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 600, margin: 0, color: '#fff',
  },
  drawerSub: {
    fontSize: 12, color: 'rgba(232,221,208,0.55)', marginTop: 2,
  },
  drawerSection: {
    fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'rgba(232,221,208,0.4)',
    padding: '14px 22px 6px',
  },
  drawerItem: {
    display: 'flex', alignItems: 'center', gap: 14,
    padding: '14px 22px',
    fontSize: 15,
    color: '#e8ddd0',
    cursor: 'pointer',
    transition: 'background 0.12s',
    minHeight: 52,
  },
  drawerItemR: {
    marginLeft: 'auto',
    fontSize: 11,
    color: 'rgba(232,221,208,0.45)',
  },
};

/* === // Floor plan — visual table layout === */
const fpStyles = {
  root: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 },
  head: {
    padding: '20px 28px 16px',
    borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between',
  },
  title: { fontFamily: "'Playfair Display', serif", fontSize: 28, fontWeight: 600, margin: 0 },
  sub: { fontSize: 12, color: 'var(--text2)', marginTop: 4 },
  legendRow: { display: 'flex', gap: 18, fontSize: 12, color: 'var(--text2)' },
  legendItem: { display: 'inline-flex', alignItems: 'center', gap: 6 },
  swatch: (color) => ({ width: 12, height: 12, borderRadius: 3, background: color }),

  zoneTabs: { display: 'flex', gap: 4, padding: '14px 28px', borderBottom: '1px solid var(--border)' },
  zoneTab: (active) => ({
    padding: '12px 18px', borderRadius: 8, fontSize: 14, fontWeight: 600,
    color: active ? 'var(--text1)' : 'var(--text2)',
    background: active ? 'var(--bg2)' : 'transparent',
    border: '1px solid ' + (active ? 'var(--border)' : 'transparent'),
    cursor: 'pointer',
    minHeight: 44,
    whiteSpace: 'nowrap',
  }),

  canvasWrap: { flex: 1, minHeight: 0, padding: '24px 28px', overflow: 'hidden' },
  canvas: {
    position: 'relative',
    width: '100%', height: '100%',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 14,
    backgroundImage:
      'linear-gradient(rgba(168,152,136,0.08) 1px, transparent 1px),' +
      'linear-gradient(90deg, rgba(168,152,136,0.08) 1px, transparent 1px)',
    backgroundSize: '40px 40px',
    overflow: 'hidden',
  },
  zoneLabel: {
    position: 'absolute',
    fontSize: 10, letterSpacing: '0.18em', textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },

  // Popover shown when tapping an empty table
  popover: {
    position: 'absolute',
    transform: 'translate(-50%, calc(-100% - 14px))',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    boxShadow: 'var(--shadow-lg)',
    padding: '14px 16px',
    minWidth: 220,
    zIndex: 5,
  },
  popTitle: { fontFamily: "'Playfair Display', serif", fontSize: 18, fontWeight: 600, margin: 0 },
  popMeta: { fontSize: 12, color: 'var(--text2)', marginTop: 2 },
  popActions: { display: 'flex', gap: 8, marginTop: 12 },
  btn: (variant = 'ghost') => {
    const base = { padding: '10px 14px', borderRadius: 8, fontSize: 13, fontWeight: 600,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, cursor: 'pointer', flex: 1, minHeight: 40 };
    if (variant === 'primary') return { ...base, background: 'var(--text1)', color: '#fff' };
    if (variant === 'gold')    return { ...base, background: 'var(--gold)', color: '#2c2420' };
    return { ...base, background: 'transparent', color: 'var(--text1)', border: '1px solid var(--border)' };
  },
};

/* === // Table Detail — full-screen workspace for a single table/order === */
const tdStyles = {
  shell: {
    display: 'flex', flexDirection: 'column',
    height: '100%', minHeight: 0,
    background: 'var(--bg)',
  },

  // ─── Header
  head: {
    display: 'flex', alignItems: 'center', gap: 18,
    padding: '14px 24px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg2)',
    minHeight: 72,
  },
  back: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    padding: '10px 14px 10px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    color: 'var(--text1)',
    fontSize: 13, fontWeight: 500,
    cursor: 'pointer',
    minHeight: 40,
  },
  tableMark: (color) => ({
    width: 52, height: 52, borderRadius: 12,
    background: color,
    color: '#fff',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 24, fontWeight: 700,
    flexShrink: 0,
  }),
  hTitleBlock: { display: 'flex', flexDirection: 'column', lineHeight: 1.15, minWidth: 0 },
  hTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 24, fontWeight: 600, margin: 0,
    color: 'var(--text1)',
  },
  hMeta: {
    display: 'flex', gap: 12, fontSize: 12,
    color: 'var(--text2)', marginTop: 4,
    alignItems: 'center',
  },
  metaSep: { width: 3, height: 3, borderRadius: '50%', background: 'var(--text3)', display: 'inline-block' },

  statusPill: (variant) => {
    const map = {
      occupied: { bg: 'rgba(201,164,92,0.16)', col: '#8a6d2a' },
      empty:    { bg: 'rgba(74,140,92,0.12)',  col: 'var(--green)' },
      paid:     { bg: 'rgba(74,140,92,0.18)',  col: 'var(--green)' },
      open:     { bg: 'rgba(91,122,140,0.16)', col: '#3a566b' },
      sent:     { bg: 'rgba(217,113,68,0.16)', col: '#a8412c' },
      ready:    { bg: 'rgba(74,140,92,0.18)',  col: 'var(--green)' },
      served:   { bg: 'rgba(168,152,136,0.18)', col: 'var(--text2)' },
    };
    const c = map[variant] || map.empty;
    return {
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '5px 11px', borderRadius: 999,
      background: c.bg, color: c.col,
      fontSize: 11, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase',
    };
  },

  hSpacer: { flex: 1 },
  hStat: {
    display: 'flex', flexDirection: 'column', alignItems: 'flex-end',
    fontVariantNumeric: 'tabular-nums',
  },
  hStatLabel: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'var(--text3)', fontWeight: 600,
  },
  hStatVal: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 600, color: 'var(--text1)', marginTop: 2,
  },

  // ─── Body grid
  body: {
    flex: 1, minHeight: 0,
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) 380px 320px',
    gap: 0,
    overflow: 'hidden',
  },

  // ─── Left column (menu)
  menuCol: {
    display: 'flex', flexDirection: 'column',
    minWidth: 0, minHeight: 0,
    borderRight: '1px solid var(--border)',
    background: 'var(--bg)',
  },
  catRow: {
    display: 'flex', gap: 6,
    padding: '14px 20px',
    borderBottom: '1px solid var(--border)',
    overflowX: 'auto',
    flexShrink: 0,
  },
  catBtn: (active) => ({
    padding: '10px 16px',
    borderRadius: 8,
    fontSize: 13, fontWeight: 600,
    color: active ? '#fff' : 'var(--text2)',
    background: active ? 'var(--text1)' : 'var(--bg2)',
    border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
    cursor: 'pointer',
    minHeight: 40,
    whiteSpace: 'nowrap',
    fontFamily: 'inherit',
  }),
  menuSearch: {
    display: 'flex', alignItems: 'center', gap: 8,
    padding: '8px 12px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg2)',
    marginLeft: 'auto',
    minWidth: 180,
    minHeight: 40,
  },
  menuSearchInput: {
    border: 'none', outline: 'none', background: 'transparent',
    fontSize: 13, color: 'var(--text1)', flex: 1,
    fontFamily: 'inherit',
  },
  productGrid: {
    flex: 1, minHeight: 0, overflowY: 'auto',
    padding: '18px 20px 24px',
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
    gap: 12,
    alignContent: 'start',
  },
  productCard: {
    display: 'flex', flexDirection: 'column',
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 14px 12px',
    cursor: 'pointer',
    textAlign: 'left',
    transition: 'all 0.12s',
    boxShadow: 'var(--shadow-sm)',
    minHeight: 96,
    fontFamily: 'inherit',
  },
  productName: {
    fontSize: 13, fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.35,
    flex: 1,
  },
  productFoot: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    marginTop: 10,
  },
  productPrice: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16, fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
  },
  productAdd: {
    width: 28, height: 28, borderRadius: 6,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'var(--gold)',
    color: '#2c2420',
  },

  // ─── Center column (ticket)
  ticketCol: {
    display: 'flex', flexDirection: 'column',
    minHeight: 0, minWidth: 0,
    background: 'var(--bg2)',
    borderRight: '1px solid var(--border)',
  },
  ticketHead: {
    padding: '16px 20px 12px',
    borderBottom: '1px solid var(--border)',
  },
  ticketTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18, fontWeight: 600, margin: 0,
  },
  ticketSub: {
    fontSize: 11, color: 'var(--text3)',
    letterSpacing: '0.04em', marginTop: 2,
    fontVariantNumeric: 'tabular-nums',
  },

  ticketBody: {
    flex: 1, minHeight: 0, overflowY: 'auto',
    padding: '4px 0 12px',
  },
  courseLabel: {
    padding: '14px 20px 6px',
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'var(--text3)', fontWeight: 600,
    display: 'flex', alignItems: 'center', gap: 8,
  },
  courseRule: { flex: 1, height: 1, background: 'var(--border)' },

  itemRow: (newItem) => ({
    display: 'grid',
    gridTemplateColumns: '60px 1fr auto',
    gap: 10,
    padding: '10px 20px',
    borderBottom: '1px solid rgba(44,36,32,0.05)',
    background: newItem ? 'rgba(201,164,92,0.07)' : 'transparent',
    alignItems: 'center',
  }),
  qtyControls: {
    display: 'inline-flex', alignItems: 'center',
    border: '1px solid var(--border)', borderRadius: 6,
    background: 'var(--bg)',
    height: 30,
    overflow: 'hidden',
  },
  qtyBtn: {
    width: 28, height: 28,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    color: 'var(--text2)',
    cursor: 'pointer',
  },
  qtyVal: {
    minWidth: 24, textAlign: 'center',
    fontFamily: "'Playfair Display', serif",
    fontSize: 14, fontWeight: 600,
    color: 'var(--text1)',
    fontVariantNumeric: 'tabular-nums',
    padding: '0 4px',
  },
  itemName: {
    fontSize: 13, fontWeight: 500,
    color: 'var(--text1)',
    lineHeight: 1.3,
  },
  itemMods: {
    fontSize: 11, color: 'var(--text2)', fontStyle: 'italic',
    marginTop: 2,
  },
  itemBadge: {
    display: 'inline-block',
    fontSize: 9, fontWeight: 700,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    padding: '1px 5px', borderRadius: 3,
    marginLeft: 6,
  },
  itemPrice: {
    fontVariantNumeric: 'tabular-nums',
    fontSize: 14, fontWeight: 600,
    color: 'var(--text1)',
  },
  emptyState: {
    padding: '60px 24px',
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },

  // ─── Right column (totals, actions)
  rightCol: {
    display: 'flex', flexDirection: 'column',
    background: 'var(--bg)',
    minHeight: 0, minWidth: 0,
    padding: '18px 20px 18px',
    overflowY: 'auto',
    gap: 14,
  },
  panel: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
  },
  panelHd: {
    fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase',
    color: 'var(--text3)', fontWeight: 600,
    marginBottom: 8,
  },
  totalsRow: {
    display: 'grid', gridTemplateColumns: '1fr auto', rowGap: 6, columnGap: 12,
    fontSize: 13, color: 'var(--text2)',
  },
  totalsAmt: {
    color: 'var(--text1)', textAlign: 'right',
    fontVariantNumeric: 'tabular-nums', fontWeight: 500,
  },
  grandLabel: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 17, fontWeight: 600, color: 'var(--text1)',
    paddingTop: 10, marginTop: 4,
    borderTop: '1px solid var(--border)',
  },
  grandAmt: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 600, color: 'var(--text1)',
    paddingTop: 10, marginTop: 4,
    borderTop: '1px solid var(--border)',
    textAlign: 'right', fontVariantNumeric: 'tabular-nums',
  },
  primaryBtn: {
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 15, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    cursor: 'pointer',
    border: '1px solid var(--text1)',
    fontFamily: 'inherit',
    minHeight: 52,
    letterSpacing: '0.01em',
  },
  goldBtn: {
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 15, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    cursor: 'pointer',
    border: '1px solid rgba(44,36,32,0.08)',
    fontFamily: 'inherit',
    minHeight: 52,
  },
  greenBtn: {
    width: '100%',
    padding: '14px 18px',
    borderRadius: 10,
    background: 'var(--green)',
    color: '#fff',
    fontSize: 15, fontWeight: 600,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    cursor: 'pointer',
    border: '1px solid var(--green)',
    fontFamily: 'inherit',
    minHeight: 52,
  },
  ghostBtn: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    fontFamily: 'inherit',
    minHeight: 42,
    textAlign: 'left',
  },
  dangerBtn: {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 8,
    background: 'transparent',
    color: 'var(--red)',
    fontSize: 13, fontWeight: 500,
    display: 'inline-flex', alignItems: 'center', justifyContent: 'flex-start', gap: 10,
    cursor: 'pointer',
    border: '1px solid rgba(196,80,64,0.25)',
    fontFamily: 'inherit',
    minHeight: 42,
  },

  // Pay modal overlay
  modalScrim: {
    position: 'fixed', inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 60,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  modal: {
    width: 480,
    background: 'var(--bg2)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  modalHead: {
    padding: '20px 24px 16px',
    borderBottom: '1px solid var(--border)',
  },
  modalTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22, fontWeight: 600, margin: 0,
  },
  modalSub: {
    fontSize: 12, color: 'var(--text2)', marginTop: 4,
  },
  modalBody: { padding: '20px 24px' },
  payMethods: {
    display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10,
    marginTop: 6,
  },
  payMethod: (active) => ({
    padding: '16px 14px',
    borderRadius: 10,
    border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
    background: active ? 'rgba(44,36,32,0.04)' : 'var(--bg)',
    color: 'var(--text1)',
    cursor: 'pointer',
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
    fontSize: 13, fontWeight: 600,
    fontFamily: 'inherit',
    minHeight: 80,
    transition: 'all 0.12s',
  }),
  tipRow: { display: 'flex', gap: 8, marginTop: 8 },
  tipBtn: (active) => ({
    flex: 1,
    padding: '10px 8px',
    borderRadius: 8,
    border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
    background: active ? 'var(--text1)' : 'var(--bg)',
    color: active ? '#fff' : 'var(--text1)',
    fontSize: 13, fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
  }),
};

/* Settings panel styles omitted — see wireframe HTML for reference */
