import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { TrendingUp, ShoppingBag, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';

function StatCard({ label, value, sub, color = 'green' }) {
  const colors = {
    green: 'bg-green-50 text-green-700',
    blue: 'bg-blue-50 text-blue-700',
    purple: 'bg-purple-50 text-purple-700',
  };
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-sm mt-1 opacity-80">{label}</div>
      {sub && <div className="text-xs mt-0.5 opacity-60">{sub}</div>}
    </div>
  );
}

function DailyBar({ day, maxRevenue }) {
  const pct = maxRevenue > 0 ? (day.revenue / maxRevenue) * 100 : 0;
  const label = new Date(day.date).toLocaleDateString('ar-JO', { weekday: 'short', month: 'short', day: 'numeric' });
  return (
    <div className="flex items-end gap-2 flex-col" style={{ minWidth: 60 }}>
      <div className="text-xs text-gray-500 font-medium">{day.revenue.toFixed(0)}</div>
      <div className="w-full bg-gray-100 rounded-t-md overflow-hidden" style={{ height: 80 }}>
        <div
          className="w-full bg-green-400 rounded-t-md transition-all duration-500"
          style={{ height: `${pct}%`, minHeight: pct > 0 ? 4 : 0 }}
        />
      </div>
      <div className="text-xs text-gray-400 text-center leading-tight">{label}</div>
    </div>
  );
}

export default function ReportsPage() {
  const [view, setView] = useState('weekly'); // 'daily' | 'weekly'
  const [daily, setDaily] = useState(null);
  const [weekly, setWeekly] = useState(null);
  const [dailyDate, setDailyDate] = useState(new Date().toISOString().split('T')[0]);
  const [loading, setLoading] = useState(false);

  const loadDaily = async (date) => {
    setLoading(true);
    try {
      const res = await api.get('/reports/daily', { params: { date } });
      setDaily(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const loadWeekly = async () => {
    setLoading(true);
    try {
      const res = await api.get('/reports/weekly');
      setWeekly(res.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (view === 'daily') loadDaily(dailyDate);
    else loadWeekly();
  }, [view, dailyDate]);

  const todayStr = new Date().toISOString().split('T')[0];

  const shiftDay = (delta) => {
    const d = new Date(dailyDate);
    d.setDate(d.getDate() + delta);
    setDailyDate(d.toISOString().split('T')[0]);
  };

  const maxRevenue = weekly ? Math.max(...weekly.days.map(d => d.revenue), 1) : 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">التقارير</h1>
        <div className="flex items-center gap-2">
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => setView('daily')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${view === 'daily' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}
            >
              يومي
            </button>
            <button
              onClick={() => setView('weekly')}
              className={`px-3 py-1.5 text-sm rounded-md transition-colors ${view === 'weekly' ? 'bg-white shadow-sm text-gray-800' : 'text-gray-500'}`}
            >
              أسبوعي
            </button>
          </div>
          <button onClick={() => view === 'daily' ? loadDaily(dailyDate) : loadWeekly()}
            className="text-gray-400 hover:text-gray-600 p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {loading && <div className="text-center py-16 text-gray-400">جاري التحميل...</div>}

      {/* ── Daily View ── */}
      {view === 'daily' && !loading && daily && (
        <div>
          {/* Date navigation */}
          <div className="flex items-center gap-3 mb-5">
            <button onClick={() => shiftDay(-1)} className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
              <ChevronRight size={16} className="text-gray-500" />
            </button>
            <span className="text-sm font-medium text-gray-700">
              {new Date(daily.date).toLocaleDateString('ar-JO', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
            </span>
            <button onClick={() => shiftDay(1)} disabled={dailyDate >= todayStr}
              className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-30">
              <ChevronLeft size={16} className="text-gray-500" />
            </button>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <StatCard label="الطلبات" value={daily.total_orders} color="blue" />
            <StatCard label="الإيرادات" value={`${daily.total_revenue.toFixed(2)} JOD`} color="green" />
            {Object.entries(daily.by_status).map(([status, count]) => (
              <StatCard key={status} label={status} value={count} color="purple" />
            ))}
          </div>

          {/* Top items */}
          {daily.top_items.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  <ShoppingBag size={16} className="text-green-500" /> الأصناف الأكثر طلباً
                </h2>
              </div>
              <div className="divide-y divide-gray-50">
                {daily.top_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs text-gray-500 font-medium">{i + 1}</span>
                      <span className="text-sm text-gray-700">{item.name_ar}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {item.count} وحدة · {item.revenue.toFixed(2)} JOD
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {daily.total_orders === 0 && (
            <div className="text-center py-12 text-gray-400">لا توجد طلبات في هذا اليوم</div>
          )}
        </div>
      )}

      {/* ── Weekly View ── */}
      {view === 'weekly' && !loading && weekly && (
        <div>
          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-4 mb-6">
            <StatCard label="إجمالي الطلبات" value={weekly.total_orders} color="blue"
              sub={`${weekly.start_date} — ${weekly.end_date}`} />
            <StatCard label="إجمالي الإيرادات" value={`${weekly.total_revenue.toFixed(2)} JOD`} color="green" />
          </div>

          {/* Bar chart */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 mb-5">
            <h2 className="font-semibold text-gray-800 mb-4 flex items-center gap-2">
              <TrendingUp size={16} className="text-green-500" /> الإيرادات اليومية (JOD)
            </h2>
            <div className="flex items-end gap-3 overflow-x-auto pb-2">
              {weekly.days.map(day => (
                <DailyBar key={day.date} day={day} maxRevenue={maxRevenue} />
              ))}
            </div>
          </div>

          {/* Top items */}
          {weekly.top_items.length > 0 && (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100">
              <div className="px-5 py-4 border-b border-gray-100">
                <h2 className="font-semibold text-gray-800 flex items-center gap-2">
                  <ShoppingBag size={16} className="text-green-500" /> الأصناف الأكثر مبيعاً هذا الأسبوع
                </h2>
              </div>
              <div className="divide-y divide-gray-50">
                {weekly.top_items.map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs text-gray-500 font-medium">{i + 1}</span>
                      <span className="text-sm text-gray-700">{item.name_ar}</span>
                    </div>
                    <div className="text-sm text-gray-500">
                      {item.count} وحدة · {item.revenue.toFixed(2)} JOD
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
