import { useCallback, useEffect, useState } from 'react';
import { Plus, Receipt } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Timestamp, Num, SkeletonRows, EmptyState } from '../shared/Primitives';

/**
 * What this customer bought, and what they have paid for it.
 *
 * Payments are typed in by staff with the transfer or CliQ reference — the record a bank
 * statement is reconciled against. No gateway sits behind this on purpose.
 */

const SOLUTION_LABEL = { karam_bot: 'كرم بوت', automation: 'أتمتة', website: 'موقع', custom: 'حل مخصص' };
const STATUS_LABEL = { trial: 'تجربة', active: 'فعّال', past_due: 'متأخر', paused: 'موقوف مؤقتًا', cancelled: 'ملغي' };
const STATUS_CLS = { trial: 'text-gray-600', active: 'text-emerald-700', past_due: 'text-red-700', paused: 'text-amber-700', cancelled: 'text-gray-400' };
const CYCLE_LABEL = { monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي', one_time: 'مرة واحدة' };
const METHOD_LABEL = { bank_transfer: 'تحويل بنكي', cliq: 'CliQ', cash: 'نقدًا', card: 'بطاقة', other: 'أخرى' };

const input = 'h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400';

function NewContract({ accountId, onDone }) {
  const [f, setF] = useState({ solution: 'karam_bot', plan_name: '', amount_jod: '', billing_cycle: 'monthly', status: 'active', starts_at: new Date().toISOString().slice(0, 10), notes: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/admin/accounts/${accountId}/subscriptions`, f);
      onDone();
    } catch (err) { setError(err.response?.data?.error || 'تعذّر إنشاء العقد'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="p-4 border-b border-gray-100 bg-gray-50 space-y-2.5">
      <div className="grid gap-2.5 sm:grid-cols-3">
        <select value={f.solution} onChange={set('solution')} className={input}>
          {Object.entries(SOLUTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <input value={f.plan_name} onChange={set('plan_name')} placeholder="اسم الباقة (اختياري)" className={input} />
        <input value={f.amount_jod} onChange={set('amount_jod')} placeholder="المبلغ بالدينار" type="number" min="0" step="0.01" required dir="ltr" className={input} />
        <select value={f.billing_cycle} onChange={set('billing_cycle')} className={input}>
          {Object.entries(CYCLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={f.status} onChange={set('status')} className={input}>
          {['trial', 'active'].map((v) => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
        </select>
        <input value={f.starts_at} onChange={set('starts_at')} type="date" required dir="ltr" className={input} />
      </div>
      <input value={f.notes} onChange={set('notes')} placeholder="ملاحظات — ما اتُّفق عليه بالضبط" className={`${input} w-full`} />
      {error && <p className="text-[13px] text-red-700">{error}</p>}
      <button type="submit" disabled={busy} className="bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40">
        {busy ? 'جارٍ...' : 'تسجيل العقد'}
      </button>
    </form>
  );
}

function RecordPayment({ accountId, sub, onDone }) {
  const [f, setF] = useState({ amount_jod: String(sub.amount_jod), method: 'bank_transfer', paid_at: new Date().toISOString().slice(0, 10), reference: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      await api.post(`/admin/accounts/${accountId}/subscriptions/${sub.id}/payments`, f);
      onDone();
    } catch (err) { setError(err.response?.data?.error || 'تعذّر تسجيل الدفعة'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
      <input value={f.amount_jod} onChange={set('amount_jod')} type="number" min="0.01" step="0.01" required dir="ltr" className={`${input} w-28`} />
      <select value={f.method} onChange={set('method')} className={input}>
        {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
      <input value={f.paid_at} onChange={set('paid_at')} type="date" required dir="ltr" className={input} />
      <input value={f.reference} onChange={set('reference')} placeholder="رقم التحويل / المرجع" dir="ltr" className={`${input} w-44`} />
      <button type="submit" disabled={busy} className="bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40">
        {busy ? 'جارٍ...' : 'تسجيل دفعة'}
      </button>
      {error && <span className="text-[13px] text-red-700">{error}</span>}
    </form>
  );
}

export default function AccountContractsTab({ accountId }) {
  const [subs, setSubs] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState(null);

  const load = useCallback(() => {
    api.get(`/admin/accounts/${accountId}/subscriptions`)
      .then((res) => setSubs(res.data.subscriptions))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل العقود'));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const setStatus = async (sub, status) => {
    try { await api.patch(`/admin/accounts/${accountId}/subscriptions/${sub.id}`, { status }); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر تحديث الحالة'); }
  };

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <Panel
        title="العقود"
        action={<button onClick={() => setAdding((v) => !v)} className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900"><Plus size={14} /> عقد جديد</button>}
      >
        {adding && <NewContract accountId={accountId} onDone={() => { setAdding(false); load(); }} />}

        {!subs ? <SkeletonRows rows={3} cols={5} /> : subs.length === 0 ? (
          <EmptyState icon={Receipt} tone="neutral" title="لا يوجد عقد مسجّل" hint="سجّل ما اتُّفق عليه مع العميل حتى يظهر في لوحة المنصة" />
        ) : (
          <div className="divide-y divide-gray-100">
            {subs.map((sub) => (
              <div key={sub.id}>
                <div className="flex flex-wrap items-center gap-x-5 gap-y-1 px-4 py-3">
                  <div className="min-w-[160px]">
                    <div className="text-[13px] font-medium text-gray-900">{SOLUTION_LABEL[sub.solution] || sub.solution}{sub.plan_name ? ` — ${sub.plan_name}` : ''}</div>
                    <div className={`text-[12px] ${STATUS_CLS[sub.status] || ''}`}>{STATUS_LABEL[sub.status] || sub.status}</div>
                  </div>
                  <div className="text-[13px] text-gray-700"><Num>{sub.amount_jod}</Num> د.أ <span className="text-gray-400 text-[11px]">/ {CYCLE_LABEL[sub.billing_cycle]}</span></div>
                  <div className="text-[12px] text-gray-500">منذ <Timestamp value={sub.starts_at} /></div>
                  <div className="text-[12px] text-gray-500">الدفعة القادمة: {sub.next_due_at ? <Timestamp value={sub.next_due_at} /> : '—'}</div>
                  <div className="text-[12px] text-gray-500">مدفوع: <Num>{sub.total_paid_jod}</Num> د.أ</div>
                  <div className="mr-auto flex items-center gap-2">
                    {sub.status !== 'cancelled' && (
                      <button onClick={() => setPaying(paying === sub.id ? null : sub.id)} className="text-[12px] text-gray-700 underline underline-offset-2">تسجيل دفعة</button>
                    )}
                    {sub.status === 'active' && <button onClick={() => setStatus(sub, 'paused')} className="text-[12px] text-gray-500 underline underline-offset-2">إيقاف مؤقت</button>}
                    {sub.status === 'paused' && <button onClick={() => setStatus(sub, 'active')} className="text-[12px] text-gray-500 underline underline-offset-2">استئناف</button>}
                    {sub.status !== 'cancelled' && <button onClick={() => setStatus(sub, 'cancelled')} className="text-[12px] text-red-600 underline underline-offset-2">إلغاء</button>}
                  </div>
                </div>
                {paying === sub.id && <RecordPayment accountId={accountId} sub={sub} onDone={() => { setPaying(null); load(); }} />}
                {sub.payments.length > 0 && (
                  <ul className="px-4 pb-3 space-y-0.5">
                    {sub.payments.map((p) => (
                      <li key={p.id} className="text-[12px] text-gray-500 flex gap-3">
                        <Num className="text-gray-700 w-20">{p.amount_jod} د.أ</Num>
                        <span>{METHOD_LABEL[p.method] || p.method}</span>
                        <Timestamp value={p.paid_at} />
                        {p.reference && <span dir="ltr" className="font-mono text-[11px]">{p.reference}</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}
