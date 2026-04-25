import React, { useState } from 'react';
import { Menu, LogOut } from 'lucide-react';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
  SheetClose,
} from '../ui/sheet';

/**
 * Sticky top header for admin/staff dashboards.
 * - On mobile: shows a hamburger button (opens a Sheet with the full nav),
 *   a small logo, and the page title.
 * - On desktop: shows the page title + optional right-aligned actions.
 *
 * The hamburger drawer is essential when the mobile bottom nav has been
 * slimmed (e.g. only Home/Bookings/Inbox) — it gives the user access to the
 * remaining tabs without scrolling a cramped bottom bar.
 *
 * Props:
 *  - title: string
 *  - logoSrc?: string                 Small logo displayed on mobile (next to title)
 *  - subtitle?: string                Optional helper text under the title
 *  - headerActions?: ReactNode        Buttons/controls rendered on the right
 *  - navItems?: SidebarItem[]         If provided, renders a hamburger drawer on mobile
 *  - activeTab?: string
 *  - onTabChange?: (id: string) => void
 *  - onLogout?: () => void
 *  - dir?: 'ltr' | 'rtl'
 */
export function Header({
  title,
  logoSrc,
  subtitle,
  headerActions,
  navItems = [],
  activeTab,
  onTabChange,
  onLogout,
  dir = 'ltr',
}) {
  const [open, setOpen] = useState(false);
  const showDrawer = navItems.length > 0;
  const isRtl = dir === 'rtl';
  const drawerSide = isRtl ? 'right' : 'left';

  const handleNavClick = (id) => {
    onTabChange?.(id);
    setOpen(false);
  };

  const handleLogoutClick = () => {
    setOpen(false);
    onLogout?.();
  };

  return (
    <header
      className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-border"
      data-testid="dashboard-header"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 min-w-0">
          {showDrawer ? (
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <button
                  type="button"
                  className="md:hidden inline-flex items-center justify-center h-9 w-9 rounded-md text-slate-700 hover:bg-slate-100 active:bg-slate-200 transition-colors"
                  aria-label="Open menu"
                  data-testid="mobile-menu-trigger"
                >
                  <Menu className="h-5 w-5" />
                </button>
              </SheetTrigger>
              <SheetContent
                side={drawerSide}
                dir={dir}
                className="w-72 p-0 flex flex-col"
                data-testid="mobile-menu-sheet"
              >
                <SheetHeader className="p-4 border-b border-border">
                  <div className="flex items-center gap-3">
                    {logoSrc ? (
                      <img src={logoSrc} alt="Peekaboo" className="h-8 w-auto" />
                    ) : null}
                    <SheetTitle className="text-base font-bold">
                      {title}
                    </SheetTitle>
                  </div>
                </SheetHeader>
                <nav
                  className="flex-1 overflow-y-auto p-3 space-y-1"
                  aria-label="Primary"
                >
                  {navItems.map((item) => {
                    const isActive = activeTab === item.id;
                    const hasBadge =
                      item.badge != null && Number(item.badge) > 0;
                    const badgeColor =
                      item.badgeVariant === 'danger'
                        ? 'bg-red-500'
                        : 'bg-primary';
                    return (
                      <SheetClose asChild key={item.id}>
                        <button
                          type="button"
                          onClick={() => handleNavClick(item.id)}
                          className={`flex items-center gap-3 w-full ${
                            isRtl ? 'text-right' : 'text-left'
                          } px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                            isActive
                              ? 'bg-primary/10 text-primary'
                              : 'text-slate-700 hover:bg-slate-100'
                          }`}
                          aria-current={isActive ? 'page' : undefined}
                          data-testid={`mobile-menu-item-${item.id}`}
                        >
                          {item.icon}
                          <span className="flex-1 truncate">{item.label}</span>
                          {hasBadge ? (
                            <span
                              className={`min-w-[20px] h-5 px-1.5 rounded-full ${badgeColor} text-white text-[10px] leading-5 text-center font-bold`}
                            >
                              {Number(item.badge) > 99 ? '99+' : item.badge}
                            </span>
                          ) : null}
                        </button>
                      </SheetClose>
                    );
                  })}
                </nav>
                {onLogout ? (
                  <div className="p-3 border-t border-border">
                    <button
                      type="button"
                      onClick={handleLogoutClick}
                      className={`flex items-center gap-3 w-full ${
                        isRtl ? 'text-right' : 'text-left'
                      } px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50`}
                      data-testid="mobile-menu-logout"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>{isRtl ? 'تسجيل الخروج' : 'Logout'}</span>
                    </button>
                  </div>
                ) : null}
              </SheetContent>
            </Sheet>
          ) : null}

          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Peekaboo"
              className="h-8 w-auto md:hidden"
              data-testid="header-mobile-logo"
            />
          ) : null}
          <div className="min-w-0">
            <h1
              className="font-heading text-lg sm:text-xl md:text-2xl font-bold truncate"
              data-testid="dashboard-title"
            >
              {title}
            </h1>
            {subtitle ? (
              <p className="text-xs text-muted-foreground truncate hidden sm:block">
                {subtitle}
              </p>
            ) : null}
          </div>
        </div>
        {headerActions ? (
          <div
            className="flex items-center gap-2 shrink-0"
            data-testid="dashboard-header-actions"
          >
            {headerActions}
          </div>
        ) : null}
      </div>
    </header>
  );
}

export default Header;
