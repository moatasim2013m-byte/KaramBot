import { LogOut } from 'lucide-react';
import { Badge } from '../ui/badge';

/**
 * Desktop sidebar shell for admin/staff dashboards.
 * Hidden on mobile (<md). Uses the existing .admin-sidebar-nav-item
 * styles from /app/frontend/src/index.css so visuals stay consistent.
 *
 * Props:
 *  - logoSrc?: string            Image shown at the top (logo)
 *  - title?:   string            Fallback text when no logo is provided
 *  - navItems: Array<{
 *      id: string,
 *      label: string,
 *      icon: ReactNode,
 *      badge?: number,
 *      badgeVariant?: 'default' | 'danger'
 *    }>
 *  - activeTab: string
 *  - onTabChange: (id: string) => void
 *  - onLogout?: () => void       Shows a logout button at the bottom
 *  - dir?: 'ltr' | 'rtl'         Controls which side the sidebar border sits on
 */
export function Sidebar({
  logoSrc,
  title,
  navItems = [],
  activeTab,
  onTabChange,
  onLogout,
  dir = 'ltr',
}) {
  const isRtl = dir === 'rtl';
  const borderSide = isRtl ? 'border-l' : 'border-r';
  const boxShadow = isRtl
    ? '-4px 0 24px rgba(0,0,0,0.04)'
    : '4px 0 24px rgba(0,0,0,0.04)';
  const badgeSideClass = isRtl ? 'mr-auto' : 'ml-auto';

  return (
    <aside
      className={`hidden md:flex flex-col w-60 flex-shrink-0 bg-white border-border ${borderSide}`}
      style={{
        boxShadow,
        position: 'sticky',
        top: 0,
        height: '100vh',
        overflowY: 'auto',
      }}
      data-testid="dashboard-sidebar"
    >
      <div className="p-5 border-b border-border flex items-center gap-3 min-h-[72px]">
        {logoSrc ? (
          <img src={logoSrc} alt={title || 'Dashboard'} className="h-10 w-auto" />
        ) : (
          <span className="font-heading font-bold text-lg truncate">{title}</span>
        )}
      </div>

      <nav className="flex-1 p-3 space-y-1" aria-label="Primary">
        {navItems.map((item) => {
          const isActive = activeTab === item.id;
          const hasBadge = item.badge != null && Number(item.badge) > 0;
          const badgeColor =
            item.badgeVariant === 'danger'
              ? 'bg-red-500 text-white'
              : 'bg-primary text-primary-foreground';
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onTabChange(item.id)}
              className={`admin-sidebar-nav-item w-full ${isActive ? 'active' : ''}`}
              data-testid={`sidebar-nav-${item.id}`}
              aria-current={isActive ? 'page' : undefined}
            >
              {item.icon}
              <span className="flex-1 text-start truncate">{item.label}</span>
              {hasBadge ? (
                <Badge
                  className={`${badgeSideClass} ${badgeColor} min-w-6 h-6 rounded-full px-1.5 justify-center`}
                >
                  {Number(item.badge) > 99 ? '99+' : item.badge}
                </Badge>
              ) : null}
            </button>
          );
        })}
      </nav>

      {onLogout ? (
        <div className="p-3 border-t border-border">
          <button
            type="button"
            onClick={onLogout}
            className="admin-sidebar-nav-item w-full text-red-500 hover:bg-red-50"
            data-testid="sidebar-logout-btn"
          >
            <LogOut className="h-4 w-4" />
            <span className="flex-1 text-start">Logout</span>
          </button>
        </div>
      ) : null}
    </aside>
  );
}

export default Sidebar;
