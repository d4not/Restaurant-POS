import { useEffect, useState } from 'react';
import { getBridge } from '../platform';

const styles: Record<string, React.CSSProperties> = {
  banner: {
    background: '#d97a2c',
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
    gap: 8,
    borderBottom: '1px solid rgba(0,0,0,0.12)',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: '50%',
    background: '#fff',
    opacity: 0.85,
  },
};

// Persistent banner mounted at the top of the shell. Driven by the platform
// bridge's network adapter so the source of truth is the same on Electron
// (navigator.onLine) and Capacitor (@capacitor/network's connectivity events).
// Renders nothing while online to avoid stealing pixels from the topbar.
export function OfflineBanner() {
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const bridge = getBridge();
    let cancelled = false;
    bridge.network
      .isConnected()
      .then((value) => {
        if (!cancelled) setOnline(value);
      })
      .catch(() => {
        // Probe failure shouldn't lie to the user — assume online so we don't
        // show a permanent banner on a desktop build that lacks the API.
        if (!cancelled) setOnline(true);
      });
    const dispose = bridge.network.onStatusChange((value) => {
      setOnline(value);
    });
    return () => {
      cancelled = true;
      dispose();
    };
  }, []);

  if (online) return null;
  return (
    <div style={styles.banner} role="status" aria-live="polite">
      <span style={styles.dot} />
      Offline — actions will fail until the connection is back.
    </div>
  );
}
