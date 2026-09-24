import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, Info, AlertCircle, Inbox } from 'lucide-react';
import api from '../../utils/api';
import {
  Panel, StateCell, Timestamp, Ltr, Num, Freshness, SkeletonRows, EmptyState,
} from '../../components/shared/Primitives';

/**
 * Platform overview — one question per element, and the attention queue is the protagonist.
 *
 * It is not a wall of charts: at roughly ten accounts, the useful screen is "which one needs
 * me, and is everything else fine". Totals are context along the top; the health table shows
 * every account without pagination.
 */

const SEV = {
  critical: { icon: AlertCircle, cls: 'text-red-600', ring: 'bg-red-50' },
  warning: { icon: AlertTriangle, cls: 'text-amber-600', ring: 'bg-amber-50' },
  info: { icon: Info, cls: 'text-gray-500', ring: 'bg-gray-50' },
};

const LIFECYCLE_LABEL = {
  onboarding: 'قيد التوصيل',
  active: 'نشط',
  inactive: 'غير نشط',
  suspended: 'موقوف',
};

function Totals({ totals }) {
  const order = ['onboarding', 'active', 'inactive', 'suspended'];
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 h-12 bg-white border border-gray-200 rounded-lg">
      {order.map((k) => (
        <div key={k} className="flex items-baseline gap-2">
          <Num className="text-[15px] font-semibold text-gray-800">{totals?.[k] ?? '—'}</Num>
          <span className="text-xs text-gray-500">{LIFECYCLE_LABEL[k]}</span>
        </div>
      ))}
    </div>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/overview')
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل حالة المنصة'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // A quiet ops screen goes stale without anyone noticing, so it refreshes itself.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const attention = data?.attention || [];
  const accounts = data?.accounts || [];

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">نظرة عامة على المنصة</h1>
          <p className="text-xs text-gray-500 mt-0.5">حالة حسابات الشركات التي تخدمها شِفت</p>
        </div>
        <Freshness at={data?.generated_at} onRefresh={load} loading={loading} />
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>
      )}

      <Totals totals={data?.totals} />

      {/* The protagonist. When empty it says so in one line — that is the product working. */}
      <Panel title={`يحتاج انتباهك${attention.length ? ` · ${attention.length}` : ''}`}>
        {loading && !data ? (
          <SkeletonRows rows={3} cols={3} />
        ) : attention.length === 0 ? (
          <EmptyState
            icon={CheckCircle2}
            title="كل الحسابات تعمل"
            hint="لا يوجد ما يحتاج تدخلًا الآن"
          />
        ) : (
          <ul className="divide-y divide-gray-100">
            {attention.map((a, i) => {
              const S = SEV[a.severity] || SEV.info;
              const Icon = S.icon;
              return (
                <li key={`${a.business_id}-${a.category}-${i}`} className="flex items-center gap-3 px-4 h-[38px] hover:bg-gray-50 transition-colors">
                  <span className={`shrink-0 ${S.cls}`}><Icon size={15} /></span>
                  <Link to={`/admin/accounts/${a.business_id}`} className="text-[13px] font-medium text-gray-900 hover:underline shrink-0">
                    {a.business_name}
                  </Link>
                  <span className="text-[13px] text-gray-600 truncate flex-1">{a.message}</span>
                  <Timestamp value={a.since} className="text-xs text-gray-400 shrink-0" />
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      <Panel title={`حسابات الشركات${accounts.length ? ` · ${accounts.length}` : ''}`}
        action={<Link to="/admin/accounts" className="text-xs text-gray-500 hover:text-gray-800 underline underline-offset-2">إدارة الحسابات</Link>}>
        {loading && !data ? (
          <SkeletonRows rows={6} cols={5} />
        ) : accounts.length === 0 ? (
          <EmptyState icon={Inbox} tone="neutral" title="لا توجد حسابات بعد" hint="أضف أول حساب شركة للبدء" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                  {['الشركة', 'المرحلة', 'اتصال واتساب', 'الوكيل', 'محادثات مفتوحة', 'آخر رسالة واردة'].map((h) => (
                    <th key={h} className="text-right font-medium px-4 h-9 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 h-9 whitespace-nowrap">
                      <Link to={`/admin/accounts/${a.id}`} className="font-medium text-gray-900 hover:underline">
                        {a.name}
                      </Link>
                    </td>
                    <td className="px-4 h-9 text-gray-600 whitespace-nowrap">{LIFECYCLE_LABEL[a.lifecycle] || a.lifecycle}</td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.connection?.state} label={a.connection?.label} sub={a.connection?.sub} />
                    </td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.agent?.state} label={a.agent?.label} sub={a.agent?.sub} />
                    </td>
                    <td className="px-4 h-9"><Num className="text-gray-700">{a.open_conversations}</Num></td>
                    <td className="px-4 h-9 text-gray-500 whitespace-nowrap"><Timestamp value={a.last_inbound_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Said out loud rather than shown as a healthy-looking blank. */}
      {data?.unavailable?.length > 0 && (
        <p className="text-[11px] text-gray-400 px-1">
          غير متوفر بعد: تقييم الجودة من Meta، فئة الإرسال، ومن غيّر الإعدادات — تحتاج استدعاءات إضافية لواجهة Meta.
        </p>
      )}
    </div>
  );
}
