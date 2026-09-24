import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import DashboardLayout from './components/common/DashboardLayout';
import OverviewPage from './pages/OverviewPage';
import InboxPage from './pages/InboxPage';
import OrdersPage from './pages/OrdersPage';
import MenuPage from './pages/MenuPage';
import SettingsPage from './pages/SettingsPage';
import StaffPage from './pages/StaffPage';
import ClinicPage from './pages/ClinicPage';
import ReportsPage from './pages/ReportsPage';
import AdminLayout from './layouts/AdminLayout';
import AdminOverviewPage from './pages/admin/AdminOverviewPage';
import BusinessesPage from './pages/admin/BusinessesPage';
import CreateBusinessPage from './pages/admin/CreateBusinessPage';
import BusinessDetailPage from './pages/admin/BusinessDetailPage';
import PlatformSettingsPage from './pages/admin/PlatformSettingsPage';
import AccountWorkspacePage from './pages/admin/AccountWorkspacePage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import DataDeletionPage from './pages/DataDeletionPage';
import ActivatePage from './pages/ActivatePage';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-gray-500 text-lg">جاري التحميل...</div>
    </div>
  );
  return user ? children : <Navigate to="/login" replace />;
}

function RoleRoute({ roles, children }) {
  const { user } = useAuth();
  if (!user || !roles.includes(user.role)) return <Navigate to="/overview" replace />;
  return children;
}

/**
 * Where a signed-in user belongs.
 *
 * SHIFT staff go to the platform, business users to their own dashboard — and a
 * platform_admin who also happens to carry a business_id still goes to the platform.
 * That field is a data accident and must not decide what someone sees.
 */
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user?.role === 'platform_admin' ? '/admin/overview' : '/overview'} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          {/* Public: a new customer has no account until they redeem this. */}
          <Route path="/activate/:token" element={<ActivatePage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<HomeRedirect />} />
            <Route path="overview" element={<OverviewPage />} />
            <Route path="inbox" element={<InboxPage />} />
            <Route path="orders" element={<OrdersPage />} />
            <Route path="menu" element={
              <RoleRoute roles={['platform_admin', 'business_owner', 'manager']}>
                <MenuPage />
              </RoleRoute>
            } />
            <Route path="clinic" element={
              <RoleRoute roles={['platform_admin', 'business_owner', 'manager']}>
                <ClinicPage />
              </RoleRoute>
            } />
            <Route path="reports" element={
              <RoleRoute roles={['platform_admin', 'business_owner', 'manager']}>
                <ReportsPage />
              </RoleRoute>
            } />
            <Route path="staff" element={
              <RoleRoute roles={['platform_admin', 'business_owner', 'manager']}>
                <StaffPage />
              </RoleRoute>
            } />
            <Route path="settings" element={
              <RoleRoute roles={['platform_admin', 'business_owner']}>
                <SettingsPage />
              </RoleRoute>
            } />
          </Route>
          {/* SHIFT platform — its own tree, its own shell, never mixed with a business dashboard. */}
          <Route path="/admin" element={
            <ProtectedRoute>
              <RoleRoute roles={['platform_admin']}>
                <AdminLayout />
              </RoleRoute>
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/admin/overview" replace />} />
            <Route path="overview" element={<AdminOverviewPage />} />
            <Route path="accounts" element={<BusinessesPage />} />
            <Route path="accounts/new" element={<CreateBusinessPage />} />
            <Route path="accounts/:id" element={<BusinessDetailPage />} />
            {/* Read-only, audited: every visit is written to admin_access_logs. */}
            <Route path="accounts/:id/conversations" element={<AccountWorkspacePage />} />
            <Route path="settings" element={<PlatformSettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
