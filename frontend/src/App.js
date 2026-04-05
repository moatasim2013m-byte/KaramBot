import "@/App.css";
import { Suspense, lazy, useEffect, useState } from "react";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "./context/AuthContext";
import { trackSnapchatPageView } from "./utils/snapchatTracking";
import { Navbar } from "./components/Navbar";
import { Footer } from "./components/Footer";
import ScrollToTop from "./components/ScrollToTop";
import { useTranslation } from "./i18n/useT";

const HomePage = lazy(() => import("./pages/HomePage"));
const LoginPage = lazy(() => import("./pages/LoginPage"));
const StaffLoginPage = lazy(() => import("./pages/StaffLoginPage"));
const RegisterPage = lazy(() => import("./pages/RegisterPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const TicketsPage = lazy(() => import("./pages/TicketsPage"));
const BirthdayPage = lazy(() => import("./pages/BirthdayPage"));
const SubscriptionsPage = lazy(() => import("./pages/SubscriptionsPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const PaymentSuccessPage = lazy(() => import("./pages/PaymentSuccessPage"));
const PaymentCancelPage = lazy(() => import("./pages/PaymentCancelPage"));
const PaymentFailedPage = lazy(() => import("./pages/PaymentFailedPage"));
const PaymentPendingPage = lazy(() => import("./pages/PaymentPendingPage"));
const CapitalBankCheckoutPage = lazy(() => import("./pages/CapitalBankCheckoutPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
const NewAdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const StaffPage = lazy(() => import("./pages/StaffPage"));
const ReceptionPage = lazy(() => import("./pages/ReceptionPage"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const PrivacyPage = lazy(() => import("./pages/PrivacyPage"));
const RefundPage = lazy(() => import("./pages/RefundPage"));
const GroupsPage = lazy(() => import("./pages/GroupsPage"));
const HomePartyPage = lazy(() => import("./pages/HomePartyPage"));
const BookingConfirmationPage = lazy(() => import("./pages/BookingConfirmationPage"));
const AboutPage = lazy(() => import("./pages/AboutPage"));
const FAQPage = lazy(() => import("./pages/FAQPage"));
const ContactPage = lazy(() => import("./pages/ContactPage"));
const RulesPage = lazy(() => import("./pages/RulesPage"));
const PricingPage = lazy(() => import("./pages/PricingPage"));
const VerifyEmailPage = lazy(() => import("./pages/VerifyEmailPage"));
const FaqBotWidget = lazy(() => import("./components/FaqBotWidget"));
const PeekabooHappyThemePage = lazy(() => import("./pages/PeekabooHappyThemePage"));

const RouteLoadingFallback = () => (
  <div className="min-h-screen flex items-center justify-center">
    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
  </div>
);

const ProtectedRoute = ({ children, adminOnly = false, staffOnly = false, parentOnly = false }) => {
  const { isAuthenticated, isAdmin, isStaff, loading } = useAuth();

  if (loading) {
    return <RouteLoadingFallback />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (parentOnly && isAdmin) {
    return <Navigate to="/admin" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  if (staffOnly && !isStaff && !isAdmin) {
    return <Navigate to="/" replace />;
  }

  return children;
};

const Layout = ({ children, isCustomerPage = true }) => {
  return (
    <div className={`flex flex-col min-h-screen ${isCustomerPage ? "sky-theme" : ""}`}>
      <Navbar />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
};

const AdminLayout = ({ children }) => {
  return (
    <div className="flex flex-col min-h-screen bg-light">
      <Navbar />
      <main className="flex-1">{children}</main>
    </div>
  );
};

function AppRoutes() {
  useTranslation();

  return (
    <Suspense fallback={<RouteLoadingFallback />}>
      <Routes>
        <Route path="/" element={<Layout><HomePage /></Layout>} />
        <Route path="/peekaboo-happy-theme" element={<Layout><PeekabooHappyThemePage /></Layout>} />
        <Route path="/login" element={<Layout><LoginPage /></Layout>} />
        <Route path="/staff/login" element={<StaffLoginPage />} />
        <Route path="/register" element={<Layout><RegisterPage /></Layout>} />
        <Route path="/verify-email" element={<Layout><VerifyEmailPage /></Layout>} />
        <Route path="/forgot-password" element={<Layout><ForgotPasswordPage /></Layout>} />
        <Route path="/reset-password" element={<Layout><ResetPasswordPage /></Layout>} />
        <Route path="/tickets" element={<Layout><TicketsPage /></Layout>} />
        <Route path="/birthday" element={<Layout><BirthdayPage /></Layout>} />
        <Route path="/subscriptions" element={<Layout><SubscriptionsPage /></Layout>} />
        <Route path="/terms" element={<Layout><TermsPage /></Layout>} />
        <Route path="/privacy" element={<Layout><PrivacyPage /></Layout>} />
        <Route path="/refund" element={<Layout><RefundPage /></Layout>} />
        <Route path="/groups" element={<Layout><GroupsPage /></Layout>} />
        <Route path="/home-party" element={<Layout><HomePartyPage /></Layout>} />
        <Route path="/about" element={<Layout><AboutPage /></Layout>} />
        <Route path="/faq" element={<Layout><FAQPage /></Layout>} />
        <Route path="/contact" element={<Layout><ContactPage /></Layout>} />
        <Route path="/rules" element={<Layout><RulesPage /></Layout>} />
        <Route path="/pricing" element={<Layout><PricingPage /></Layout>} />

        <Route path="/payment/success" element={<Layout><PaymentSuccessPage /></Layout>} />
        <Route path="/payment/failed" element={<Layout><PaymentFailedPage /></Layout>} />
        <Route path="/payment/pending" element={<Layout><PaymentPendingPage /></Layout>} />
        <Route path="/payment/capital-bank/:sessionId" element={<Layout><CapitalBankCheckoutPage /></Layout>} />
        <Route path="/payment/cancel" element={<Layout><PaymentCancelPage /></Layout>} />
        <Route path="/booking-confirmation" element={<Layout><BookingConfirmationPage /></Layout>} />

        <Route
          path="/profile"
          element={
            <ProtectedRoute parentOnly>
              <Layout><ProfilePage /></Layout>
            </ProtectedRoute>
          }
        />

        <Route
          path="/admin"
          element={
            <ProtectedRoute adminOnly>
              <NewAdminLayout />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute adminOnly>
              <NewAdminLayout />
            </ProtectedRoute>
          }
        />

        <Route
          path="/staff"
          element={
            <ProtectedRoute staffOnly>
              <AdminLayout><StaffPage /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/staff/*"
          element={
            <ProtectedRoute staffOnly>
              <AdminLayout><StaffPage /></AdminLayout>
            </ProtectedRoute>
          }
        />
        <Route
          path="/reception"
          element={
            <ProtectedRoute staffOnly>
              <AdminLayout><ReceptionPage /></AdminLayout>
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

function SnapchatPageViewTracker() {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    trackSnapchatPageView({
      pathname: location.pathname,
      user,
    });
  }, [location.pathname, user]);

  return null;
}

function App() {
  const [showFaqWidget, setShowFaqWidget] = useState(false);

  useEffect(() => {
    let timeoutId;
    let idleId;

    const showWidget = () => setShowFaqWidget(true);

    if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      idleId = window.requestIdleCallback(showWidget, { timeout: 1200 });
    } else {
      timeoutId = window.setTimeout(showWidget, 700);
    }

    return () => {
      if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function" && idleId) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  return (
    <BrowserRouter>
      <ScrollToTop />
      <AuthProvider>
        <SnapchatPageViewTracker />
        <AppRoutes />
        {showFaqWidget && (
          <Suspense fallback={null}>
            <FaqBotWidget />
          </Suspense>
        )}
        <Toaster
          position="top-center"
          richColors
          toastOptions={{
            className: "font-body",
          }}
        />
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
