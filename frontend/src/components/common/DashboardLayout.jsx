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

  return (
    // 100dvh, not h-screen: on a phone 100vh includes the browser's address bar, which pushed the
    // bottom of every page — the inbox composer first — off the screen.
    <div className="flex h-[100dvh] bg-gray-50 overflow-hidden">
      {/* Sidebar: desktop only. Phones use the bottom bar and the «المزيد» sheet. */}
      <aside className="hidden lg:flex w-64 bg-gray-900 text-white flex-col shrink-0">
        <div className="p-5 border-b border-gray-700">
          <div className="text-green-400 font-bold text-lg leading-tight">
            كرم بوت{brandShop && <span className="text-white font-semibold"> · {brandShop}</span>}
          </div>
          <div className="text-gray-400 text-xs mt-0.5">{user?.name}</div>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {nav.side.map((item) => {
            const Icon = iconFor(item);
            if (item.href) {
              return (
                <a key={item.key} href={helpHref} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-3 px-5 py-3 text-sm text-gray-300 hover:bg-gray-800 hover:text-white">
                  <Icon size={18} />
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
                  `flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
                    isActive ? 'bg-green-600 text-white' : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                  }`
                }
              >
                <Icon size={18} />
                <span className="flex-1">{item.label}</span>
                {badge > 0 && (
                  <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center font-medium">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-700">
          <button onClick={handleLogout}
            className="flex items-center gap-3 text-gray-400 hover:text-white text-sm w-full px-1 py-2">
            <LogOut size={16} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        {/* Top bar. On phones it carries the brand, since there is no sidebar to hold it. */}
        <header className="bg-white border-b border-gray-200 px-4 h-14 flex items-center justify-between shrink-0">
          <div className="lg:hidden min-w-0 truncate text-[15px] font-bold text-green-700">
            كرم بوت{brandShop && <span className="text-gray-900 font-semibold"> · {brandShop}</span>}
          </div>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-3">
            {/* The bell opens the waiting chats: the one place an unread count leads. */}
            <button onClick={() => navigate('/inbox')} className="relative text-gray-400 hover:text-gray-600 p-1" title="المحادثات">
              <Bell size={20} />
              {unreadCount > 0 && (
                <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-red-500 rounded-full text-white text-[10px] flex items-center justify-center font-medium">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.[0] || 'م'}
            </div>
          </div>
        </header>

        {/* The inbox runs edge to edge at the real screen height, like WhatsApp: no page padding, and
            the inbox scrolls its own panes instead of the page. Elsewhere the bottom padding keeps
            the last card clear of the phone's tab bar. */}
        <main className={fullBleed ? 'flex-1 min-h-0 overflow-hidden' : 'flex-1 overflow-y-auto p-4 pb-24 lg:p-6 lg:pb-6'}>
          <Outlet />
        </main>

        {/* Bottom tab bar, phones only. 56px tall, so each target is a full thumb. */}
        <nav className="lg:hidden shrink-0 bg-white border-t border-gray-200 flex items-stretch h-14 pb-[env(safe-area-inset-bottom)]">
          {nav.tabs.map((item) => {
            const Icon = iconFor(item);
            const badge = badgeFor(item);
            return (
              <NavLink key={item.key} to={item.to}
                className={({ isActive }) =>
                  `relative flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-green-700 font-semibold' : 'text-gray-500'}`
                }>
                <Icon size={20} />
                <span className="truncate max-w-full px-1">{item.label}</span>
                {badge > 0 && (
                  <span className="absolute top-1 left-1/2 ml-2 bg-red-500 text-white text-[10px] rounded-full px-1 min-w-[16px] text-center">
                    {badge > 99 ? '99+' : badge}
                  </span>
                )}
              </NavLink>
            );
          })}
          <button type="button" onClick={() => setMoreOpen(true)}
            className={`flex-1 flex flex-col items-center justify-center gap-0.5 text-[11px] ${moreActive ? 'text-green-700 font-semibold' : 'text-gray-500'}`}>
            <MoreHorizontal size={20} />
            <span>المزيد</span>
          </button>
        </nav>
      </div>

      {/* «المزيد»: everything that is not a tab, plus help and signing out. */}
      {moreOpen && (
        <div className="lg:hidden fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMoreOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 bg-white rounded-t-2xl pb-[env(safe-area-inset-bottom)] max-h-[80dvh] overflow-y-auto">
            <div className="flex items-center justify-between px-4 h-12 border-b border-gray-100">
              <span className="text-[14px] font-semibold text-gray-900">المزيد</span>
              <button onClick={() => setMoreOpen(false)} className="text-gray-400 p-2" title="إغلاق"><X size={18} /></button>
            </div>
            <ul className="py-1">
              {nav.more.map((item) => {
                const Icon = iconFor(item);
                if (item.href) {
                  return (
                    <li key={item.key}>
                      <a href={helpHref} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-3 px-4 h-12 text-[14px] text-gray-800 active:bg-gray-50">
                        <Icon size={18} className="text-green-600" /> {item.label}
                      </a>
                    </li>
                  );
                }
                return (
                  <li key={item.key}>
                    <NavLink to={item.to}
                      className={({ isActive }) => `flex items-center gap-3 px-4 h-12 text-[14px] ${isActive ? 'text-green-700 font-semibold bg-green-50' : 'text-gray-800 active:bg-gray-50'}`}>
                      <Icon size={18} className="text-gray-500" /> {item.label}
                    </NavLink>
                  </li>
                );
              })}
              <li className="border-t border-gray-100 mt-1">
                <button onClick={handleLogout} className="flex items-center gap-3 px-4 h-12 w-full text-[14px] text-gray-600">
                  <LogOut size={18} className="text-gray-400" /> تسجيل الخروج
                </button>
              </li>
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
