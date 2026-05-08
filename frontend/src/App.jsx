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
import BusinessesPage from './pages/admin/BusinessesPage';
import CreateBusinessPage from './pages/admin/CreateBusinessPage';
import BusinessDetailPage from './pages/admin/BusinessDetailPage';
import PrivacyPolicyPage from './pages/PrivacyPolicyPage';
import DataDeletionPage from './pages/DataDeletionPage';

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

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/privacy" element={<PrivacyPolicyPage />} />
          <Route path="/data-deletion" element={<DataDeletionPage />} />
          <Route path="/" element={
            <ProtectedRoute>
              <DashboardLayout />
            </ProtectedRoute>
          }>
            <Route index element={<Navigate to="/overview" replace />} />
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
            <Route path="admin/businesses" element={
              <RoleRoute roles={['platform_admin']}>
                <BusinessesPage />
              </RoleRoute>
            } />
            <Route path="admin/businesses/new" element={
              <RoleRoute roles={['platform_admin']}>
                <CreateBusinessPage />
              </RoleRoute>
            } />
            <Route path="admin/businesses/:id" element={
              <RoleRoute roles={['platform_admin']}>
                <BusinessDetailPage />
              </RoleRoute>
            } />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
