/**
 * Sticky top header for admin/staff dashboards.
 * - On mobile: shows a small logo + page title
 * - On desktop: shows the page title + optional right-aligned actions
 *
 * Props:
 *  - title: string
 *  - logoSrc?: string        Small logo displayed on mobile (next to title)
 *  - subtitle?: string       Optional helper text under the title
 *  - headerActions?: ReactNode   Buttons/controls rendered on the right
 */
export function Header({ title, logoSrc, subtitle, headerActions }) {
  return (
    <header
      className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-border"
      data-testid="dashboard-header"
    >
      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-3 min-w-0">
          {logoSrc ? (
            <img
              src={logoSrc}
              alt="Peekaboo"
              className="h-8 w-auto md:hidden"
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
