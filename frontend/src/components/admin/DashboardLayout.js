import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { MobileNav } from './MobileNav';

/**
 * Shared shell for admin/staff dashboards. Composes Sidebar + Header +
 * MobileNav around page content. Business logic, data fetching, and
 * inner tab content are owned by the calling page - this component
 * only provides the outer chrome.
 *
 * Props:
 *  - title:        string                Page title shown in the header
 *  - subtitle?:    string                Optional helper text
 *  - logoSrc?:     string                Logo shown in sidebar (desktop) and header (mobile)
 *  - navItems:     SidebarItem[]         Items rendered in sidebar + mobile bottom nav
 *  - activeTab:    string                Currently selected tab id
 *  - onTabChange:  (id: string) => void  Called when sidebar/mobile nav items are clicked
 *  - headerActions?: ReactNode           Right-aligned controls in the header
 *  - onLogout?:    () => void            Shows a logout button at the bottom of the sidebar
 *  - dir?:         'ltr' | 'rtl'         Writing direction for the shell
 *  - contentClassName?: string           Extra classes for the inner content wrapper
 *  - mobileNavItems?: SidebarItem[]      Override for mobile bottom nav (defaults to navItems)
 *  - children:     ReactNode             Page body (tabs, panels, etc.)
 */
export function DashboardLayout({
  title,
  subtitle,
  logoSrc,
  navItems = [],
  activeTab,
  onTabChange,
  headerActions,
  onLogout,
  dir = 'ltr',
  contentClassName = '',
  mobileNavItems,
  children,
}) {
  return (
    <div
      className="min-h-screen flex bg-muted/30"
      dir={dir}
      data-testid="dashboard-shell"
    >
      <Sidebar
        logoSrc={logoSrc}
        title={title}
        navItems={navItems}
        activeTab={activeTab}
        onTabChange={onTabChange}
        onLogout={onLogout}
        dir={dir}
      />

      <div className="flex-1 min-w-0 flex flex-col">
        <Header
          title={title}
          subtitle={subtitle}
          logoSrc={logoSrc}
          headerActions={headerActions}
          navItems={navItems}
          activeTab={activeTab}
          onTabChange={onTabChange}
          onLogout={onLogout}
          dir={dir}
        />
        <main
          className={`flex-1 px-4 py-6 sm:px-6 lg:px-8 pb-[calc(7rem+env(safe-area-inset-bottom))] md:pb-8 ${contentClassName}`}
          data-testid="dashboard-content"
        >
          {children}
        </main>
      </div>

      <MobileNav
        navItems={mobileNavItems || navItems}
        activeTab={activeTab}
        onTabChange={onTabChange}
      />
    </div>
  );
}

export default DashboardLayout;
