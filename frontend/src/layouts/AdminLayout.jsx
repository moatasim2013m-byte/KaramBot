import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Home, Store, Kanban, Receipt, SlidersHorizontal, Search, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { ATTENTION_EVENT, fleetRow, matchesSearch } from '../components/admin/operatorView';

/**
 * The SHIFT platform shell.
 *
 * Deliberately not the business dashboard: an admin looking after customer accounts and
 * an owner reading their own inbox were sharing one layout, which is what made the panel
 * impossible to place. This shell carries four work places and settings at the bottom;
 * everything account-specific lives inside an account, not in the sidebar.
 *
 * «اليوم» carries the attention count, so a problem is visible from any page. «اليوم» itself
 * announces the count when it loads (the 'shift:attention' event), so the shell only asks the
 * server on the other pages, once a minute.
 *
 * Search (⌘K / Ctrl K) opens from every page and jumps straight into a shop.
 *
 * A platform_admin who also has a business_id lands here regardless. Navigation must not
 * change because of a data accident.
 */

const NAV = [
  { to: '/admin/overview', icon: Home, label: 'اليوم', badge: true },
  { to: '/admin/accounts', icon: Store, label: 'الزبائن' },
  // Where each invited shop is between the link and «اكتمل التفعيل», and who acts next.
  { to: '/admin/onboarding', icon: Kanban, label: 'الانضمام' },
  { to: '/admin/billing', icon: Receipt, label: 'الاشتراكات والدفعات' },
];

/** The attention count for the nav badge: announced by «اليوم», asked for elsewhere. */
function useAttentionCount() {
  const { pathname } = useLocation();
  const [count, setCount] = useState(null);
  const onToday = pathname.startsWith('/admin/overview');

  useEffect(() => {
    const on = (e) => setCount(Number(e.detail) || 0);
    window.addEventListener(ATTENTION_EVENT, on);
    return () => window.removeEventListener(ATTENTION_EVENT, on);
  }, []);

  useEffect(() => {
    if (onToday) return undefined;
    let alive = true;
    const ask = () => api.get('/admin/overview')
      .then((res) => { if (alive) setCount((res.data?.attention || []).length); })
      .catch(() => {}); // a missing badge is not worth an error on every page
    ask();
    const t = setInterval(ask, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [onToday]);

  return count;
}

function Logo({ small = false }) {
  return (
    <span className={`relative inline-block font-display font-bold leading-tight text-white ${small ? 'text-[22px]' : 'text-2xl'}`}>
      شِفت
      <span aria-hidden="true" className="absolute -top-[3px] -left-[11px] w-2 h-2 rounded-sm bg-shift-gold" />
    </span>
  );
}

/** ⌘K: find a shop by name, owner, city or phone and open it. Loads the list when opened. */
function SearchDialog({ onClose }) {
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [rows, setRows] = useState(null);
  const [active, setActive] = useState(0);
  const input = useRef(null);

  useEffect(() => {
    input.current?.focus();
    api.get('/admin/overview')
      .then((res) => setRows((res.data?.accounts || []).map(fleetRow)))
      .catch(() => setRows([]));
  }, []);

  const hits = useMemo(() => (rows || []).filter((r) => matchesSearch(r, q)).slice(0, 8), [rows, q]);
  useEffect(() => setActive(0), [q]);

  const open = (r) => { onClose(); navigate(`/admin/accounts/${r.id}`); };
  const onKey = (e) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && hits[active]) open(hits[active]);
  };

  return (
    <div className="fixed inset-0 z-[60] bg-shift-ink/30 flex items-start justify-center p-4 pt-[12vh]" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="ابحث عن زبون" onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
        <label className="flex items-center gap-3 h-14 px-4 border-b border-shift-line">
          <Search size={18} className="text-shift-muted" aria-hidden="true" />
          <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKey}
            aria-label="ابحث عن زبون" placeholder="الاسم أو الموبايل أو صاحب المحل"
            className="flex-1 min-w-0 bg-transparent border-0 outline-none text-[15px] text-shift-ink placeholder:text-shift-muted" />
          <kbd className="font-mono text-[11px] text-shift-muted border border-shift-line rounded-md px-1.5">Esc</kbd>
        </label>
        <ul role="listbox" className="max-h-[50vh] overflow-y-auto py-1">
          {rows === null && <li className="px-4 py-3 text-sm text-shift-muted">جارٍ التحميل…</li>}
          {rows !== null && hits.length === 0 && <li className="px-4 py-3 text-sm text-shift-muted">لا يوجد زبون بهذا الاسم أو الرقم.</li>}
          {hits.map((r, i) => (
            <li key={r.id} role="option" aria-selected={i === active}>
              <button type="button" onClick={() => open(r)} onMouseEnter={() => setActive(i)}
                className={`w-full text-right flex flex-col px-4 py-2.5 ${i === active ? 'bg-shift-sel' : ''}`}>
                <span className="text-[14.5px] font-semibold text-shift-ink">{r.name}</span>
                <span className="text-[12.5px] text-shift-body">{[r.owner?.first_name, r.city].filter(Boolean).join(' · ')}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

const navItem = ({ isActive }) => `flex items-center gap-3 min-h-[42px] rounded-[10px] text-[14.5px] font-medium transition-colors ${
  isActive
    ? 'px-3 text-white bg-white/[.07] border-r-[3px] border-shift-gold'
    : 'px-[15px] text-shift-navText hover:bg-white/5 hover:text-white'
}`;

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const attention = useAttentionCount();

  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearching(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => { setOpen(false); }, [pathname]);

  const handleLogout = () => { logout(); navigate('/login'); };
  const initial = (user?.name || 'م').trim().charAt(0);

  return (
    <div className="shift-admin flex h-screen bg-shift-canvas text-shift-ink overflow-hidden">
      <aside aria-label="لوحة شِفت" className={`
        fixed inset-y-0 right-0 z-50 w-[248px] bg-shift-ink text-shift-navText flex flex-col gap-[22px] px-3.5 pt-6 pb-[18px]
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : 'translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        <div className="flex items-start justify-between px-2.5">
          <div className="flex flex-col gap-2">
            <Logo />
            <span className="text-[12.5px] text-shift-navMuted">لوحة التشغيل</span>
          </div>
          <button className="lg:hidden w-11 h-11 -m-2 grid place-items-center text-white" onClick={() => setOpen(false)} aria-label="إغلاق">
            <X size={22} />
          </button>
        </div>

        <button type="button" onClick={() => setSearching(true)}
          className="flex items-center gap-2.5 h-10 px-3 rounded-[10px] border border-white/[.12] bg-white/[.04] text-shift-navText text-[13.5px] hover:bg-white/[.07]">
          <Search size={15} aria-hidden="true" />
          ابحث عن زبون
          <kbd dir="ltr" className="mr-auto font-mono text-[11px] text-shift-navMuted border border-white/[.16] rounded-md px-1.5">⌘K</kbd>
        </button>

        <nav className="flex flex-col gap-0.5">
          {NAV.map(({ to, icon: Icon, label, badge }) => (
            <NavLink key={to} to={to} className={navItem}>
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span className="flex-1">{label}</span>
              {badge && attention > 0 && (
                <span className="min-w-[20px] text-center text-xs font-semibold text-white bg-white/15 rounded-full px-[7px] tabular-nums"
                  aria-label={`يحتاج انتباهك: ${attention}`}>
                  {attention}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto flex flex-col gap-2.5">
          <NavLink to="/admin/settings" className={navItem}>
            <SlidersHorizontal size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="flex-1 text-sm">إعدادات المنصة</span>
          </NavLink>
          <div className="flex items-center gap-2.5 px-2.5 pt-3 border-t border-white/[.08]">
            <div aria-hidden="true" className="w-8 h-8 rounded-full bg-shift-ink2 text-[#EAF0F9] grid place-items-center font-semibold text-[13px]">{initial}</div>
            <div className="flex flex-col min-w-0">
              <span className="text-white text-[13.5px] font-medium truncate">{user?.name}</span>
              <span className="text-xs text-shift-navMuted">مدير المنصة</span>
            </div>
            <button type="button" onClick={handleLogout} className="mr-auto min-h-[32px] px-2 text-shift-navMuted hover:text-white text-[12.5px]">
              خروج
            </button>
          </div>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-shift-ink/40 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="h-14 bg-shift-ink flex items-center gap-2 px-2 lg:hidden">
          <button className="w-11 h-11 grid place-items-center text-white" onClick={() => setOpen(true)} aria-label="القائمة">
            <Menu size={22} />
          </button>
          <span className="mr-2.5"><Logo small /></span>
          {attention > 0 && (
            <NavLink to="/admin/overview" className="mr-2 min-w-[22px] h-[22px] px-1.5 rounded-full bg-white/15 text-white text-[11px] font-semibold flex items-center justify-center tabular-nums"
              aria-label={`يحتاج انتباهك: ${attention}`}>
              {attention}
            </NavLink>
          )}
          <button type="button" onClick={() => setSearching(true)} aria-label="ابحث عن زبون" className="mr-auto w-11 h-11 grid place-items-center text-white">
            <Search size={20} />
          </button>
        </header>

        <main className="flex-1 overflow-y-auto px-4 py-5 lg:px-8 lg:pt-7 lg:pb-12">
          <Outlet />
        </main>
      </div>

      {searching && <SearchDialog onClose={() => setSearching(false)} />}
    </div>
  );
}
