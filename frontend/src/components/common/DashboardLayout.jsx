import React, { useState, useEffect } from 'react';
import { Outlet, NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import { navFor, shiftWaLink, helpText } from '../whatsapp/panelView';
import {
  Home, MessageSquare, ShoppingBag, UtensilsCrossed, Settings, Users, LogOut, X, Bell,
  Stethoscope, BarChart2, Bot, CreditCard, MoreHorizontal, LifeBuoy, CalendarDays,
} from 'lucide-react';

/**
 * The shop's own panel: «كرم بوت · {اسم المحل}».
 *
 * Phone-first. Most owners open this on the phone the shop's WhatsApp lives on, so below lg the
 * sidebar becomes a bottom tab bar (spec «Customer panel › Navigation»): الرئيسية · المحادثات ·
 * البوت · الطلبات/الاشتراك · المزيد, and staff get only المحادثات · الطلبات. On a desktop the same
 * items sit in the right-hand sidebar. The items come from navFor() so both bars cannot disagree.
 *
 * This is a BUSINESS's dashboard. SHIFT staff have their own shell under /admin and are redirected
 * there on sign-in, so nothing platform-level belongs here.
 */

const ICONS = {
  overview: Home,
  inbox: MessageSquare,
  bot: Bot,
  orders: ShoppingBag,
  menu: UtensilsCrossed,
  clinic: Stethoscope,
  reports: BarChart2,
  staff: Users,
  billing: CreditCard,
  settings: Settings,
  help: LifeBuoy,
};

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const fullBleed = location.pathname === '/inbox';
  const [moreOpen, setMoreOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Conversations with unread messages (it counted open + takeover conversations, which reading could
  // never clear — review, 2026-10-07).
  const calcUnread = (data) => data?.unread || 0;

  // Poll inbox stats for unread badge (SSE disabled to avoid token in URL logs)
  useEffect(() => {
    let cancelled = false;

    const loadUnread = async () => {
      try {
        const res = await api.get('/inbox/v2/stats');
        if (!cancelled) setUnreadCount(calcUnread(res.data));
      } catch (_) {
        // ignore polling errors
      }
    };

    loadUnread();
    // 30 s: the badge is a hint, and the inbox page keeps its own fresher counts.
    const interval = setInterval(loadUnread, 30000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // A page change closes the «المزيد» sheet, whatever was tapped inside it.
  useEffect(() => { setMoreOpen(false); }, [location.pathname]);

  const role = user?.role;
  const bizType = user?.business_type;
  const nav = navFor(role, bizType);
  const helpHref = shiftWaLink(helpText(user));
  const brandShop = user?.business_name || '';
  // The more sheet is «active» when the page open is one of its items, so the tab is lit too.
  const moreActive = nav.more.some((i) => i.to && location.pathname.startsWith(i.to));

  const iconFor = (item) => (item.key === 'orders' && bizType === 'clinic' ? CalendarDays : ICONS[item.key] || Home);
  const badgeFor = (item) => (item.key === 'inbox' ? unreadCount : 0);

  const handleLogout = () => { logout(); navigate('/login'); };

  // The brand tile: the shop's first letter on SHIFT ink, as on the operator console's rows.
  const initial = (brandShop || 'ك').trim().charAt(0) || 'ك';
  const brand = (compact = false) => (
    <div className="flex items-center gap-2.5 min-w-0">
      <span aria-hidden="true" className={`${compact ? 'w-9 h-9 text-[15px]' : 'w-10 h-10 text-[16px]'} shrink-0 rounded-[10px] bg-shift-ink text-shift-gold flex items-center justify-center font-display font-bold`}>
        {initial}
      </span>
      <span className="flex flex-col min-w-0 leading-tight">
        <span className="font-display font-semibold text-[15px] text-shift-ink truncate">{brandShop || 'كرم بوت'}</span>
        <span className="text-[11px] text-shift-muted truncate">{brandShop ? 'كرم بوت' : user?.name}</span>
      </span>
    </div>
  );

  return (
    // 100dvh, not h-screen: on a phone 100vh includes the browser's address bar, which pushed the
    // bottom of every page — the inbox composer first — off the screen.
    <div className="karam-app flex h-[100dvh] bg-shift-canvas text-shift-ink overflow-hidden">
      {/* Sidebar: desktop only. Phones use the bottom bar and the «المزيد» sheet. */}
      <aside className="hidden lg:flex w-64 bg-white border-l border-shift-line flex-col shrink-0">
        <div className="px-4 pt-5 pb-4">
          {brand()}
        </div>

        <nav className="flex-1 px-3 py-1 overflow-y-auto space-y-0.5" aria-label="القائمة">
          {nav.side.map((item) => {
            const Icon = iconFor(item);
            if (item.href) {
              return (
                <a key={item.key} href={helpHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 h-11 rounded-xl text-[14px] text-shift-ok font-medium hover:bg-shift-okBg">
                  <Icon size={18} aria-hidden="true" />
                  <span className="flex-1">{item.label}</span>
                </a>
              );
            }
            const badge = badgeFor(item);
            return (
              <NavLink
                key={item.key}
                to={item.to}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 h-11 rounded-xl text-[14px] transition-colors ${
                    isActive ? 'bg-shift-sel text-shift-selText font-semibold' : 'text-shift-body hover:bg-shift-hover hover:text-shift-ink'
                  }`
                }
              >
                <Icon size={18} aria-hidden="true" />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="bg-shift-danger text-white text-[11px] rounded-full px-1.5 min-w-[20px] h-5 flex items-center justify-center font-bold">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-3 border-t border-shift-line2">
          <div className="px-3 pb-2 text-[12px] text-shift-muted truncate">{user?.name}</div>
          <button onClick={handleLogout}
            className="flex items-center gap-3 px-3 h-10 w-full rounded-xl text-[13px] text-shift-body hover:bg-shift-hover">
            <LogOut size={16} aria-hidden="true" />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar. On phones it carries the brand, since there is no sidebar to hold it. */}
        <header className="bg-white border-b border-shift-line px-4 h-[60px] flex items-center justify-between gap-3 shrink-0">
          <div className="lg:hidden min-w-0">{brand(true)}</div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            {/* The bell opens the waiting chats: the one place an unread count leads. */}
            <button onClick={() => navigate('/inbox')} aria-label="المحادثات"
              className="relative w-11 h-11 flex items-center justify-center rounded-xl text-shift-body hover:bg-shift-hover">
              <Bell size={21} aria-hidden="true" />
              {unreadCount > 0 && (
                <span className="absolute top-2 left-2 min-w-[16px] h-4 px-1 bg-shift-danger rounded-full text-white text-[10px] flex items-center justify-center font-bold">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
          </div>
        </header>

        {/* The inbox runs edge to edge at the real screen height, like WhatsApp: no page padding, and
            the inbox scrolls its own panes instead of the page. Elsewhere the bottom padding keeps
            the last card clear of the phone's tab bar. */}
        <main className={fullBleed ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto p-4 pb-24 lg:p-8 lg:pb-8'}>
          <Outlet />
        </main>

        {/* Bottom tab bar, phones only. 64px tall, so each target is a full thumb. */}
        <nav aria-label="القائمة" className="lg:hidden shrink-0 bg-white border-t border-shift-line flex items-stretch h-16 pb-[env(safe-area-inset-bottom)]">
          {nav.tabs.map((item) => {
            const Icon = iconFor(item);
            const badge = badgeFor(item);
            return (
              <NavLink key={item.key} to={item.to}
                className={({ isActive }) =>
                  `relative flex-1 flex flex-col items-center justify-center gap-1 text-[11px] ${isActive ? 'text-shift-accent font-bold' : 'text-shift-muted font-medium'}`
                }>
                <Icon size={22} strokeWidth={1.8} aria-hidden="true" />
                <span className="truncate max-w-full px-1">{item.label}</span>
                {badge > 0 && (
                  <span className="absolute top-1.5 left-1/2 ml-2 bg-shift-danger text-white text-[10px] font-bold rounded-full px-1 min-w-[16px] h-4 flex items-center justify-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)}
            className={`flex-1 flex flex-col items-center justify-center gap-1 text-[11px] ${moreActive ? 'text-shift-accent font-bold' : 'text-shift-muted font-medium'}`}>
            <MoreHorizontal size={22} strokeWidth={1.8} aria-hidden="true" />
            <span>المزيد</span>
          </button>
        </nav>
      </div>

      {/* «المزيد»: everything that is not a tab, plus help and signing out. */}
      {moreOpen && (
        <div className="karam-app lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-shift-ink/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-shift-canvas rounded-t-3xl pb-[env(safe-area-inset-bottom)] max-h-[80dvh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 h-14">
              <span className="font-display text-[16px] font-semibold text-shift-ink">المزيد</span>
              <button onClick={() => setMoreOpen(false)} aria-label="إغلاق" className="w-11 h-11 flex items-center justify-center rounded-xl text-shift-muted"><X size={18} /></button>
            </div>
            <ul className="mx-4 mb-4 bg-white border border-shift-line rounded-2xl overflow-hidden divide-y divide-shift-line2">
              {nav.more.map((item) => {
                const Icon = iconFor(item);
                if (item.href) {
                  return (
                    <li key={item.key}>
                      <a href={helpHref} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 h-14 text-[14px] font-semibold text-shift-ok active:bg-shift-hover">
                        <span className="w-9 h-9 rounded-[10px] bg-shift-okBg flex items-center justify-center"><Icon size={18} aria-hidden="true" /></span>
                        {item.label}
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={item.key}>
                    <NavLink to={item.to}
                      className={({ isActive }) => `flex items-center gap-3 px-4 h-14 text-[14px] ${isActive ? 'text-shift-selText font-semibold bg-shift-sel' : 'text-shift-ink font-medium active:bg-shift-hover'}`}>
                      <span className="w-9 h-9 rounded-[10px] bg-shift-sel text-shift-selText flex items-center justify-center"><Icon size={18} aria-hidden="true" /></span>
                      {item.label}
                    </NavLink>
                  </li>
                );
              })}
              <li>
                <button onClick={handleLogout} className="flex items-center gap-3 px-4 h-14 w-full text-[14px] text-shift-danger">
                  <span className="w-9 h-9 rounded-[10px] bg-shift-dangerBg flex items-center justify-center"><LogOut size={18} aria-hidden="true" /></span>
                  تسجيل الخروج
                </button>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
