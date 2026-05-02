import React, { useState, useEffect, useRef } from 'react';
import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import api from '../../utils/api';
import {
  LayoutDashboard, MessageSquare, ShoppingBag, UtensilsCrossed,
  Settings, Users, LogOut, Menu, X, Bell, Stethoscope, BarChart2
} from 'lucide-react';

export default function DashboardLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const sseRef = useRef(null);

  const calcUnread = (data) => (data?.open || 0) + (data?.human_takeover || 0);

  // Connect to SSE for real-time inbox badge
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (!token) return;

    const connect = () => {
      // Pass auth token as query param since EventSource doesn't support headers
      const url = `/api/inbox/updates?token=${encodeURIComponent(token)}`;
      const es = new EventSource(url);
      sseRef.current = es;

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);
          if (data.type === 'stats') {
            setUnreadCount(calcUnread(data.data));
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        es.close();
        // Reconnect after 10s on error
        setTimeout(connect, 10000);
      };
    };

    connect();
    return () => sseRef.current?.close();
  }, []);

  // Fallback: fetch initial unread count
  useEffect(() => {
    api.get('/inbox/stats').then(res => {
      setUnreadCount(calcUnread(res.data));
    }).catch(() => {});
  }, []);

  const navItems = [
    { to: '/overview', icon: LayoutDashboard, label: 'الرئيسية' },
    { to: '/inbox', icon: MessageSquare, label: 'صندوق الوارد', badge: unreadCount },
    { to: '/orders', icon: ShoppingBag, label: 'الطلبات' },
    { to: '/menu', icon: UtensilsCrossed, label: 'القائمة' },
    { to: '/clinic', icon: Stethoscope, label: 'العيادة' },
    { to: '/reports', icon: BarChart2, label: 'التقارير' },
    { to: '/staff', icon: Users, label: 'الموظفون' },
    { to: '/settings', icon: Settings, label: 'الإعدادات' },
  ];

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 right-0 z-50 w-64 bg-gray-900 text-white flex flex-col
        transform transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : 'translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-gray-700">
          <div>
            <div className="text-green-400 font-bold text-lg">واتساب AI</div>
            <div className="text-gray-400 text-xs">{user?.name}</div>
          </div>
          <button className="lg:hidden" onClick={() => setSidebarOpen(false)}>
            <X size={20} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 overflow-y-auto">
          {navItems.map(({ to, icon: Icon, label, badge }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
                  isActive
                    ? 'bg-green-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
              {badge > 0 && (
                <span className="bg-red-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center font-medium">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Logout */}
        <div className="p-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 text-gray-400 hover:text-white text-sm w-full px-1 py-2"
          >
            <LogOut size={16} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {/* Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
          <button className="lg:hidden text-gray-600" onClick={() => setSidebarOpen(true)}>
            <Menu size={22} />
          </button>
          <div className="flex items-center gap-3">
            <div className="relative">
              <button className="text-gray-400 hover:text-gray-600">
                <Bell size={20} />
              </button>
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-white text-xs flex items-center justify-center font-medium">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </div>
            <div className="w-8 h-8 rounded-full bg-green-500 flex items-center justify-center text-white text-sm font-bold">
              {user?.name?.[0] || 'م'}
            </div>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
