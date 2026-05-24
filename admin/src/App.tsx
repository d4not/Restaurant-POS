import { useEffect } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { PageLayout } from './components/layout/PageLayout';
import { ProtectedRoute } from './components/layout/ProtectedRoute';
import { usePreferencesStore } from './store/preferences';
import { useAuthStore } from './store/auth';
import { syncLanguageFromServer } from './i18n';
import { LoginPage } from './pages/Login';
import { DashboardPage } from './pages/Dashboard';
import { SuppliesPage } from './pages/inventory/SuppliesPage';
import { SupplyEditor } from './pages/inventory/SupplyEditor';
import { SupplyQuickAdd } from './pages/inventory/SupplyQuickAdd';
import { SuppliersPage } from './pages/inventory/SuppliersPage';
import { MovementsPage } from './pages/inventory/MovementsPage';
import { PurchaseOrdersPage } from './pages/inventory/PurchaseOrdersPage';
import { PurchaseOrderCreate } from './pages/inventory/PurchaseOrderCreate';
import { PurchaseOrderDetail } from './pages/inventory/PurchaseOrderDetail';
import { ProductsPage } from './pages/menu/ProductsPage';
import { ProductDetail } from './pages/menu/ProductDetail';
import { CategoriesPage } from './pages/menu/CategoriesPage';
import { EmployeeProductsPage } from './pages/menu/EmployeeProductsPage';
import { OrdersPage } from './pages/orders/OrdersPage';
import { CashRegistersPage } from './pages/staff/CashRegistersPage';
import { ShiftDetail } from './pages/staff/ShiftDetail';
import { EmployeesPage } from './pages/staff/EmployeesPage';
import { EmployeeDetail } from './pages/staff/EmployeeDetail';
import { SalesReport } from './pages/reports/SalesReport';
import { ExpensesReport } from './pages/reports/ExpensesReport';
import { ProductCostsReport } from './pages/reports/ProductCostsReport';
import { ProductsSoldReport } from './pages/reports/ProductsSoldReport';
import { DailyReportsList } from './pages/reports/DailyReportsList';
import { DailyReportDetail } from './pages/reports/DailyReportDetail';
import { ModifierGroupsPage } from './pages/menu/ModifierGroupsPage';
import { ModifierGroupDetail } from './pages/menu/ModifierGroupDetail';
import { SettingsPage } from './pages/settings/SettingsPage';
import { TablesZonesPage } from './pages/system/TablesZonesPage';
import { StoragesPage } from './pages/system/StoragesPage';
import { ReportTemplatePage } from './pages/system/ReportTemplatePage';

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
  // Subscribe to display preferences at the root so a change in Settings
  // (currency, date format) re-renders the whole tree. The `formatMoney` /
  // `formatDate` helpers read from the store directly on every call — they're
  // not hooks, so the subscription must live somewhere React can observe.
  usePreferencesStore((s) => s.currency);
  usePreferencesStore((s) => s.dateFormat);

  // Pull the operator's language preference from the backend once we have a
  // token. Local persisted value is shown until this resolves, so the login
  // page renders in the device's last-known language without a flash.
  const token = useAuthStore((s) => s.token);
  useEffect(() => {
    if (token) void syncLanguageFromServer();
  }, [token]);

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
              <Route path="sales"          element={<SalesReport />} />
              <Route path="products-sold"  element={<ProductsSoldReport />} />
              <Route path="product-costs"  element={<ProductCostsReport />} />
              <Route path="expenses"       element={<ExpensesReport />} />
              <Route path="daily"          element={<DailyReportsList />} />
              <Route path="daily/:id"      element={<DailyReportDetail />} />
            </Route>

            {/* Inventory */}
            <Route path="inventory">
              <Route index element={<Navigate to="supplies" replace />} />
              <Route path="supplies"           element={<SuppliesPage />} />
              <Route path="supplies/new"       element={<SupplyEditor mode="create" />} />
              <Route path="supplies/quick-add" element={<SupplyQuickAdd />} />
              <Route path="supplies/:id"       element={<SupplyEditor mode="edit" />} />
              <Route path="movements"          element={<MovementsPage />} />
              <Route path="purchases"          element={<PurchaseOrdersPage />} />
              <Route path="purchases/new"      element={<PurchaseOrderCreate />} />
              <Route path="purchases/:id"      element={<PurchaseOrderDetail />} />
              <Route path="suppliers"          element={<SuppliersPage />} />
            </Route>

            {/* Menu */}
            <Route path="menu">
              <Route index element={<Navigate to="products" replace />} />
              <Route path="products"          element={<ProductsPage />} />
              <Route path="products/:id"      element={<ProductDetail />} />
              <Route path="modifier-groups"    element={<ModifierGroupsPage />} />
              <Route path="modifier-groups/:id" element={<ModifierGroupDetail />} />
              <Route path="categories"         element={<CategoriesPage />} />
              <Route path="employee-products"  element={<EmployeeProductsPage />} />
            </Route>

            {/* Orders */}
            <Route path="orders" element={<OrdersPage />} />

            {/* Staff */}
            <Route path="staff">
              <Route index element={<Navigate to="employees" replace />} />
              <Route path="employees"          element={<EmployeesPage />} />
              <Route path="employees/:id"      element={<EmployeeDetail />} />
              <Route path="cash-registers"     element={<CashRegistersPage />} />
              <Route path="cash-registers/:id" element={<ShiftDetail />} />
            </Route>

            {/* System */}
            <Route path="system">
              <Route path="tables-zones"    element={<TablesZonesPage />} />
              <Route path="storages"        element={<StoragesPage />} />
              <Route path="report-template" element={<ReportTemplatePage />} />
            </Route>

            {/* Settings */}
            <Route path="settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
