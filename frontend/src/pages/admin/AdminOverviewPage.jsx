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
  onboarding: 'قيد التوصيل',
  active: 'نشط',
  inactive: 'غير نشط',
  suspended: 'موقوف',
};

// «ردود الشهر 0 / 1,000» per shop, from costGuard. Amber from 80%, red at the cap: during the free
// month the cap is hard and the shop's chats go to its staff.
function UsageCell({ usage }) {
  if (!usage || usage.ai_replies_month === undefined || usage.ai_replies_month === null) {
    return <span className="text-gray-300">—</span>;
  }
  const { ai_replies_month: used, cap, media_today: media } = usage;
  const ratio = cap ? used / cap : 0;
  const cls = ratio >= 1 ? 'text-red-600 font-medium' : ratio >= 0.8 ? 'text-amber-600 font-medium' : 'text-gray-700';
  return (
    <span className="whitespace-nowrap" title={media !== undefined && media !== null ? `وسائط قُرئت اليوم: ${media}` : undefined}>
      <Num className={cls}>{used.toLocaleString('en-US')}</Num>
      {cap ? <span className="text-gray-400"> / <Num>{cap.toLocaleString('en-US')}</Num></span> : null}
    </span>
  );
}

const ORPHAN_KIND = {
  onboarding: 'وافق في Meta ولم يكتمل الربط',
  partner_added: 'أضافنا في Meta بلا حساب عندنا',
};

/**
 * «ربط بدون حساب»: Meta signups no shop owns yet. A PARTNER_ADDED webhook for a WABA we have no
 * row for, or a signup whose number the server could not pick on its own. Kept so the customer
 * never has to redo Meta's window: SHIFT attaches the row to the right shop, or types the number
 * id from WhatsApp Manager. Hidden when there is nothing to match.
 */
function OrphanSignups({ accounts, onDone }) {
  const [orphans, setOrphans] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // {id, mode: 'attach' | 'complete'}
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get('/admin/onboardings/orphans')
      .then((res) => { setOrphans(res.data?.orphans || []); setError(null); })
      .catch((err) => {
        // An older server without the route has nothing to show, which is not an error.
        if (err.response?.status === 404) setOrphans([]);
        else setError(err.response?.data?.message || err.response?.data?.error || 'تعذّر تحميل «ربط بدون حساب»');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const submit = async (o) => {
    if (!open || !value) return;
    setBusy(true); setError(null);
    try {
      if (open.mode === 'attach') await api.post(`/admin/onboardings/${o.id}/attach`, { business_id: value });
      else await api.post(`/admin/onboardings/${o.id}/complete`, { phone_number_id: value.trim() });
      setOpen(null); setValue('');
      load();
      if (onDone) onDone();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  if (!error && (!orphans || orphans.length === 0)) return null;

  const pickable = [...(accounts || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));

  return (
    <Panel title={`ربط بدون حساب${orphans?.length ? ` · ${orphans.length}` : ''}`}>
      {error && <p className="px-4 py-2 text-[13px] text-red-700 bg-red-50 border-b border-red-100">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {(orphans || []).map((o) => (
          <li key={o.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium text-gray-900">{o.verified_name || 'بدون اسم عند Meta'}</span>
              {o.display_phone ? <Ltr className="text-[13px] text-gray-700">{o.display_phone}</Ltr>
                : <span className="text-[12px] text-amber-700">الرقم غير محدد</span>}
              <span className="text-[12px] text-gray-500">{ORPHAN_KIND[o.kind] || ''}</span>
              {o.waba_id && <span className="text-[11px] text-gray-400">حساب واتساب <Ltr className="font-mono">{o.waba_id}</Ltr></span>}
              <Timestamp value={o.created_at} className="text-[11px] text-gray-400" />
              <span className="flex-1" />
              <button type="button" className="text-[12px] text-gray-700 underline underline-offset-2 hover:text-gray-900"
                onClick={() => { setOpen({ id: o.id, mode: 'attach' }); setValue(''); }}>
                اربطه بزبون…
              </button>
              {o.kind === 'onboarding' && !o.display_phone && (
                <button type="button" className="text-[12px] text-gray-700 underline underline-offset-2 hover:text-gray-900"
                  onClick={() => { setOpen({ id: o.id, mode: 'complete' }); setValue(''); }}>
                  أكمل الربط
                </button>
              )}
            </div>
            {open?.id === o.id && (
              <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(o); }}>
                {open.mode === 'attach' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}
                    className="h-8 min-w-[200px] rounded border border-gray-200 px-2 text-[13px]">
                    <option value="">اختر الزبون</option>
                    {pickable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric" dir="ltr" placeholder="معرّف الرقم من WhatsApp Manager"
                    className="h-8 w-64 rounded border border-gray-200 px-2 font-mono text-[13px]" />
                )}
                <button type="submit" disabled={busy || !value}
                  className="h-8 rounded bg-gray-900 px-3 text-[12px] font-medium text-white disabled:opacity-40">
                  {busy ? 'جارٍ…' : open.mode === 'attach' ? 'اربط' : 'أكمل'}
                </button>
                <button type="button" onClick={() => setOpen(null)} className="text-[12px] text-gray-500 underline">إلغاء</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </Panel>
  );
}

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

export function InternalFootnote({ data, showInternal, onToggle }) {
  if (!data) return null;
  const hidden = data.hidden_internal_count || 0;
  if (!showInternal && hidden === 0) return null;
  return (
    <p className="text-[11px] text-gray-400 px-1 flex items-center gap-2">
      {showInternal ? <span>تظهر الحسابات الداخلية (شِفت والتجريبية)</span> : <span>حسابات داخلية مخفية ({hidden})</span>}
      <button type="button" onClick={onToggle} className="underline underline-offset-2 hover:text-gray-700">
        {showInternal ? 'إخفاؤها' : 'إظهارها'}
      </button>
    </p>
  );
}

export default function AdminOverviewPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // SHIFT's own row and the -sim test shops are hidden unless asked for: they would inflate the
  // totals and fill the queue with our own traffic.
  const [showInternal, setShowInternal] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/overview', { params: showInternal ? { include_internal: 1 } : {} })
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل حالة المنصة'))
      .finally(() => setLoading(false));
  }, [showInternal]);

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

      <OrphanSignups accounts={accounts} onDone={load} />

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
                  {['الشركة', 'المرحلة', 'العقد', 'اتصال واتساب', 'الوكيل', 'ردود الشهر', 'محادثات مفتوحة', 'آخر رسالة واردة'].map((h) => (
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
                      {a.is_internal && <span className="mr-2 text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">داخلي</span>}
                    </td>
                    <td className="px-4 h-9 text-gray-600 whitespace-nowrap">{LIFECYCLE_LABEL[a.lifecycle] || a.lifecycle}</td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]"><ContractCell contract={a.contract} /></td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.connection?.state} label={a.connection?.label} sub={a.connection?.sub} />
                    </td>
                    <td className="px-4 h-9 whitespace-nowrap min-w-[150px]">
                      <StateCell state={a.agent?.state} label={a.agent?.label} sub={a.agent?.sub} />
                    </td>
                    <td className="px-4 h-9"><UsageCell usage={a.usage} /></td>
                    <td className="px-4 h-9"><Num className="text-gray-700">{a.open_conversations}</Num></td>
                    <td className="px-4 h-9 text-gray-500 whitespace-nowrap"><Timestamp value={a.last_inbound_at} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {/* Hidden, but never silently: the count says what the totals leave out. */}
      <InternalFootnote data={data} showInternal={showInternal} onToggle={() => setShowInternal((v) => !v)} />

      {/* Said out loud rather than shown as a healthy-looking blank. */}
      {data?.unavailable?.length > 0 && (
        <p className="text-[11px] text-gray-400 px-1">
          غير متوفر بعد: فئة الإرسال لدى Meta، ومن غيّر الإعدادات.
        </p>
      )}
    </div>
  );
}
