import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StatusBar, Style } from '@capacitor/status-bar';
import { App } from '@/App';
import { registerPlatform } from '@/platform';
import { setApiBase } from '@/api/client';
import { loadServerUrl, MOBILE_DEFAULT_SERVER_URL } from '@/store/serverUrl';
import { capacitorBridge } from '@mobile/platform/adapters';
import '@/index.css';
import '@mobile/styles/mobile.css';

// Register the Capacitor bridge BEFORE rendering — any module that calls
// getBridge() during initial render (zustand stores, hooks) needs to see the
// real implementation, not the web fallback. Registration is synchronous so
// no top-level await is required.
registerPlatform('capacitor', capacitorBridge);

// Pre-load the server URL preference so the API client's first request goes
// to the right host. If nothing's persisted yet (first launch), seed the
// mobile default so the app is usable out of the box. Failures are non-fatal:
// the legacy resolver in client.ts keeps a working default.
async function bootstrapApiBase(): Promise<void> {
  try {
    const stored = await loadServerUrl();
    setApiBase(stored ?? MOBILE_DEFAULT_SERVER_URL);
  } catch {
    setApiBase(MOBILE_DEFAULT_SERVER_URL);
  }
}

// Match the warm light palette: dark icons/text on cream background. Wrapped
// in catches so emulator builds without the StatusBar plugin can't hang the
// app — the status bar is cosmetic.
async function configureStatusBar(): Promise<void> {
  try {
    await StatusBar.setStyle({ style: Style.Light });
    await StatusBar.setBackgroundColor({ color: '#f5f0e8' });
  } catch {
    /* plugin unavailable in this build / platform */
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Same cadence as the desktop terminal — short staleTime keeps the
      // active orders / floor plan feeling live without a websocket layer.
      staleTime: 5_000,
      refetchOnWindowFocus: false,
      // TanStack Query auto-pauses while offline (we feed onlineManager from
      // the bridge in useNetworkSync), then refetches on reconnect. Keep
      // retry low so a flaky link doesn't stall every action.
      retry: 1,
      retryOnMount: true,
    },
  },
});

async function main(): Promise<void> {
  await Promise.all([bootstrapApiBase(), configureStatusBar()]);
  const root = createRoot(document.getElementById('root')!);
  root.render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

main();
