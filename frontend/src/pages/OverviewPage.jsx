import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { MessageSquare, ShoppingBag, Users, TrendingUp, Clock, CheckCircle } from 'lucide-react';

function StatCard({ icon: Icon, label, value, color = 'green', sub }) {
  const colors = {
    green: 'bg-green-50 text-green-600',
    blue: 'bg-blue-50 text-blue-600',
    orange: 'bg-orange-50 text-orange-600',
    purple: 'bg-purple-50 text-purple-600',
  };
  return (
    <div className="bg-white rounded-xl p-5 shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <div className={`p-2 rounded-lg ${colors[color]}`}>
          <Icon size={20} />
        </div>
      </div>
      <div className="text-2xl font-bold text-gray-800">{value ?? '—'}</div>
      <div className="text-sm text-gray-500 mt-1">{label}</div>
      {sub && <div className="text-xs text-gray-400 mt-1">{sub}</div>}
    </div>
  );
}

const ORDER_STATUS_AR = {
  confirmed: 'مؤكد',
  preparing: 'جاري التحضير',
  ready: 'جاهز',
  out_for_delivery: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغى',
};

const STATUS_COLOR = {
  confirmed: 'badge-confirmed',
  preparing: 'badge-preparing',
  ready: 'badge-ready',
  out_for_delivery: 'badge-out_for_delivery',
  delivered: 'badge-delivered',
  cancelled: 'badge-cancelled',
};

export default function OverviewPage() {
  const [stats, setStats] = useState(null);
  const [todayOrders, setTodayOrders] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      api.get('/inbox/stats'),
      api.get('/orders/today'),
    ]).then(([statsRes, ordersRes]) => {
      setStats(statsRes.data);
      setTodayOrders(ordersRes.data.orders || []);
    }).catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="text-gray-500 text-center py-20">جاري التحميل...</div>;

  const todaySummary = todayOrders.reduce((acc, o) => {
    if (o.status !== 'cancelled') acc.revenue += o.total || 0;
    acc.count++;
    return acc;
  }, { revenue: 0, count: 0 });

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">لوحة التحكم</h1>
        <p className="text-gray-500 text-sm mt-1">مرحباً! إليك ملخص اليوم.</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard icon={MessageSquare} label="محادثات مفتوحة" value={stats?.open} color="blue" />
        <StatCard icon={Users} label="انتظار موظف" value={stats?.human_takeover} color="orange" />
        <StatCard icon={ShoppingBag} label="طلبات اليوم" value={todaySummary.count} color="green" />
        <StatCard icon={TrendingUp} label="إيرادات اليوم" value={`${todaySummary.revenue.toFixed(2)} JOD`} color="purple" />
      </div>

      {/* Today's orders */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">طلبات اليوم</h2>
          <span className="text-sm text-gray-400">{todayOrders.length} طلب</span>
        </div>

        {todayOrders.length === 0 ? (
          <div className="text-center py-12 text-gray-400">لا توجد طلبات اليوم بعد</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {todayOrders.slice(0, 10).map(order => (
              <div key={order._id} className="px-5 py-3 flex items-center justify-between">
                <div>
                  <div className="font-medium text-sm text-gray-800">
                    {order.customer_name || order.customer_wa_id}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {order.items?.length} صنف · {order.total?.toFixed(2)} JOD
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">
                    {order.order_type === 'delivery' ? '🚗 توصيل' : '🏪 استلام'}
                  </span>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[order.status] || 'bg-gray-100 text-gray-600'}`}>
                    {ORDER_STATUS_AR[order.status] || order.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
