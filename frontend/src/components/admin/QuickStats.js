import React from 'react';

/**
 * QuickStats — compact KPI strip used at the top of dashboard pages.
 *
 * Pure presentational. Accepts an `items` array; each item is a card.
 * Values must come from live state in the parent page — this component
 * never hardcodes data.
 *
 * Props:
 *  - items: Array<{
 *      id?: string,
 *      label: string,            Card title (short)
 *      value: ReactNode,         The big number / formatted string
 *      hint?: ReactNode,         Optional subtext under the value
 *      icon?: ReactNode,         Optional icon (e.g. <DollarSign />)
 *      accent?: 'orange'|'yellow'|'emerald'|'blue'|'red'|'slate'
 *      onClick?: () => void,     Makes the card a button
 *      testId?: string
 *    }>
 *  - className?: string          Extra classes for the outer grid
 *  - dir?: 'ltr' | 'rtl'
 *
 * Usage (admin):
 *   <QuickStats items={[
 *     { label: "Today's Revenue", value: formatCurrency(stats.revenue_today), icon: <DollarSign/>, accent: 'emerald' },
 *     { label: 'Pending Bookings', value: stats.pending_custom_parties || 0, icon: <Clock/>, accent: 'orange' },
 *     { label: 'Active Sessions', value: stats.active_sessions_now || 0, icon: <Users/>, accent: 'blue' },
 *   ]} />
 */
const ACCENT_RING = {
  orange: 'border-orange-200 bg-orange-50',
  yellow: 'border-yellow-200 bg-yellow-50',
  emerald: 'border-emerald-200 bg-emerald-50',
  blue: 'border-blue-200 bg-blue-50',
  red: 'border-red-200 bg-red-50',
  slate: 'border-slate-200 bg-slate-50',
};
const ACCENT_ICON = {
  orange: 'text-orange-600',
  yellow: 'text-yellow-600',
  emerald: 'text-emerald-600',
  blue: 'text-blue-600',
  red: 'text-red-600',
  slate: 'text-slate-600',
};

export function QuickStats({ items = [], className = '', dir = 'ltr' }) {
  if (!items.length) return null;
  const isRtl = dir === 'rtl';

  // Auto-fit grid: 1 col on mobile, 2 on small, up to N on large.
  const cols = Math.min(items.length, 4);
  const gridCols = {
    1: 'sm:grid-cols-1 md:grid-cols-1',
    2: 'sm:grid-cols-2 md:grid-cols-2',
    3: 'sm:grid-cols-2 md:grid-cols-3',
    4: 'sm:grid-cols-2 md:grid-cols-4',
  }[cols];

  return (
    <div
      className={`grid grid-cols-1 ${gridCols} gap-3 sm:gap-4 ${className}`}
      data-testid="quick-stats"
      dir={dir}
    >
      {items.map((item, idx) => {
        const accent = item.accent || 'slate';
        const ringClass = ACCENT_RING[accent] || ACCENT_RING.slate;
        const iconClass = ACCENT_ICON[accent] || ACCENT_ICON.slate;
        const Component = item.onClick ? 'button' : 'div';
        return (
          <Component
            key={item.id || idx}
            type={item.onClick ? 'button' : undefined}
            onClick={item.onClick}
            className={`relative w-full ${isRtl ? 'text-right' : 'text-left'} rounded-2xl border ${ringClass} p-4 sm:p-5 transition-all ${
              item.onClick ? 'hover:shadow-md hover:-translate-y-0.5 cursor-pointer' : ''
            }`}
            data-testid={item.testId || `quick-stat-${item.id || idx}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium text-slate-600 truncate">
                  {item.label}
                </p>
                <p className="mt-1 text-2xl sm:text-3xl font-bold text-slate-900 leading-tight truncate">
                  {item.value}
                </p>
                {item.hint ? (
                  <p className="mt-1 text-[11px] sm:text-xs text-slate-500 truncate">
                    {item.hint}
                  </p>
                ) : null}
              </div>
              {item.icon ? (
                <div
                  className={`shrink-0 h-10 w-10 sm:h-11 sm:w-11 rounded-full bg-white flex items-center justify-center ${iconClass}`}
                  aria-hidden="true"
                >
                  {item.icon}
                </div>
              ) : null}
            </div>
          </Component>
        );
      })}
    </div>
  );
}

export default QuickStats;
