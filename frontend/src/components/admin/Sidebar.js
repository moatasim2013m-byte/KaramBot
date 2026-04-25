import { LogOut } from 'lucide-react';
import { Badge } from '../ui/badge';

/**
 * Desktop sidebar shell for admin/staff dashboards.
 * Hidden on mobile (<md). Visual styling for nav items is fully self-contained
 * via the NAV_ITEM_* class constants below — no global CSS dependency.
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

// Equivalent of the former global `.admin-sidebar-nav-item` rule.
// Translated 1:1 from /app/frontend/src/index.css to preserve appearance:
//   gap:12px → gap-3 ; padding:10px 16px → py-2.5 px-4 ;
//   border-radius:10px → rounded-[10px] ; font-size:14px → text-sm ;
//   font-weight:500 → font-medium ; transition:all .15s → transition-all duration-150
const NAV_ITEM_BASE =
  'flex items-center gap-3 py-2.5 px-4 rounded-[10px] text-sm font-medium cursor-pointer transition-all duration-150';
const NAV_ITEM_ACTIVE =
  'bg-primary text-primary-foreground shadow-[0_4px_12px_hsl(var(--primary)/0.3)]';
const NAV_ITEM_INACTIVE =
  'text-muted-foreground hover:bg-muted hover:text-foreground';

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
              className={`${NAV_ITEM_BASE} w-full ${
                isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_INACTIVE
              }`}
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
            className={`${NAV_ITEM_BASE} w-full text-red-500 hover:bg-red-50`}
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
