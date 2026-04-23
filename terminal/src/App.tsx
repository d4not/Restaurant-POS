import { HashRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LoginPage } from './pages/LoginPage';
import { FloorPage } from './pages/FloorPage';
import { OrdersListPage } from './pages/OrdersListPage';
import { OrderPage } from './pages/OrderPage';
import { PaymentPage } from './pages/PaymentPage';
import { RegisterPage } from './pages/RegisterPage';
import { PrinterSettingsPage } from './pages/PrinterSettingsPage';
import { TerminalLayout } from './components/layout/TerminalLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { Toaster } from './components/ui/Toaster';
import { defaultPathForRole, useSessionStore } from './store/session';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 2;
      },
      staleTime: 15_000,
    },
  },
});

// Sends the user to their role-default screen. Used for the bare "/" path so
// a deep link or a fresh launch still lands on something useful.
function HomeRedirect() {
  const user = useSessionStore((s) => s.user);
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={defaultPathForRole(user.role)} replace />;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      {/* HashRouter — file:// URLs in a packaged Electron build don't play
          nicely with BrowserRouter's pushState fallback. Hash routing is
          robust in dev (vite dev server) and prod (loaded from disk). */}
      <HashRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <TerminalLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/" element={<HomeRedirect />} />
            <Route path="/floor" element={<FloorPage />} />
            <Route path="/orders" element={<OrdersListPage />} />
            <Route path="/orders/:id" element={<OrderPage />} />
            <Route path="/orders/:id/pay" element={<PaymentPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route path="/settings/printer" element={<PrinterSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </HashRouter>
      <Toaster />
    </QueryClientProvider>
  );
}
