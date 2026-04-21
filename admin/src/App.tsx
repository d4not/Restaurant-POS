import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageLayout } from './components/layout/PageLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Don't retry auth failures — let ProtectedRoute bounce to /login.
        if ((error as { status?: number })?.status === 401) return false;
        return failureCount < 2;
      },
      staleTime: 30_000,
    },
  },
});

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />

          <Route
            element={
              <ProtectedRoute>
                <PageLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardPage />} />

            {/* Reports */}
            <Route path="reports">
              <Route index element={<Navigate to="sales" replace />} />
              <Route path="sales"          element={<Placeholder title="Ventas" description="Reporte de ventas por rango de fechas." />} />
              <Route path="orders"         element={<Placeholder title="Órdenes" description="Reporte de órdenes por período." />} />
              <Route path="products-sold"  element={<Placeholder title="Productos vendidos" description="Ranking de productos vendidos." />} />
              <Route path="expenses"       element={<Placeholder title="Gastos e ingresos" description="Estado de resultados del mes." />} />
            </Route>

            {/* Inventory */}
            <Route path="inventory">
              <Route index element={<Navigate to="supplies" replace />} />
              <Route path="supplies"   element={<Placeholder title="Insumos" description="Catálogo de insumos con stock por almacén." />} />
              <Route path="supplies/:id" element={<Placeholder title="Detalle de insumo" />} />
              <Route path="movements"  element={<Placeholder title="Movimientos de stock" />} />
              <Route path="suppliers"  element={<Placeholder title="Proveedores" />} />
              <Route path="suppliers/:id" element={<Placeholder title="Detalle de proveedor" />} />
            </Route>

            {/* Menu */}
            <Route path="menu">
              <Route index element={<Navigate to="products" replace />} />
              <Route path="products"     element={<Placeholder title="Productos" description="Catálogo de productos, variantes y recetas." />} />
              <Route path="products/:id" element={<Placeholder title="Detalle de producto" />} />
              <Route path="categories"   element={<Placeholder title="Categorías" description="Árbol de categorías de productos." />} />
            </Route>

            {/* Staff */}
            <Route path="staff">
              <Route index element={<Navigate to="employees" replace />} />
              <Route path="employees"      element={<Placeholder title="Empleados" />} />
              <Route path="cash-registers" element={<Placeholder title="Caja / Turnos" description="Estado del turno actual e historial." />} />
              <Route path="cash-registers/:id" element={<Placeholder title="Detalle de turno" />} />
            </Route>

            {/* Settings */}
            <Route path="settings" element={<Placeholder title="Configuración" description="Ajustes del sistema." />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
