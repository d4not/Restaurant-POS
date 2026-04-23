import { Outlet } from 'react-router-dom';
import { StatusBar } from './StatusBar';
import { useIdleLock } from '../../hooks/useIdleLock';

// Top-level chrome shared by every authenticated screen. The status bar is
// always visible; everything else paints into the body via the route Outlet.
export function TerminalLayout() {
  // Mounted once at the shell — single idle timer for the whole session.
  useIdleLock();
  return (
    <div className="app-shell">
      <StatusBar />
      <main className="app-body">
        <Outlet />
      </main>
    </div>
  );
}
