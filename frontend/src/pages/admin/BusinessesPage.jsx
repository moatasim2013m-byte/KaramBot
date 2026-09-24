import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Plus, Search, Building2 } from 'lucide-react';
import api from '../../utils/api';
import {
  Panel, StateCell, Timestamp, Num, Freshness, SkeletonRows, EmptyState,
} from '../../components/shared/Primitives';

/**
 * Customer accounts.
 *
 * Built from the same /admin/overview payload as the platform overview, so the two screens
 * can never disagree about whether an account is healthy. Columns are the questions actually
 * asked of an account — its stage, whether it can receive, whether it answers — not the
 * database's field list. `slug` and raw Meta identifiers moved into the account's own page.
 */

const SOLUTION_SHORT = { karam_bot: 'كرم بوت', automation: 'أتمتة', website: 'موقع', custom: 'مخصص' };
const CONTRACT_STATE = { trial: 'idle', active: 'ok', past_due: 'down', paused: 'degraded' };

function ContractCell({ contract }) {
  if (!contract) return <span className="text-gray-400">بدون عقد</span>;
  const overdue = contract.due_in_days !== null && contract.due_in_days < 0;
  return (
    <StateCell
      state={overdue ? 'down' : (CONTRACT_STATE[contract.status] || 'unknown')}
      label={`${SOLUTION_SHORT[contract.solution] || contract.solution} · ${contract.amount_jod} د.أ`}
      sub={overdue ? `متأخر ${Math.abs(contract.due_in_days)} ي` : (contract.due_in_days !== null && contract.due_in_days <= 7 ? `خلال ${contract.due_in_days} ي` : undefined)}
    />
  );
}

const LIFECYCLE_LABEL = {
  onboarding: 'قيد التوصيل', active: 'نشط', inactive: 'غير نشط', suspended: 'موقوف',
};

const TYPE_LABEL = { restaurant: 'مطعم', clinic: 'عيادة', store: 'متجر', shift: 'شِفت' };

export default function BusinessesPage() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState('all');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/overview')
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الحسابات'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = data?.accounts || [];
  const needsAttention = new Set((data?.attention || []).map((a) => a.business_id));

  // Search and filter exist from the start: "show everything" is fine at ten accounts and
  // becomes unusable without warning at forty.
  const accounts = all.filter((a) => {
    if (filter === 'attention' && !needsAttention.has(a.id)) return false;
    if (filter !== 'all' && filter !== 'attention' && a.lifecycle !== filter) return false;
    if (!q.trim()) return true;
    return a.name.toLowerCase().includes(q.trim().toLowerCase());
  });

  const FILTERS = [
    ['all', `الكل (${all.length})`],
    ['attention', `يحتاج انتباهًا (${needsAttention.size})`],
    ['onboarding', LIFECYCLE_LABEL.onboarding],
    ['active', LIFECYCLE_LABEL.active],
    ['inactive', LIFECYCLE_LABEL.inactive],
  ];

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">حسابات الشركات</h1>
          <p className="text-xs text-gray-500 mt-0.5">الشركات التي تشترك في شِفت</p>
        </div>
        <div className="flex items-center gap-3">
          <Freshness at={data?.generated_at} onRefresh={load} loading={loading} />
          <button
            onClick={() => navigate('/admin/accounts/new')}
            className="flex items-center gap-1.5 bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 transition-colors"
          >
            <Plus size={15} />
            إضافة حساب شركة
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث باسم الشركة"
            className="h-8 w-56 pr-8 pl-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
        </div>
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            onClick={() => setFilter(key)}
            className={`h-8 px-3 rounded-md text-[12px] transition-colors ${
              filter === key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <Panel>
        {loading && !data ? (
          <SkeletonRows rows={6} cols={6} />
        ) : accounts.length === 0 ? (
          <EmptyState
            icon={Building2}
            tone="neutral"
            title={all.length === 0 ? 'لا توجد حسابات بعد' : 'لا نتائج مطابقة'}
            hint={all.length === 0 ? 'أضف أول حساب شركة للبدء' : 'جرّب بحثًا أو تصفية أخرى'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                  {['الشركة', 'النوع', 'المرحلة', 'العقد', 'اتصال واتساب', 'الوكيل', 'محادثات', 'آخر وارد'].map((h) => (
                    <th key={h} className="text-right font-medium px-4 h-9 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {accounts.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 h-9 whitespace-nowrap">
                      <Link to={`/admin/accounts/${a.id}`} className="font-medium text-gray-900 hover:underline">{a.name}</Link>
                    </td>
                    <td className="px-4 h-9 text-gray-600 whitespace-nowrap">{TYPE_LABEL[a.business_type] || a.business_type}</td>
                    <td className="px-4 h-9 text-gray-600 whitespace-nowrap">{LIFECYCLE_LABEL[a.lifecycle] || a.lifecycle}</td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]"><ContractCell contract={a.contract} /></td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.connection?.state} label={a.connection?.label} sub={a.connection?.sub} />
                    </td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.agent?.state} label={a.agent?.label} sub={a.agent?.sub} />
                    </td>
                    <td className="px-4 h-9"><Num className="text-gray-700">{a.conversations}</Num></td>
                    <td className="px-4 h-9 text-gray-500 whitespace-nowrap"><Timestamp value={a.last_inbound_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
