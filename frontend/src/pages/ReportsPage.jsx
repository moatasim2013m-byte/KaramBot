import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { TrendingUp, ShoppingBag, RefreshCw, ChevronLeft, ChevronRight, HelpCircle } from 'lucide-react';
import { countAr } from '../components/whatsapp/panelView';

/**
 * «التقارير» — for every shop, not only restaurants.
 *
 * The page covered orders alone, so a pharmacy or a salon opened it to «لا توجد طلبات». The top is
 * now what every shop has: conversations a day, the bot's replies against the team's, how many were
 * handed to the team, and the questions the bot most often could not answer (from bot_handoff),
 * each a tap away from teaching it on «البوت». Restaurants keep their order charts underneath.
 */

const PERIODS = [{ days: 7, label: '7 أيام' }, { days: 30, label: '30 يومًا' }];

function dayLabel(date, days) {
  const d = new Date(date);
  return days <= 7
    ? d.toLocaleDateString('ar-JO', { weekday: 'short' })
    : String(d.getDate());
}

function Summary() {
  const [days, setDays] = useState(7);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    api.get('/reports/summary', { params: { days } })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل التقرير'));
  }, [days]);

  const perDay = data?.per_day || [];
  const total = (k) => perDay.reduce((n, d) => n + (Number(d[k]) || 0), 0);
  const maxConv = Math.max(1, ...perDay.map((d) => Number(d.conversations) || 0));
  const maxReplies = Math.max(1, ...perDay.map((d) => (Number(d.bot_replies) || 0) + (Number(d.team_replies) || 0)));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-gray-800">التقارير</h1>
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {PERIODS.map((p) => (
            <button key={p.days} type="button" onClick={() => setDays(p.days)}
              className={`px-3 h-8 text-[13px] rounded-md ${days === p.days ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500'}`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">{error}</p>}
      {!data && !error && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}

      {data && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <StatCard label="محادثات" value={countAr(total('conversations'))} color="blue" />
            <StatCard label="ردود البوت" value={countAr(total('bot_replies'))} color="green" />
            <StatCard label="ردود فريقك" value={countAr(total('team_replies'))} color="purple" />
            <StatCard label="تحويلات للفريق" value={countAr(data.handoffs || 0)} color="blue" />
          </div>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <h2 className="text-[14px] font-semibold text-gray-800 mb-3">محادثات يوميًا</h2>
            <div className="flex items-end gap-1 h-28">
              {perDay.map((d) => (
                <div key={d.date} className="flex-1 flex flex-col items-center gap-1 min-w-0" title={`${d.conversations}`}>
                  <div className="w-full bg-sky-400 rounded-t-sm" style={{ height: `${((Number(d.conversations) || 0) / maxConv) * 100}%`, minHeight: d.conversations ? 3 : 0 }} />
                </div>
              ))}
            </div>
            <div className="flex gap-1 mt-1">
              {perDay.map((d, i) => (
                <span key={d.date} className="flex-1 text-center text-[10px] text-gray-400 truncate">
                  {days <= 7 || i % 5 === 0 ? dayLabel(d.date, days) : ''}
                </span>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[14px] font-semibold text-gray-800">ردود البوت مقابل ردود فريقك</h2>
              <span className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-emerald-500" /> البوت</span>
                <span className="inline-flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-violet-400" /> فريقك</span>
              </span>
            </div>
            <div className="flex items-end gap-1 h-28">
              {perDay.map((d) => {
                const bot = Number(d.bot_replies) || 0;
                const team = Number(d.team_replies) || 0;
                return (
                  <div key={d.date} className="flex-1 flex flex-col justify-end min-w-0 h-full" title={`البوت ${bot} · فريقك ${team}`}>
                    <div className="w-full bg-violet-400" style={{ height: `${(team / maxReplies) * 100}%` }} />
                    <div className="w-full bg-emerald-500 rounded-b-sm" style={{ height: `${(bot / maxReplies) * 100}%` }} />
                  </div>
                );
              })}
            </div>
          </section>

          <section className="rounded-xl border border-gray-200 bg-white">
            <header className="flex items-center gap-2 px-4 h-11 border-b border-gray-100">
              <HelpCircle size={15} className="text-amber-600" />
              <h2 className="text-[14px] font-semibold text-gray-800">أكثر ما لم يعرفه البوت</h2>
            </header>
            {(data.top_gaps || []).length === 0 ? (
              <p className="px-4 py-5 text-center text-[13px] text-gray-500">لا أسئلة بلا جواب في هذه الفترة.</p>
            ) : (
              <ul className="divide-y divide-gray-50">
                {data.top_gaps.map((g, i) => (
                  <li key={i} className="flex items-center justify-between gap-3 px-4 py-2.5">
                    <span className="text-[13px] text-gray-800 min-w-0">«{g.question}»</span>
                    <span className="shrink-0 flex items-center gap-3">
                      <span className="text-[12px] text-gray-500 tabular-nums">{g.count}×</span>
                      <Link to="/bot" className="text-[12px] text-green-700 underline underline-offset-2">علّم البوت</Link>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  const { user } = useAuth();
  const restaurant = user?.business_type === 'restaurant';
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <Summary />
      {restaurant && <OrdersReports />}
    </div>
  );
}

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

function OrdersReports() {
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
        <h2 className="text-lg font-bold text-gray-800">الطلبات</h2>
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
