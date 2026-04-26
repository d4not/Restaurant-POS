import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { TopBar } from './components/TopBar';
import { SettingsModal } from './components/SettingsModal';
import { ConfirmDialogHost } from './components/ConfirmDialog';
import { PinLogin } from './pages/PinLogin';
import { ActiveOrders } from './pages/ActiveOrders';
import { FloorPlan } from './pages/FloorPlan';
import { OrderHistory } from './pages/OrderHistory';
import { TableDetail } from './pages/TableDetail';
import { useSession } from './store/session';
import { useUi } from './store/ui';
import { fetchMe } from './api/auth';
import { useAutoLock } from './hooks/useAutoLock';

const shellStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100vh',
  width: '100vw',
  overflow: 'hidden',
  background: 'var(--bg)',
};

export function App() {
  const token = useSession((s) => s.token);
  const user = useSession((s) => s.user);
  const locked = useSession((s) => s.locked);
  const view = useUi((s) => s.view);

  // Validate the persisted token on cold start. /auth/me bounces on 401 and
  // the api client wipes the session — that round-trip is what routes the
  // user back to the PIN screen after a server-side password change.
  const meQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: fetchMe,
    enabled: Boolean(token && user),
    staleTime: 60_000,
  });

  // Keep the cached `user` fresh when /auth/me returns updated info (e.g. the
  // admin renames the cashier mid-shift). The token stays put.
  useEffect(() => {
    if (meQuery.data) {
      const session = useSession.getState();
      if (session.token) {
        useSession.setState({ user: meQuery.data });
      }
    }
  }, [meQuery.data]);

  const authed = Boolean(token && user) && !locked;

  // Belt-and-suspenders for the role gate: even if `view` ends up as 'history'
  // (e.g. stale state on a role downgrade), waiters never see the screen.
  const role = user?.role ?? 'WAITER';
  const historyUnlocked = useUi((s) => s.historyUnlocked);
  const setView = useUi((s) => s.setView);
  useEffect(() => {
    if (view === 'history' && (role === 'WAITER' || !historyUnlocked)) {
      setView('orders');
    }
  }, [view, role, historyUnlocked, setView]);

  // Idle auto-lock: only counts down while the user is fully authed and the
  // screen isn't already locked. The hook itself no-ops when `active` is false
  // so unmounting around the PinLogin early-return isn't required.
  useAutoLock(authed);

  if (!authed) {
    return <PinLogin />;
  }

  return (
    <div style={shellStyle}>
      <TopBar />
      <main style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {view === 'orders' && <ActiveOrders />}
        {view === 'floor' && <FloorPlan />}
        {view === 'history' && <OrderHistory />}
        {view === 'detail' && <TableDetail />}
      </main>
      <SettingsModal />
      <ConfirmDialogHost />
    </div>
  );
}
