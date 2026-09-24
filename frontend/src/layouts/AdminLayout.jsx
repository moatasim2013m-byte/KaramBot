import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LayoutDashboard, Building2, Settings, LogOut, Menu, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * The SHIFT platform shell.
 *
 * Deliberately not the business dashboard: an admin looking after customer accounts and
 * an owner reading their own inbox were sharing one layout, which is what made the panel
 * impossible to place. This shell says whose it is in the header and carries three items
 * only — everything account-specific lives inside an account, not in the sidebar.
 *
 * A platform_admin who also has a business_id lands here regardless. Navigation must not
 * change because of a data accident.
 */

const NAV = [
  { to: '/admin/overview', icon: LayoutDashboard, label: 'نظرة عامة على المنصة' },
  { to: '/admin/accounts', icon: Building2, label: 'حسابات الشركات' },
  { to: '/admin/settings', icon: Settings, label: 'إعدادات المنصة' },
];

export default function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      <aside className={`
        fixed inset-y-0 right-0 z-50 w-64 bg-gray-900 text-white flex flex-col
        transform transition-transform duration-200
        ${open ? 'translate-x-0' : 'translate-x-full'}
        lg:relative lg:translate-x-0
      `}>
        <div className="flex items-center justify-between p-5 border-b border-gray-800">
          <div>
            {/* Names the workspace, so there is never a question which one you are in. */}
            <div className="font-bold text-lg text-white">إدارة منصة SHIFT</div>
            <div className="text-gray-400 text-xs mt-0.5">{user?.name}</div>
          </div>
          <button className="lg:hidden" onClick={() => setOpen(false)} aria-label="إغلاق">
            <X size={20} />
          </button>
        </div>

        <nav className="flex-1 py-4 overflow-y-auto">
          {NAV.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-5 py-3 text-sm transition-colors ${
                  isActive ? 'bg-gray-800 text-white border-r-2 border-green-500' : 'text-gray-400 hover:bg-gray-800/60 hover:text-white'
                }`
              }
            >
              <Icon size={18} />
              <span className="flex-1">{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-4 border-t border-gray-800">
          <button
            onClick={handleLogout}
            className="flex items-center gap-3 text-gray-400 hover:text-white text-sm w-full px-1 py-2"
          >
            <LogOut size={16} />
            تسجيل الخروج
          </button>
        </div>
      </aside>

      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setOpen(false)} />}

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center justify-between lg:hidden">
          <button className="text-gray-600" onClick={() => setOpen(true)} aria-label="القائمة">
            <Menu size={22} />
          </button>
          <span className="text-sm font-semibold text-gray-700">إدارة منصة SHIFT</span>
        </header>

        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
