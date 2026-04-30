import React from 'react';

/**
 * Bottom tab bar visible only on mobile (<md). Mirrors the nav items from
 * the desktop <Sidebar /> so both screens share the same tab model.
 *
 * iOS safe-area: padding-bottom respects env(safe-area-inset-bottom) so the
 * home-indicator on iPhone X+ doesn't overlap buttons.
 *
 * Props:
 *  - navItems: Array<{ id, label, icon, badge?, badgeVariant? }>
 *  - activeTab: string
 *  - onTabChange: (id: string) => void
 */
export function MobileNav({ navItems = [], activeTab, onTabChange }) {
  if (!navItems.length) return null;

  return (
    <nav
      className="md:hidden fixed bottom-0 left-0 right-0 bg-white/95 backdrop-blur border-t border-border shadow-lg flex justify-around pt-2 z-50"
      style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 14px)' }}
      aria-label="Primary mobile"
      data-testid="mobile-bottom-nav"
    >
      {navItems.map((item) => {
        const isActive = activeTab === item.id;
        const hasBadge = item.badge != null && Number(item.badge) > 0;
        // Brand-locked badge (yellow-400 default, red for danger). The previous
        // hard-coded `text-white` is dropped from the rendered className so the
        // text color comes from `badgeColor` itself — required for legible
        // numbers on the lighter yellow background.
        const badgeColor =
          item.badgeVariant === 'danger'
            ? 'bg-red-500 text-white'
            : 'bg-yellow-400 text-slate-900';
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onTabChange(item.id)}
            className={`relative flex flex-col items-center justify-center gap-0.5 px-2 py-1.5 min-w-[52px] flex-1 text-[10px] font-medium transition-colors ${
              isActive ? 'text-orange-600' : 'text-muted-foreground'
            }`}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`mobile-nav-${item.id}`}
          >
            {item.icon}
            <span className="truncate max-w-[72px] leading-tight">
              {item.label}
            </span>
            {hasBadge ? (
              <span
                className={`absolute top-0 right-1 min-w-[18px] h-[18px] px-1 rounded-full ${badgeColor} text-[10px] leading-[18px] text-center font-bold`}
              >
                {Number(item.badge) > 99 ? '99+' : item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </nav>
  );
}

export default MobileNav;
