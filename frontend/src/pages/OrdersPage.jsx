import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { RefreshCw, ChevronDown, Stethoscope, User, Clock } from 'lucide-react';

/**
 * «الطلبات» (restaurants) / «المواعيد» (clinics): what the bot completed in the chat.
 *
 * The line under the title answers the walkthrough's question «من وين بتيجي الطلبات؟»: nobody
 * types them here, the bot fills them in from the conversation, and the conversation itself stays
 * in «المحادثات». A clinic's list is its appointments, the same rows as «الخدمات والأطباء».
 */

function Explainer({ clinic }) {
  return (
    <p className="text-[13px] text-gray-500 -mt-3 mb-4 leading-relaxed">
      {clinic ? 'المواعيد' : 'الطلبات'} التي يتمّها البوت في المحادثة تظهر هنا تلقائيًا، والمحادثة نفسها في{' '}
      <Link to="/inbox" className="text-green-700 underline underline-offset-2">«المحادثات»</Link>.
    </p>
  );
}

const APPT_STATUS_AR = { draft: 'مسودة', confirmed: 'مؤكد', completed: 'منتهي', cancelled: 'ملغى', no_show: 'لم يحضر' };
const APPT_STATUS_COLOR = {
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-blue-100 text-blue-700',
};
const APPT_NEXT = { draft: ['confirmed', 'cancelled'], confirmed: ['completed', 'no_show', 'cancelled'] };

function Appointments() {
  const [items, setItems] = useState(null);
  const [filter, setFilter] = useState('');
  const [error, setError] = useState(null);

  const load = () => {
    api.get('/clinic/appointments', { params: filter ? { status: filter } : {} })
      .then((res) => { setItems(res.data.appointments || []); setError(null); })
      .catch((err) => setError(err.response?.status === 403
        ? 'المواعيد يراها صاحب العيادة والمدير.'
        : (err.response?.data?.error || 'تعذّر تحميل المواعيد')));
  };
  useEffect(load, [filter]);

  const setStatus = async (id, status) => {
    try { await api.patch(`/clinic/appointments/${id}`, { status }); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر الحفظ'); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">المواعيد</h1>
        <div className="flex items-center gap-2">
          <select value={filter} onChange={(e) => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
            <option value="">كل المواعيد</option>
            {Object.entries(APPT_STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <button onClick={load} className="text-gray-400 hover:text-gray-600 p-2" title="تحديث"><RefreshCw size={16} /></button>
        </div>
      </div>
      <Explainer clinic />
      {error && <p className="mb-3 text-[13px] text-red-700">{error}</p>}
      {!items && !error && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}
      <div className="space-y-3">
        {(items || []).map((a) => (
          <div key={a.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="font-medium text-sm text-gray-800">{a.customer_name || a.customer_wa_id || '—'}</div>
                <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap items-center gap-3">
                  {a.service && <span><Stethoscope size={10} className="inline ml-1" />{a.service.name_ar}</span>}
                  {a.doctor && <span><User size={10} className="inline ml-1" />{a.doctor.name_ar}</span>}
                  {a.scheduled_at && (
                    <span><Clock size={10} className="inline ml-1" />
                      {new Date(a.scheduled_at).toLocaleString('ar-JO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </div>
              </div>
              <span className={`shrink-0 text-xs px-2 py-1 rounded-full font-medium ${APPT_STATUS_COLOR[a.status] || 'bg-gray-100 text-gray-600'}`}>
                {APPT_STATUS_AR[a.status] || a.status}
              </span>
            </div>
            {APPT_NEXT[a.status] && (
              <div className="flex gap-2 flex-wrap mt-3">
                {APPT_NEXT[a.status].map((next) => (
                  <button key={next} onClick={() => setStatus(a.id, next)}
                    className={`text-xs px-3 py-1.5 rounded-lg font-medium ${next === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                    {APPT_STATUS_AR[next]}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
        {items && items.length === 0 && <div className="text-center py-16 text-gray-400">لا توجد مواعيد بعد</div>}
      </div>
    </div>
  );
}

const STATUS_AR = {
  draft: 'مسودة',
  awaiting_confirmation: 'ينتظر تأكيد',
  confirmed: 'مؤكد',
  preparing: 'جاري التحضير',
  ready: 'جاهز',
  out_for_delivery: 'في الطريق',
  delivered: 'تم التسليم',
  cancelled: 'ملغى',
};

const STATUS_COLOR = {
  draft: 'bg-yellow-100 text-yellow-700',
  awaiting_confirmation: 'bg-yellow-100 text-yellow-700',
  confirmed: 'bg-green-100 text-green-700',
  preparing: 'bg-blue-100 text-blue-700',
  ready: 'bg-purple-100 text-purple-700',
  out_for_delivery: 'bg-orange-100 text-orange-700',
  delivered: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
};

const NEXT_STATUSES = {
  confirmed: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'delivered', 'cancelled'],
  out_for_delivery: ['delivered', 'cancelled'],
};

export default function OrdersPage() {
  const { user } = useAuth();
  if (user?.business_type === 'clinic') return <Appointments />;
  return <Orders />;
}

function Orders() {
  const [orders, setOrders] = useState([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);

  const load = async () => {
    setLoading(true);
    const params = { limit: 100 };
    if (filter) params.status = filter;
    const res = await api.get('/orders', { params });
    setOrders(res.data.orders || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, [filter]);

  // Auto-refresh every 15s
  useEffect(() => {
    const interval = setInterval(load, 15000);
    return () => clearInterval(interval);
  }, [filter]);

  const updateStatus = async (orderId, status) => {
    await api.patch(`/orders/${orderId}/status`, { status });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">الطلبات</h1>
        <div className="flex items-center gap-2">
          <select
            value={filter}
            onChange={e => setFilter(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">كل الطلبات</option>
            {Object.entries(STATUS_AR).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
          <button onClick={load} className="text-gray-400 hover:text-gray-600 p-2">
            <RefreshCw size={16} />
          </button>
        </div>
      </div>
      <Explainer />

      {loading && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}

      <div className="space-y-3">
        {orders.map(order => (
          <div key={order.id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div
              className="px-4 py-3 flex items-center justify-between cursor-pointer hover:bg-gray-50"
              onClick={() => setExpandedId(expandedId === order.id ? null : order.id)}
            >
              <div className="flex items-center gap-3">
                <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[order.status] || 'bg-gray-100 text-gray-600'}`}>
                  {STATUS_AR[order.status] || order.status}
                </span>
                <div>
                  <div className="font-medium text-sm text-gray-800">
                    {order.customer_name || order.customer_wa_id}
                  </div>
                  <div className="text-xs text-gray-400">
                    {order.order_type === 'delivery' ? '🚗 توصيل' : '🏪 استلام'} · {order.items?.length} صنف · {order.total?.toFixed(2)} JOD
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">
                  {new Date(order.created_at).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}
                </span>
                <ChevronDown size={16} className={`text-gray-400 transition-transform ${expandedId === order.id ? 'rotate-180' : ''}`} />
              </div>
            </div>

            {expandedId === order.id && (
              <div className="border-t border-gray-100 px-4 py-3">
                {/* Items */}
                <div className="mb-3">
                  <div className="text-xs font-medium text-gray-500 mb-2">الأصناف</div>
                  {order.items?.map((item, i) => (
                    <div key={i} className="flex items-center justify-between text-sm py-1">
                      <span className="text-gray-700">{item.name_ar} × {item.quantity}</span>
                      <span className="text-gray-500">{item.item_total?.toFixed(2)} JOD</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between text-sm font-semibold mt-2 pt-2 border-t border-gray-100">
                    <span>الإجمالي</span>
                    <span>{order.total?.toFixed(2)} JOD</span>
                  </div>
                </div>

                {/* Details */}
                {order.address && (
                  <div className="text-xs text-gray-500 mb-2">📍 {order.address}</div>
                )}
                {order.notes && (
                  <div className="text-xs text-gray-500 mb-3">📝 {order.notes}</div>
                )}

                {/* Status buttons */}
                {NEXT_STATUSES[order.status] && (
                  <div className="flex gap-2 flex-wrap">
                    {NEXT_STATUSES[order.status].map(nextStatus => (
                      <button
                        key={nextStatus}
                        onClick={() => updateStatus(order.id, nextStatus)}
                        className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                          nextStatus === 'cancelled'
                            ? 'bg-red-50 text-red-600 hover:bg-red-100'
                            : 'bg-green-50 text-green-600 hover:bg-green-100'
                        }`}
                      >
                        {STATUS_AR[nextStatus]}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {!loading && orders.length === 0 && (
          <div className="text-center py-16 text-gray-400">لا توجد طلبات</div>
        )}
      </div>
    </div>
  );
}
