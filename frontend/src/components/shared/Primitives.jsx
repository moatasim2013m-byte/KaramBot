import { useEffect, useState } from 'react';

/**
 * The shared vocabulary of the admin screens.
 *
 * Kept in one file because they only mean anything together: a status dot whose grey is
 * "we do not know", a timestamp that admits staleness, and numerals that line up in a
 * column. Scattering them invites a second, slightly different green.
 */

/* ── State ──────────────────────────────────────────────────────────────────
 * Colour carries state and nothing else — no decorative palette. `unknown` is a
 * hollow ring rather than a filled dot, because telemetry we never received must
 * never read as healthy.
 */
const DOT = {
  ok:       'bg-emerald-500',
  degraded: 'bg-amber-500',
  down:     'bg-red-500',
  idle:     'bg-gray-300',
  unknown:  'bg-transparent border border-gray-400',
};

export function StatusDot({ state = 'unknown', title }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${DOT[state] || DOT.unknown}`}
      title={title}
      aria-label={title}
    />
  );
}

export function StateCell({ state, label, sub }) {
  return (
    <span className="inline-flex items-center gap-2 min-w-0">
      <StatusDot state={state} title={label} />
      <span className="truncate">
        {label}
        {sub && <span className="text-gray-400 text-xs mr-1.5">{sub}</span>}
      </span>
    </span>
  );
}

/* ── Numbers and identifiers ────────────────────────────────────────────────
 * Arabic pages are RTL; identifiers, phone numbers and figures are not. Forcing
 * direction here stops digits reversing, and tabular figures keep a column
 * readable as a column.
 */
export function Ltr({ children, className = '' }) {
  return <span dir="ltr" className={`inline-block tabular-nums ${className}`}>{children}</span>;
}

export function Num({ children, className = '' }) {
  return <span className={`tabular-nums ${className}`}>{children}</span>;
}

/* ── Time ───────────────────────────────────────────────────────────────────
 * Relative by default because "how long has this been broken" is the question
 * being asked; the exact moment is on hover for when it matters.
 */
export function relativeTime(iso, now = Date.now()) {
  if (!iso) return '—';
  const diff = Math.floor((now - new Date(iso).getTime()) / 1000);
  if (Number.isNaN(diff)) return '—';
  if (diff < 45) return 'الآن';
  if (diff < 3600) return `منذ ${Math.floor(diff / 60)} د`;
  if (diff < 86400) return `منذ ${Math.floor(diff / 3600)} س`;
  return `منذ ${Math.floor(diff / 86400)} ي`;
}

export function Timestamp({ value, className = '' }) {
  if (!value) return <span className={`text-gray-400 ${className}`}>—</span>;
  return (
    <span className={className} title={new Date(value).toLocaleString('ar-JO')}>
      {relativeTime(value)}
    </span>
  );
}

/** How fresh the screen itself is — an ops screen that silently goes stale is a liability. */
export function Freshness({ at, onRefresh, loading }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-2 text-xs text-gray-400">
      <span>آخر تحديث {relativeTime(at)}</span>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="text-gray-500 hover:text-gray-800 disabled:opacity-40 underline underline-offset-2"
      >
        تحديث
      </button>
    </div>
  );
}

/* ── Surfaces ───────────────────────────────────────────────────────────── */

export function Panel({ title, action, children, className = '' }) {
  return (
    <section className={`bg-white border border-gray-200 rounded-lg ${className}`}>
      {(title || action) && (
        <header className="flex items-center justify-between px-4 h-11 border-b border-gray-100">
          <h2 className="text-[13px] font-semibold text-gray-700">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Shaped like the table it replaces, so the layout does not jump when data lands. */
export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div className="animate-pulse">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 px-4 h-9 border-b border-gray-50">
          {Array.from({ length: cols }).map((__, c) => (
            <div key={c} className="h-2.5 bg-gray-100 rounded" style={{ width: c === 0 ? '22%' : '14%' }} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** An empty operations screen is the product working. It should look like it. */
export function EmptyState({ icon: Icon, title, hint, tone = 'good' }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      {Icon && (
        <Icon
          size={22}
          className={tone === 'good' ? 'text-emerald-500' : 'text-gray-300'}
        />
      )}
      <p className="mt-2 text-sm font-medium text-gray-700">{title}</p>
      {hint && <p className="mt-1 text-xs text-gray-400">{hint}</p>}
    </div>
  );
}
