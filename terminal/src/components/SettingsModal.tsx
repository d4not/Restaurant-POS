import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Spinner } from './Spinner';
import { useUi } from '../store/ui';
import { useSession } from '../store/session';
import { usePreferences } from '../store/preferences';
import {
  approveSuggestion,
  listSuggestions,
  rejectSuggestion,
  type Suggestion,
} from '../api/suggestions';
import { ApiError, getApiBase, getServerRoot, setApiBase } from '../api/client';
import { getPrinterStatus } from '../api/print';
import {
  defaultServerUrlForPlatform,
  loadServerUrl,
  saveServerUrl,
} from '../store/serverUrl';
import { getPlatformId } from '../platform';

// Sections the user can switch between in the modal's left rail. General /
// Appearance / Printers ship in Phase 5; Users / Register depend on backend
// modules that aren't built yet — placeholders keep the layout familiar.
// `suggestions` is admin-only: the queue of cashier-proposed table/product
// changes waiting on review.
type Section =
  | 'general'
  | 'appearance'
  | 'printers'
  | 'users'
  | 'register'
  | 'suggestions';

interface SectionDef {
  id: Section;
  label: string;
  ready: boolean;
  adminOnly?: boolean;
}

const SECTIONS: SectionDef[] = [
  { id: 'general', label: 'General', ready: true },
  { id: 'appearance', label: 'Appearance', ready: true },
  { id: 'printers', label: 'Printers', ready: true },
  { id: 'suggestions', label: 'Suggested Changes', ready: true, adminOnly: true },
  { id: 'users', label: 'Users', ready: false },
  { id: 'register', label: 'Register', ready: false },
];

const PRINTER_TYPES = ['epson', 'star', 'tanca', 'daruma', 'brother', 'custom'] as const;

// Subset of the character sets node-thermal-printer ships with — we expose
// the ones a Latin-American café is likely to need. Anything else can still
// be hand-edited in printers.json on disk if there's a real reason.
const CHARACTER_SETS = [
  'PC850_MULTILINGUAL',
  'PC437_USA',
  'PC858_EURO',
  'WPC1252',
  'ISO8859_15_LATIN9',
  'PC860_PORTUGUESE',
  'PC852_LATIN2',
] as const;

const styles: Record<string, React.CSSProperties> = {
  scrim: {
    position: 'fixed',
    inset: 0,
    background: 'rgba(44,36,32,0.42)',
    zIndex: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  modal: {
    width: 880,
    maxWidth: '100%',
    height: 600,
    maxHeight: '100%',
    display: 'grid',
    gridTemplateColumns: '220px 1fr',
    background: 'var(--bg2)',
    borderRadius: 16,
    boxShadow: '0 24px 64px rgba(0,0,0,0.32)',
    border: '1px solid var(--border)',
    overflow: 'hidden',
  },
  nav: {
    background: 'var(--bg)',
    borderRight: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    padding: '20px 0',
  },
  navHead: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 18,
    fontWeight: 600,
    color: 'var(--text1)',
    padding: '0 20px 16px',
  },
  navItemTag: {
    fontSize: 9,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 700,
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    minWidth: 0,
    minHeight: 0,
  },
  bodyHead: {
    padding: '20px 28px 18px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexShrink: 0,
  },
  bodyTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 22,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  closeBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    color: 'var(--text2)',
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    fontSize: 18,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'inherit',
  },
  bodyContent: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    padding: '24px 28px 28px',
  },
  card: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: 20,
    marginBottom: 18,
  },
  cardHead: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 14,
    gap: 12,
    flexWrap: 'wrap',
  },
  cardTitle: {
    fontFamily: "'Playfair Display', serif",
    fontSize: 16,
    fontWeight: 600,
    color: 'var(--text1)',
    margin: 0,
  },
  cardSub: {
    fontSize: 12,
    color: 'var(--text3)',
    marginTop: 2,
  },
  fieldRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, 1fr)',
    gap: 12,
    marginBottom: 12,
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  label: {
    fontSize: 11,
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: 'var(--text3)',
    fontWeight: 600,
  },
  input: {
    height: 42,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 12px',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  select: {
    height: 42,
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '0 10px',
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    outline: 'none',
    fontFamily: 'inherit',
  },
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  toggleLabel: {
    fontSize: 13,
    color: 'var(--text1)',
    fontWeight: 500,
  },
  cardActions: {
    display: 'flex',
    gap: 8,
    marginTop: 14,
    flexWrap: 'wrap',
  },
  primaryBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--text1)',
    color: '#fff',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid var(--text1)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  ghostBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--bg2)',
    color: 'var(--text1)',
    fontSize: 13,
    fontWeight: 500,
    border: '1px solid var(--border)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  goldBtn: {
    padding: '10px 18px',
    borderRadius: 8,
    background: 'var(--gold)',
    color: '#2c2420',
    fontSize: 13,
    fontWeight: 600,
    border: '1px solid rgba(44,36,32,0.08)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
  },
  empty: {
    padding: 60,
    textAlign: 'center',
    color: 'var(--text3)',
    fontSize: 13,
  },
  loading: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: 'var(--text2)',
    gap: 12,
  },
  hint: {
    fontSize: 11,
    color: 'var(--text3)',
    marginTop: 6,
    fontStyle: 'italic',
  },
};

// CSS variants are lifted out of the `styles` map so the map's value type
// stays `CSSProperties` — TS otherwise widens the function signatures away.
const navItemStyle = (active: boolean, ready: boolean): React.CSSProperties => ({
  padding: '12px 20px',
  fontSize: 13,
  fontWeight: 500,
  color: !ready ? 'var(--text3)' : active ? 'var(--text1)' : 'var(--text2)',
  background: active ? 'var(--bg2)' : 'transparent',
  borderLeft: '3px solid ' + (active ? 'var(--gold)' : 'transparent'),
  cursor: ready ? 'pointer' : 'not-allowed',
  textAlign: 'left',
  width: '100%',
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  fontFamily: 'inherit',
  border: 'none',
});

const statusPillStyle = (ok: boolean | null): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: 999,
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  background:
    ok === null
      ? 'var(--bg2)'
      : ok
        ? 'rgba(74,140,92,0.16)'
        : 'rgba(196,80,64,0.14)',
  color: ok === null ? 'var(--text3)' : ok ? 'var(--green)' : 'var(--red)',
  border: '1px solid ' + (ok === null ? 'var(--border)' : 'transparent'),
});

const statusDotStyle = (ok: boolean | null): React.CSSProperties => ({
  width: 8,
  height: 8,
  borderRadius: '50%',
  background: ok === null ? 'var(--text3)' : ok ? 'var(--green)' : 'var(--red)',
});

const resultBannerStyle = (ok: boolean): React.CSSProperties => ({
  marginTop: 12,
  padding: '8px 12px',
  borderRadius: 8,
  fontSize: 12,
  fontWeight: 500,
  background: ok ? 'rgba(74,140,92,0.12)' : 'rgba(196,80,64,0.10)',
  color: ok ? 'var(--green)' : 'var(--red)',
});

export function SettingsModal() {
  const open = useUi((s) => s.settingsOpen);
  const close = useUi((s) => s.closeSettings);
  const role = useSession((s) => s.user?.role ?? 'WAITER');
  const isAdmin = role === 'ADMIN';
  const [section, setSection] = useState<Section>('general');

  // Reset to General every time the modal reopens — keeps the deeper
  // sections (printers / users) from sticking around if the cashier reopens
  // for an unrelated tweak.
  useEffect(() => {
    if (open) setSection('general');
  }, [open]);

  // Filter sections by role. Admin-only entries (Suggested Changes) drop out
  // of the rail entirely for cashiers/waiters.
  const visibleSections = SECTIONS.filter((s) => !s.adminOnly || isAdmin);

  // Esc closes the modal — same convention as the hamburger drawer.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  if (!open) return null;

  const activeSection = visibleSections.find((s) => s.id === section);

  return (
    <div style={styles.scrim} onClick={close}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <aside style={styles.nav}>
          <div style={styles.navHead}>Settings</div>
          {visibleSections.map((s) => (
            <button
              key={s.id}
              type="button"
              style={navItemStyle(section === s.id, s.ready)}
              onClick={() => s.ready && setSection(s.id)}
              disabled={!s.ready}
            >
              <span>{s.label}</span>
              {!s.ready && <span style={styles.navItemTag}>Soon</span>}
            </button>
          ))}
        </aside>
        <div style={styles.body}>
          <header style={styles.bodyHead}>
            <h2 style={styles.bodyTitle}>{activeSection?.label ?? 'Settings'}</h2>
            <button type="button" style={styles.closeBtn} onClick={close} aria-label="Close">
              ×
            </button>
          </header>
          <div style={styles.bodyContent}>
            {section === 'general' && <GeneralSection />}
            {section === 'appearance' && <AppearanceSection />}
            {section === 'printers' && <PrintersSection />}
            {section === 'suggestions' && isAdmin && <SuggestionsSection />}
            {section === 'users' && (
              <div style={styles.empty}>
                User PIN management lives in the admin panel — open
                <br />
                Personal · Empleados to add cashiers and reset PINs.
              </div>
            )}
            {section === 'register' && (
              <div style={styles.empty}>
                Register open / close is part of the cash drawer module.
                <br />
                Configure it from Personal · Caja in the admin panel.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── General section ───────────────────────────────────────────────────────
// Business name / tax id / address feed the receipt header. We persist them
// alongside printer config because they're a per-terminal concern (multi-
// location chains might run different storefront names per device).

function GeneralSection() {
  return (
    <>
      <ServerUrlCard />
      <BusinessInfoCard />
      <CacheCard />
    </>
  );
}

// Lets the operator point the app at a different backend without rebuilding.
// Lives here (rather than admin-only) because the LAN-deployment use case is
// "swap the API server, every terminal needs to follow" and a cashier on a
// tablet may need to fix it on the spot. Connection test pings /health on the
// server root to validate the URL before saving.
function ServerUrlCard() {
  const [draft, setDraft] = useState<string>(getApiBase());
  const [loaded, setLoaded] = useState(false);
  const [saved, setSaved] = useState<boolean>(false);
  const [testResult, setTestResult] = useState<
    { ok: true; latencyMs: number } | { ok: false; error: string } | null
  >(null);
  const [testing, setTesting] = useState(false);

  // Hydrate from the persisted preference once. If nothing's there, surface
  // the platform default so the cashier sees the URL the app would otherwise
  // try (rather than an empty input that looks broken).
  useEffect(() => {
    let cancelled = false;
    loadServerUrl()
      .then((stored) => {
        if (cancelled) return;
        const fallback = defaultServerUrlForPlatform() || getApiBase();
        setDraft(stored || fallback);
        setLoaded(true);
      })
      .catch(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dirty = loaded && draft.trim() !== getApiBase();
  const valid = /^https?:\/\/.+/i.test(draft.trim());

  async function save() {
    if (!valid) return;
    const next = draft.trim();
    await saveServerUrl(next);
    setApiBase(next);
    setSaved(true);
    setTestResult(null);
    window.setTimeout(() => setSaved(false), 3000);
  }

  async function runTest() {
    if (!valid) return;
    setTesting(true);
    setTestResult(null);
    // Test the *draft* URL, not the live one — operators usually test before
    // committing. Strip /api/v1 the same way getServerRoot does for live.
    const draftRoot = draft.trim().replace(/\/api\/v\d+\/?$/, '').replace(/\/$/, '');
    const target = `${draftRoot}/health`;
    const startedAt = performance.now();
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(target, { signal: controller.signal });
      const latencyMs = Math.round(performance.now() - startedAt);
      if (!res.ok) {
        setTestResult({ ok: false, error: `Server returned ${res.status}` });
        return;
      }
      const body = (await res.json().catch(() => null)) as
        | { success?: boolean; data?: { status?: string } }
        | null;
      if (!body?.success || body.data?.status !== 'ok') {
        setTestResult({ ok: false, error: 'Unexpected health response' });
        return;
      }
      setTestResult({ ok: true, latencyMs });
    } catch (err) {
      const reason =
        err instanceof DOMException && err.name === 'AbortError'
          ? 'Timed out after 5s'
          : err instanceof Error
            ? err.message
            : 'Could not reach server';
      setTestResult({ ok: false, error: reason });
    } finally {
      window.clearTimeout(timeout);
      setTesting(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>Server URL</h3>
          <div style={styles.cardSub}>
            Where this terminal sends API requests. Change to point at a
            different backend on the local network — a restart isn't required.
          </div>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>Backend base URL</label>
        <input
          style={styles.input}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setSaved(false);
            setTestResult(null);
          }}
          placeholder="http://192.168.1.100:3000/api/v1"
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
        />
        <div style={styles.hint}>
          Active URL: <code>{getServerRoot()}</code>
        </div>
      </div>

      <div style={styles.cardActions}>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={save}
          disabled={!dirty || !valid}
        >
          Save changes
        </button>
        <button
          type="button"
          style={styles.goldBtn}
          onClick={runTest}
          disabled={!valid || testing}
        >
          {testing ? <Spinner size={12} /> : '🔌'} Test connection
        </button>
      </div>

      {!valid && (
        <div style={resultBannerStyle(false)}>
          URL must start with http:// or https://
        </div>
      )}
      {saved && <div style={resultBannerStyle(true)}>Saved.</div>}
      {testResult?.ok && (
        <div style={resultBannerStyle(true)}>
          Connected — health responded in {testResult.latencyMs}ms.
        </div>
      )}
      {testResult && !testResult.ok && (
        <div style={resultBannerStyle(false)}>
          Could not reach server: {testResult.error}
        </div>
      )}
    </div>
  );
}

function BusinessInfoCard() {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ['printer-config'],
    queryFn: () => window.electron!.printer.getConfig(),
    enabled: Boolean(window.electron),
  });

  const [draft, setDraft] = useState<PrinterBusinessConfig | null>(null);
  useEffect(() => {
    if (configQuery.data) setDraft(configQuery.data.business);
  }, [configQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (next: PrinterBusinessConfig) =>
      window.electron!.printer.setConfig({ business: next }),
    onSuccess: (cfg) => {
      queryClient.setQueryData(['printer-config'], cfg);
    },
  });

  if (!window.electron) {
    return (
      <div style={styles.empty}>
        Business info / printer settings only work inside the Electron app —
        open the desktop terminal to configure.
      </div>
    );
  }
  if (configQuery.isLoading || !draft) {
    return (
      <div style={styles.loading}>
        <Spinner size={18} /> Loading business info…
      </div>
    );
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>Business info</h3>
          <div style={styles.cardSub}>Shown at the top of every printed receipt.</div>
        </div>
      </div>

      <div style={styles.fieldRow}>
        <div style={styles.field}>
          <label style={styles.label}>Business name</label>
          <input
            style={styles.input}
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Tax ID / RFC</label>
          <input
            style={styles.input}
            value={draft.tax_id}
            onChange={(e) => setDraft({ ...draft, tax_id: e.target.value })}
          />
        </div>
      </div>
      <div style={styles.field}>
        <label style={styles.label}>Address</label>
        <input
          style={styles.input}
          value={draft.address}
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
      </div>

      <div style={styles.cardActions}>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={() => saveMutation.mutate(draft)}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending && <Spinner size={12} />}
          Save changes
        </button>
      </div>

      {saveMutation.isSuccess && (
        <div style={resultBannerStyle(true)}>Saved.</div>
      )}
      {saveMutation.isError && (
        <div style={resultBannerStyle(false)}>
          Could not save: {(saveMutation.error as Error).message}
        </div>
      )}
    </div>
  );
}

// Drops every TanStack Query cache entry and reloads the renderer. Useful
// after admin-side changes (new product, price change, modifier tweak) that
// the terminal otherwise wouldn't see for up to 5 minutes — categories and
// the product menu have a long staleTime by design (read-mostly, rarely
// edited mid-shift).
function CacheCard() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  function clearAndReload() {
    setBusy(true);
    // queryClient.clear() is redundant given the reload nukes the SPA, but
    // we drop it first so any in-flight request that resolves between now
    // and unload doesn't write stale data into a dying cache.
    queryClient.clear();
    window.location.reload();
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>Cache</h3>
          <div style={styles.cardSub}>
            The terminal caches the menu, categories, and other rarely-changed
            data for up to 5 minutes. If admin just changed something on the
            web panel and you need to see it now, clear the cache and reload.
            In-progress orders are unaffected — they live on the server.
          </div>
        </div>
      </div>
      <div style={styles.cardActions}>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={clearAndReload}
          disabled={busy}
        >
          {busy && <Spinner size={12} />}
          Clear cache &amp; reload
        </button>
      </div>
    </div>
  );
}

// ─── Printers section ──────────────────────────────────────────────────────

function PrintersSection() {
  const queryClient = useQueryClient();

  const configQuery = useQuery({
    queryKey: ['printer-config'],
    queryFn: () => window.electron!.printer.getConfig(),
    enabled: Boolean(window.electron),
  });

  // Live status check — refetches every 30s while the modal is open. The
  // probe opens a real socket / file handle, so we keep it light.
  const statusQuery = useQuery({
    queryKey: ['printer-status'],
    queryFn: () => window.electron!.printer.status(),
    enabled: Boolean(window.electron),
    refetchInterval: 30_000,
  });

  const saveMutation = useMutation({
    mutationFn: (next: Partial<PrinterConfig>) =>
      window.electron!.printer.setConfig(next),
    onSuccess: (cfg) => {
      queryClient.setQueryData(['printer-config'], cfg);
      queryClient.invalidateQueries({ queryKey: ['printer-status'] });
    },
  });

  if (!window.electron) {
    return <RemotePrinterStatus />;
  }
  if (configQuery.isLoading || !configQuery.data) {
    return (
      <div style={styles.loading}>
        <Spinner size={18} /> Loading printer config…
      </div>
    );
  }

  const cfg = configQuery.data;

  return (
    <>
      <PrinterRoleCard
        role="receipt"
        title="Receipt printer"
        subtitle="Customer receipts at payment."
        config={cfg.receipt}
        connected={statusQuery.data?.receipt ?? null}
        onSave={(next) => saveMutation.mutate({ receipt: next })}
      />
      <PrinterRoleCard
        role="kitchen"
        title="Kitchen printer"
        subtitle="Comanda printed when items are sent to the kitchen."
        config={cfg.kitchen}
        connected={statusQuery.data?.kitchen ?? null}
        onSave={(next) => saveMutation.mutate({ kitchen: next })}
      />
    </>
  );
}

// On Capacitor (mobile), the tablet talks to backend printers over the LAN —
// it has no local printer access of its own. Show a read-only status panel
// fetched from /print/status, with a pointer to the admin web for changes
// (printer IPs / paper width are global business settings, not per-device).
function RemotePrinterStatus() {
  const platform = getPlatformId();
  const remote = platform === 'capacitor';

  const statusQuery = useQuery({
    queryKey: ['printer-status', 'remote'],
    queryFn: getPrinterStatus,
    enabled: remote,
    refetchInterval: 30_000,
  });

  if (!remote) {
    return (
      <div style={styles.empty}>
        Printer setup only works inside the Electron or mobile app.
      </div>
    );
  }

  if (statusQuery.isLoading || !statusQuery.data) {
    return (
      <div style={styles.loading}>
        <Spinner size={18} /> Checking printer status…
      </div>
    );
  }

  if (statusQuery.isError) {
    return (
      <div style={styles.empty}>
        Couldn't reach the server to check printer status.
      </div>
    );
  }

  const status = statusQuery.data;
  return (
    <>
      <RemotePrinterCard
        title="Receipt printer"
        subtitle="Customer receipts at payment."
        role={status.receipt}
      />
      <RemotePrinterCard
        title="Kitchen printer"
        subtitle="Comanda printed when items are sent to the kitchen."
        role={status.kitchen}
      />
      <div style={{ ...styles.cardSub, marginTop: 4 }}>
        Printer IPs and paper width are configured in the admin web panel
        (Settings → Printers). Changes apply to every device.
      </div>
    </>
  );
}

interface RemotePrinterCardProps {
  title: string;
  subtitle: string;
  role: { configured: boolean; connected: boolean; ip: string; port: number };
}

function RemotePrinterCard({ title, subtitle, role }: RemotePrinterCardProps) {
  const dotColor = !role.configured
    ? 'var(--text3)'
    : role.connected
      ? 'var(--green)'
      : 'var(--red)';
  const label = !role.configured
    ? 'Not configured'
    : role.connected
      ? 'Connected'
      : 'Unreachable';
  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>{title}</h3>
          <div style={styles.cardSub}>{subtitle}</div>
        </div>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--text2)',
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: dotColor,
            }}
          />
          {label}
        </div>
      </div>
      <div style={{ fontSize: 13, color: 'var(--text2)' }}>
        {role.configured ? `${role.ip}:${role.port}` : '—'}
      </div>
    </div>
  );
}

interface PrinterRoleCardProps {
  role: PrinterRole;
  title: string;
  subtitle: string;
  config: PrinterRoleConfig;
  connected: boolean | null;
  onSave: (next: PrinterRoleConfig) => void;
}

function PrinterRoleCard(props: PrinterRoleCardProps) {
  const { role, title, subtitle, config, connected, onSave } = props;
  const [draft, setDraft] = useState<PrinterRoleConfig>(config);
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // Keep the form in sync when the parent re-fetches the config (e.g. after
  // the user saves another section). Only rebase if the saved config genuinely
  // differs — otherwise typing into a field would constantly clobber itself.
  useEffect(() => {
    setDraft(config);
  }, [config]);

  const dirty =
    draft.enabled !== config.enabled ||
    draft.type !== config.type ||
    draft.connection !== config.connection ||
    draft.address !== config.address ||
    draft.width !== config.width ||
    draft.characterSet !== config.characterSet;

  async function runTest() {
    if (!window.electron) return;
    setTestResult(null);
    setTesting(true);
    try {
      const result = await window.electron.printer.testPrint(role);
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: (err as Error).message });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>{title}</h3>
          <div style={styles.cardSub}>{subtitle}</div>
        </div>
        <span style={statusPillStyle(config.enabled ? connected : null)}>
          <span style={statusDotStyle(config.enabled ? connected : null)} />
          {!config.enabled
            ? 'Disabled'
            : connected === null
              ? 'Checking…'
              : connected
                ? 'Connected'
                : 'Offline'}
        </span>
      </div>

      <div style={styles.toggleRow}>
        <input
          type="checkbox"
          id={`enable-${role}`}
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          style={{ width: 18, height: 18, cursor: 'pointer' }}
        />
        <label htmlFor={`enable-${role}`} style={styles.toggleLabel}>
          Enable {role} printing
        </label>
      </div>

      <div style={{ ...styles.fieldRow, marginTop: 16 }}>
        <div style={styles.field}>
          <label style={styles.label}>Connection</label>
          <select
            style={styles.select}
            value={draft.connection}
            onChange={(e) =>
              setDraft({ ...draft, connection: e.target.value as PrinterConnection })
            }
          >
            <option value="network">Network (TCP)</option>
            <option value="usb">USB / Serial</option>
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Printer model</label>
          <select
            style={styles.select}
            value={draft.type}
            onChange={(e) =>
              setDraft({ ...draft, type: e.target.value as PrinterRoleConfig['type'] })
            }
          >
            {PRINTER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.field}>
        <label style={styles.label}>
          {draft.connection === 'network' ? 'IP address (host or host:port)' : 'Device path'}
        </label>
        <input
          style={styles.input}
          value={draft.address}
          placeholder={
            draft.connection === 'network' ? '192.168.1.100:9100' : '/dev/usb/lp0'
          }
          onChange={(e) => setDraft({ ...draft, address: e.target.value })}
        />
        <div style={styles.hint}>
          {draft.connection === 'network'
            ? 'Default port is 9100 if you leave it off.'
            : 'On Linux, ESC/POS USB printers typically appear as /dev/usb/lp0.'}
        </div>
      </div>

      <div style={{ ...styles.fieldRow, marginTop: 12 }}>
        <div style={styles.field}>
          <label style={styles.label}>Paper width (chars)</label>
          <select
            style={styles.select}
            value={draft.width}
            onChange={(e) => setDraft({ ...draft, width: Number(e.target.value) })}
          >
            <option value={32}>32 — 58mm paper</option>
            <option value={42}>42 — 76mm paper</option>
            <option value={48}>48 — 80mm paper</option>
          </select>
        </div>
        <div style={styles.field}>
          <label style={styles.label}>Character set</label>
          <select
            style={styles.select}
            value={draft.characterSet}
            onChange={(e) => setDraft({ ...draft, characterSet: e.target.value })}
          >
            {CHARACTER_SETS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div style={styles.cardActions}>
        <button
          type="button"
          style={styles.primaryBtn}
          onClick={() => onSave(draft)}
          disabled={!dirty}
        >
          Save changes
        </button>
        <button
          type="button"
          style={styles.ghostBtn}
          onClick={() => setDraft(config)}
          disabled={!dirty}
        >
          Reset
        </button>
        <button
          type="button"
          style={styles.goldBtn}
          onClick={runTest}
          disabled={testing || !config.enabled || !config.address}
        >
          {testing ? <Spinner size={12} /> : '🖨'} Test print
        </button>
      </div>

      {testResult && (
        <div style={resultBannerStyle(testResult.ok)}>
          {testResult.ok
            ? 'Test page sent — check the paper.'
            : `Test failed: ${testResult.error ?? 'unknown error'}`}
        </div>
      )}
    </div>
  );
}

// ─── Appearance section ────────────────────────────────────────────────────
// Auto-lock idle timeout. The theme itself is fixed (warm light) per design
// spec, so this section only owns the lock interval. Set 0 to disable.

function AppearanceSection() {
  const idleLockMinutes = usePreferences((s) => s.idleLockMinutes);
  const setIdleLockMinutes = usePreferences((s) => s.setIdleLockMinutes);
  const [draft, setDraft] = useState<string>(String(idleLockMinutes));

  // Keep the local input in sync if another tab updates the persisted value.
  useEffect(() => {
    setDraft(String(idleLockMinutes));
  }, [idleLockMinutes]);

  const parsed = Number(draft);
  const valid = Number.isFinite(parsed) && parsed >= 0 && parsed <= 60;
  const dirty = valid && parsed !== idleLockMinutes;

  return (
    <>
      <UiScaleCard />

      <div style={styles.card}>
        <div style={styles.cardHead}>
          <div>
            <h3 style={styles.cardTitle}>Auto-lock</h3>
            <div style={styles.cardSub}>
              Lock the terminal after inactivity. The cash register stays open;
              the cashier just re-enters their PIN to resume.
            </div>
          </div>
        </div>

        <div style={styles.fieldRow}>
          <div style={styles.field}>
            <label style={styles.label}>Lock after (minutes)</label>
            <input
              type="number"
              min={0}
              max={60}
              step={1}
              style={styles.input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <div style={styles.hint}>
              {parsed === 0
                ? 'Auto-lock disabled — the cashier must lock manually.'
                : `Lock after ${parsed} minute${parsed === 1 ? '' : 's'} of inactivity.`}
            </div>
          </div>
          <div />
        </div>

        <div style={styles.cardActions}>
          <button
            type="button"
            style={styles.primaryBtn}
            disabled={!dirty}
            onClick={() => valid && setIdleLockMinutes(parsed)}
          >
            Save changes
          </button>
          <button
            type="button"
            style={styles.ghostBtn}
            onClick={() => setDraft(String(idleLockMinutes))}
            disabled={!dirty}
          >
            Reset
          </button>
        </div>

        {!valid && (
          <div style={resultBannerStyle(false)}>
            Enter a number between 0 and 60.
          </div>
        )}
      </div>

      <div style={styles.card}>
        <div style={styles.cardHead}>
          <div>
            <h3 style={styles.cardTitle}>Theme</h3>
            <div style={styles.cardSub}>
              The warm light palette is the only supported theme — designed to
              stay readable under café lighting and reduce print-vs-screen
              colour mismatches.
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

// UI scale picker. 100% is the default (= the redesigned compact tablet
// layout). Operators on a small/dense panel can drop to 90%; on a roomier
// 13" tablet they can bump to 110-120% for older eyes. Persisted per-device.
const UI_SCALE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: '80%', value: 0.8 },
  { label: '90%', value: 0.9 },
  { label: '100%', value: 1 },
  { label: '110%', value: 1.1 },
  { label: '120%', value: 1.2 },
  { label: '130%', value: 1.3 },
];

function UiScaleCard() {
  const uiScale = usePreferences((s) => s.uiScale);
  const setUiScale = usePreferences((s) => s.setUiScale);

  return (
    <div style={styles.card}>
      <div style={styles.cardHead}>
        <div>
          <h3 style={styles.cardTitle}>Interface scale</h3>
          <div style={styles.cardSub}>
            Resize every screen at once. 100% matches the default tablet layout;
            increase if text feels small, decrease to fit more on screen.
          </div>
        </div>
      </div>

      <div style={uiScaleStyles.row}>
        {UI_SCALE_OPTIONS.map((opt) => {
          const active = Math.abs(uiScale - opt.value) < 0.01;
          return (
            <button
              key={opt.value}
              type="button"
              style={uiScaleStyles.option(active)}
              onClick={() => setUiScale(opt.value)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>

      <div style={styles.hint}>
        Currently at {Math.round(uiScale * 100)}%. Saved per device.
      </div>
    </div>
  );
}

const uiScaleStyles: {
  row: React.CSSProperties;
  option: (active: boolean) => React.CSSProperties;
} = {
  row: {
    display: 'grid',
    gridTemplateColumns: 'repeat(6, 1fr)',
    gap: 8,
    marginBottom: 10,
  },
  option: (active) => ({
    padding: '10px 6px',
    borderRadius: 8,
    border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
    background: active ? 'var(--text1)' : 'var(--bg2)',
    color: active ? '#fff' : 'var(--text1)',
    fontSize: 13,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 40,
    transition: 'all 0.12s',
  }),
};

// ─── Suggestions section ───────────────────────────────────────────────────
// Admin-only review queue. Cashiers submit suggested changes (new tables,
// product edits, etc.); admin approves or rejects each one. Approval re-runs
// the underlying resource service so domain rules apply at apply-time, not
// just at submit-time.

const SUGGESTION_TYPE_LABELS: Record<Suggestion['type'], string> = {
  TABLE_CREATE: 'New table',
  TABLE_UPDATE: 'Edit table',
  TABLE_DELETE: 'Delete table',
  PRODUCT_CREATE: 'New product',
  PRODUCT_UPDATE: 'Edit product',
  PRODUCT_DELETE: 'Delete product',
};

const STATUS_FILTERS: Array<{ id: 'PENDING' | 'APPROVED' | 'REJECTED'; label: string }> = [
  { id: 'PENDING', label: 'Pending' },
  { id: 'APPROVED', label: 'Approved' },
  { id: 'REJECTED', label: 'Rejected' },
];

const suggestionStyles: Record<string, React.CSSProperties> = {
  filterRow: { display: 'flex', gap: 6, marginBottom: 14 },
  filterPill: {
    padding: '6px 14px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 32,
  },
  card: {
    background: 'var(--bg2)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '16px 18px',
    marginBottom: 12,
  },
  head: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    marginBottom: 10,
    flexWrap: 'wrap' as const,
  },
  typePill: {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.1em',
    textTransform: 'uppercase' as const,
    padding: '3px 9px',
    borderRadius: 999,
    background: 'rgba(201,164,92,0.16)',
    color: '#8a6d2a',
  },
  metaLine: { fontSize: 12, color: 'var(--text2)' },
  payload: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '10px 12px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 11,
    color: 'var(--text2)',
    whiteSpace: 'pre-wrap' as const,
    wordBreak: 'break-word' as const,
    marginTop: 8,
    maxHeight: 180,
    overflowY: 'auto' as const,
  },
  note: {
    fontSize: 13,
    color: 'var(--text1)',
    fontStyle: 'italic' as const,
    marginTop: 8,
    paddingLeft: 10,
    borderLeft: '2px solid var(--border)',
  },
  reviewNote: {
    fontSize: 12,
    color: 'var(--text2)',
    marginTop: 6,
  },
  actions: {
    display: 'flex',
    gap: 8,
    marginTop: 14,
    flexWrap: 'wrap' as const,
  },
  approveBtn: {
    padding: '9px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--green)',
    color: '#fff',
    border: '1px solid var(--green)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 38,
  },
  rejectBtn: {
    padding: '9px 16px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 600,
    background: 'var(--bg2)',
    color: 'var(--red)',
    border: '1px solid rgba(196,80,64,0.35)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    minHeight: 38,
  },
  noteInput: {
    width: '100%',
    padding: '8px 10px',
    borderRadius: 8,
    border: '1px solid var(--border)',
    background: 'var(--bg)',
    fontSize: 12,
    fontFamily: 'inherit',
    color: 'var(--text1)',
    marginTop: 8,
    resize: 'vertical' as const,
    minHeight: 56,
    outline: 'none',
  },
  errBanner: {
    marginTop: 10,
    padding: '8px 10px',
    borderRadius: 8,
    background: 'rgba(196,80,64,0.10)',
    border: '1px solid rgba(196,80,64,0.35)',
    color: 'var(--red)',
    fontSize: 12,
  },
};

const filterPillStyle = (active: boolean): React.CSSProperties => ({
  ...suggestionStyles.filterPill,
  background: active ? 'var(--text1)' : 'var(--bg2)',
  color: active ? '#fff' : 'var(--text2)',
  border: '1px solid ' + (active ? 'var(--text1)' : 'var(--border)'),
});

function SuggestionsSection() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED'>('PENDING');

  const query = useQuery({
    queryKey: ['suggestions', statusFilter],
    queryFn: () => listSuggestions({ status: statusFilter, limit: 100 }),
    refetchInterval: 30_000,
  });

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['suggestions'] });
    // Suggestions can mutate floor + product state on approve, so the
    // floor cache needs to drop too. Cheap to invalidate even on reject.
    queryClient.invalidateQueries({ queryKey: ['floors'] });
    queryClient.invalidateQueries({ queryKey: ['products'] });
  }

  return (
    <>
      <div style={suggestionStyles.filterRow}>
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            type="button"
            style={filterPillStyle(statusFilter === f.id)}
            onClick={() => setStatusFilter(f.id)}
          >
            {f.label}
          </button>
        ))}
      </div>

      {query.isLoading && (
        <div style={styles.empty}>
          <Spinner size={16} />
        </div>
      )}

      {query.data && query.data.items.length === 0 && (
        <div style={styles.empty}>
          No {statusFilter.toLowerCase()} suggestions.
        </div>
      )}

      {query.data?.items.map((s) => (
        <SuggestionCard
          key={s.id}
          suggestion={s}
          onChanged={invalidate}
        />
      ))}
    </>
  );
}

interface SuggestionCardProps {
  suggestion: Suggestion;
  onChanged: () => void;
}

function SuggestionCard({ suggestion, onChanged }: SuggestionCardProps) {
  const [reviewNote, setReviewNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const approveMutation = useMutation({
    mutationFn: () => approveSuggestion(suggestion.id, reviewNote.trim() || undefined),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Approve failed'),
  });
  const rejectMutation = useMutation({
    mutationFn: () => rejectSuggestion(suggestion.id, reviewNote.trim() || undefined),
    onSuccess: () => {
      setError(null);
      onChanged();
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Reject failed'),
  });

  const busy = approveMutation.isPending || rejectMutation.isPending;
  const isPending = suggestion.status === 'PENDING';

  // Friendly summary of what the suggestion proposes — first line of the card.
  const summary = (() => {
    switch (suggestion.type) {
      case 'TABLE_CREATE': {
        const p = suggestion.payload as { number?: number };
        return `Add table${p.number ? ` #${p.number}` : ''}`;
      }
      case 'TABLE_UPDATE':
        return `Edit ${suggestion.table?.label || `Table ${suggestion.table?.number ?? '—'}`}`;
      case 'TABLE_DELETE':
        return `Delete ${suggestion.table?.label || `Table ${suggestion.table?.number ?? '—'}`}`;
      case 'PRODUCT_CREATE': {
        const p = suggestion.payload as { name?: string };
        return `Add product${p.name ? ` "${p.name}"` : ''}`;
      }
      case 'PRODUCT_UPDATE':
        return `Edit product "${suggestion.product?.name ?? '—'}"`;
      case 'PRODUCT_DELETE':
        return `Delete product "${suggestion.product?.name ?? '—'}"`;
    }
  })();

  return (
    <div style={suggestionStyles.card}>
      <div style={suggestionStyles.head}>
        <span style={suggestionStyles.typePill}>{SUGGESTION_TYPE_LABELS[suggestion.type]}</span>
        <strong style={{ fontSize: 14 }}>{summary}</strong>
        <span style={{ flex: 1 }} />
        <span style={suggestionStyles.metaLine}>
          by {suggestion.creator.name} · {new Date(suggestion.created_at).toLocaleString()}
        </span>
      </div>

      {suggestion.note && <div style={suggestionStyles.note}>{suggestion.note}</div>}

      <pre style={suggestionStyles.payload}>
        {JSON.stringify(suggestion.payload, null, 2)}
      </pre>

      {!isPending && suggestion.reviewer && (
        <div style={suggestionStyles.reviewNote}>
          {suggestion.status === 'APPROVED' ? '✓ Approved' : '✕ Rejected'} by{' '}
          {suggestion.reviewer.name}
          {suggestion.reviewed_at &&
            ` · ${new Date(suggestion.reviewed_at).toLocaleString()}`}
          {suggestion.review_note && ` — "${suggestion.review_note}"`}
        </div>
      )}

      {isPending && (
        <>
          <textarea
            style={suggestionStyles.noteInput}
            placeholder="Optional note for the audit log…"
            value={reviewNote}
            onChange={(e) => setReviewNote(e.target.value)}
            disabled={busy}
            maxLength={500}
          />
          {error && <div style={suggestionStyles.errBanner}>{error}</div>}
          <div style={suggestionStyles.actions}>
            <button
              type="button"
              style={suggestionStyles.approveBtn}
              onClick={() => approveMutation.mutate()}
              disabled={busy}
            >
              {approveMutation.isPending ? <Spinner size={12} /> : '✓ Approve'}
            </button>
            <button
              type="button"
              style={suggestionStyles.rejectBtn}
              onClick={() => rejectMutation.mutate()}
              disabled={busy}
            >
              {rejectMutation.isPending ? <Spinner size={12} /> : '✕ Reject'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
