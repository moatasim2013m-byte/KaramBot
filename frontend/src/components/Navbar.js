import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu';
import { useState } from 'react';
import logoImg from '../assets/logo.png';
import mascotImg from '../assets/mascot.png';
import userIcon from '../assets/cartoon-icons/user.svg';
import logoutIcon from '../assets/cartoon-icons/logout.svg';
import dashboardIcon from '../assets/cartoon-icons/dashboard.svg';
import closeIcon from '../assets/cartoon-icons/close.svg';
import teamIcon from '../assets/cartoon-icons/team.svg';

export const Navbar = () => {
  const { user, logout, isAdmin, isStaff, isAuthenticated } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const isActive = (path) => location.pathname === path;
  const isHomePage = location.pathname === '/';

  // Single source of truth for navigation items (same order for desktop & mobile)
  const navItems = [
    { path: '/tickets', label: 'تذاكر بالساعة', pill: 'pill-blue', testId: 'nav-tickets' },
    { path: '/birthday', label: 'حفلات أعياد الميلاد', pill: 'pill-pink', testId: 'nav-birthday' },
    { path: '/subscriptions', label: 'الاشتراكات', pill: 'pill-yellow', testId: 'nav-subscriptions' },
  ];

  const handleLogout = () => {
    logout();
    navigate('/');
  };

  // Determine if this is customer navbar (not admin/staff)
  const isCustomerNav = !isAdmin && !isStaff;

  return (
    <nav className={`sticky top-0 z-50 ${isCustomerNav ? 'navbar-customer' : 'bg-white border-b border-border shadow-sm'}`} dir="rtl">
      <div className="max-w-7xl xl:max-w-[95rem] 2xl:max-w-[110rem] mx-auto px-3 md:px-6 lg:px-8">
        <div className={`navbar-row flex justify-between items-center py-1 ${isHomePage && isCustomerNav ? 'home-mobile-header min-h-16 flex-wrap md:flex-nowrap gap-y-1' : 'h-16'}`}>
          {/* Logo with Pill Container - wrapped for mobile positioning */}
          <div className={`nav-logo-wrap ${isHomePage && isCustomerNav ? 'mobile-home-logo order-1' : ''}`}>
            <Link to="/" className="brand-logo-link brand-logo-with-shroomi" data-testid="nav-logo">
              <img src={mascotImg} alt="شروومي" className="nav-shroomi-logo" />
              <img src={logoImg} alt="بيكابو" className="brand-logo-lg" />
            </Link>
          </div>

          {/* Customer navigation (hide for staff/admin) */}
          {isCustomerNav && (
            <div className="desktop-nav-links hidden md:flex items-center gap-3">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-pill ${item.pill} ${isActive(item.path) ? 'active' : ''}`}
                  data-testid={item.testId}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}

          {/* Admin/Staff Role Badge - Only for staff */}
          {isAuthenticated && (isAdmin || isStaff) && (
            <div className="hidden md:flex items-center gap-2 px-3 py-1 rounded-full bg-[var(--peekaboo-green)]/10 border border-[var(--peekaboo-green)]">
              <img src={mascotImg} alt="" className="h-6 w-6 rounded-full" />
              <span className="text-xs font-medium text-[var(--text-primary)]">{isAdmin ? 'Admin' : 'Staff'}</span>
            </div>
          )}

          {/* Auth Buttons / User Menu */}
          <div className="desktop-auth-actions hidden md:flex items-center gap-4">
            {isAuthenticated && isAdmin && (
              <Link to="/admin">
                <Button variant="default" className="rounded-full gap-2 bg-primary" data-testid="nav-admin-btn">
                  <img src={dashboardIcon} alt="" className="h-4 w-4" />
                  لوحة التحكم
                </Button>
              </Link>
            )}
            {isAuthenticated && (isStaff || isAdmin) && (
              <>
                <Link to="/reception">
                  <Button variant="outline" className="rounded-full gap-2">
                    الاستقبال
                  </Button>
                </Link>
                {isStaff && !isAdmin && (
                  <Link to="/staff">
                    <Button variant="default" className="rounded-full gap-2 bg-secondary text-secondary-foreground" data-testid="nav-staff-btn">
                      <img src={teamIcon} alt="" className="h-4 w-4" />
                      لوحة الموظفين
                    </Button>
                  </Link>
                )}
              </>
            )}
            {isAuthenticated ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-full gap-2" data-testid="user-menu-trigger">
                    <img src={userIcon} alt="" className="h-4 w-4" />
                    <span>{user?.name}</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  {isCustomerNav && (
                    <DropdownMenuItem onClick={() => navigate('/profile')} data-testid="menu-profile">
                      <img src={userIcon} alt="" className="h-4 w-4 ml-2" />
                      الملف الشخصي
                    </DropdownMenuItem>
                  )}
                  {isAdmin && (
                    <DropdownMenuItem onClick={() => navigate('/admin')} data-testid="menu-admin">
                      <img src={dashboardIcon} alt="" className="h-4 w-4 ml-2" />
                      لوحة التحكم
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} data-testid="menu-logout">
                    <img src={logoutIcon} alt="" className="h-4 w-4 ml-2" />
                    تسجيل الخروج
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <>
                <Link to="/login">
                  <Button variant="outline" className="rounded-full" data-testid="nav-login">
                    تسجيل الدخول
                  </Button>
                </Link>
                <Link to="/register">
                  <Button className="rounded-full btn-playful" data-testid="nav-register">
                    إنشاء حساب
                  </Button>
                </Link>
              </>
            )}
          </div>

          {/* Mobile Navigation - Pills visible on Homepage for customer pages */}
          {isCustomerNav && isHomePage && (
            <div className="mobile-home-headlines order-3 basis-full md:hidden flex flex-wrap items-center justify-center gap-2">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`nav-pill ${item.pill} ${isActive(item.path) ? 'active' : ''}`}
                  data-testid={`mobile-${item.testId}`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          )}

          {/* Mobile Menu Button - hidden on homepage to avoid duplicate navigation */}
          <button
            className={`md:hidden playful-menu-button ${isHomePage ? 'order-1 home-menu-toggle' : ''}`}
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            data-testid="mobile-menu-toggle"
            aria-label={mobileMenuOpen ? 'إغلاق القائمة' : 'فتح القائمة'}
            aria-expanded={mobileMenuOpen}
          >
            <span className="sr-only">القائمة</span>
            <span className="playful-menu-bars" aria-hidden="true">
              {mobileMenuOpen ? (
                <img src={closeIcon} alt="" className="h-5 w-5" />
              ) : (
                <>
                  <span className="menu-bar menu-bar-1" />
                  <span className="menu-bar menu-bar-2" />
                  <span className="menu-bar menu-bar-3" />
                </>
              )}
            </span>
          </button>

          {/* Mobile Auth Buttons on Homepage (customers only) */}
          {isHomePage && isCustomerNav && (
            <div className="mobile-home-auth order-2 basis-full md:hidden flex items-center justify-center gap-2">
              {isAuthenticated ? (
                <Link to="/profile">
                  <Button variant="outline" size="sm" className="rounded-full">
                    <img src={userIcon} alt="" className="h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/register">
                    <Button variant="outline" size="sm" className="rounded-full text-sm">
                      إنشاء حساب
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button size="sm" className="rounded-full btn-playful text-sm">
                      دخول
                    </Button>
                  </Link>
                </>
              )}
            </div>
          )}
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden py-4 border-t border-border">
            {/* Staff Badge - Mobile */}
            {isAuthenticated && (isAdmin || isStaff) && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 rounded bg-[var(--peekaboo-green)]/10 border border-[var(--peekaboo-green)]">
                <img src={mascotImg} alt="" className="h-6 w-6 rounded-full" />
                <span className="text-xs font-medium text-[var(--text-primary)]">{isAdmin ? 'وضع المدير' : 'وضع الموظف'}</span>
              </div>
            )}
            <div className="flex flex-col gap-3">
              {/* Customer navigation */}
              {isCustomerNav && (
                <div className="flex flex-wrap gap-2">
                  {navItems.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      className={`nav-pill ${item.pill} ${isActive(item.path) ? 'active' : ''}`}
                      onClick={() => setMobileMenuOpen(false)}
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              )}
              <div className="border-t border-border pt-4 flex flex-col gap-2">
                {isAuthenticated ? (
                  <>
                    {isCustomerNav && (
                      <Link to="/profile" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="outline" className="w-full rounded-full">الملف الشخصي</Button>
                      </Link>
                    )}
                    {isAdmin && (
                      <Link to="/admin" onClick={() => setMobileMenuOpen(false)}>
                        <Button variant="outline" className="w-full rounded-full">لوحة التحكم</Button>
                      </Link>
                    )}
                    <Button onClick={handleLogout} variant="destructive" className="w-full rounded-full">
                      تسجيل الخروج
                    </Button>
                  </>
                ) : (
                  <>
                    <Link to="/login" onClick={() => setMobileMenuOpen(false)}>
                      <Button variant="outline" className="w-full rounded-full">تسجيل الدخول</Button>
                    </Link>
                    <Link to="/register" onClick={() => setMobileMenuOpen(false)}>
                      <Button className="w-full rounded-full">إنشاء حساب</Button>
                    </Link>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </nav>
  );
};
