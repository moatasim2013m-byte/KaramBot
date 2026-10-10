import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';

/**
 * «سجّل دفعة» inline, under a shop's billing row: المبلغ، الطريقة، رقم المرجع، التاريخ.
 *
 * The payment is recorded against the shop's live Karam Bot contract. The billing row names it
 * when the server sends subscription_id; otherwise it is looked up here, the same choice the cost
 * guard makes (the newest contract that is not cancelled, Karam Bot first). The server turns a
 * free month «فعّال» on its first payment and moves the due date only for a full cycle's money.
 */

const METHODS = [['cliq', 'كليك'], ['bank_transfer', 'تحويل بنكي'], ['cash', 'نقدًا']];
const field = 'h-8 px-2.5 text-[13px] border border-gray-200 rounded-md bg-white focus:outline-none focus:ring-1 focus:ring-gray-400';

function liveContract(subs) {
  const open = (subs || []).filter((s) => s.status !== 'cancelled');
  return open.find((s) => s.solution === 'karam_bot') || open[0] || null;
}

export default function RecordPaymentDrawer({ row, onDone, onCancel }) {
  const [subId, setSubId] = useState(row.subscription_id || null);
  const [looking, setLooking] = useState(!row.subscription_id);
  const [f, setF] = useState({
    amount_jod: row.amount_jod ? String(row.amount_jod) : '',
    method: 'cliq',
    reference: '',
    paid_at: new Date().toISOString().slice(0, 10),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  useEffect(() => {
    if (row.subscription_id) return;
    api.get(`/admin/accounts/${row.account_id}/subscriptions`)
      .then((res) => {
        const sub = liveContract(res.data?.subscriptions);
        setSubId(sub ? sub.id : null);
        if (sub && !row.amount_jod) setF((x) => ({ ...x, amount_jod: String(sub.amount_jod) }));
      })
      .catch(() => setError('تعذّر قراءة عقد هذا المحل'))
      .finally(() => setLooking(false));
  }, [row.account_id, row.subscription_id, row.amount_jod]);

  const submit = async (e) => {
    e.preventDefault();
    if (!subId) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/accounts/${row.account_id}/subscriptions/${subId}/payments`, f);
      onDone?.(`سُجّلت دفعة ${f.amount_jod} د.أ لـ${row.name}.`);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تسجيل الدفعة');
    } finally { setBusy(false); }
  };

  if (looking) return <div className="px-4 py-3 text-[12px] text-gray-500 bg-gray-50">جارٍ قراءة العقد…</div>;
  if (!subId) {
    return (
      <div className="px-4 py-3 text-[12px] text-gray-600 bg-gray-50 flex flex-wrap items-center gap-3">
        لا يوجد عقد لهذا المحل لتُسجَّل عليه الدفعة.
        <Link to={`/admin/accounts/${row.account_id}?tab=contract`} className="underline">سجّل عقدًا</Link>
        <button type="button" onClick={onCancel} className="text-gray-500 underline">إغلاق</button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 px-4 py-3 bg-gray-50 border-t border-gray-100">
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">المبلغ (د.أ)</span>
        <input value={f.amount_jod} onChange={set('amount_jod')} type="number" min="0.01" step="0.01" required dir="ltr" className={`${field} w-28`} /></label>
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">الطريقة</span>
        <select value={f.method} onChange={set('method')} className={field}>
          {METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select></label>
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">رقم المرجع</span>
        <input value={f.reference} onChange={set('reference')} dir="ltr" className={`${field} w-44`} /></label>
      <label className="block"><span className="block text-[11px] text-gray-500 mb-0.5">التاريخ</span>
        <input value={f.paid_at} onChange={set('paid_at')} type="date" required dir="ltr" className={field} /></label>
      <button type="submit" disabled={busy} className="h-8 px-3 rounded-md bg-gray-900 text-white text-[13px] disabled:opacity-40">
        {busy ? 'جارٍ…' : 'سجّل الدفعة'}
      </button>
      <button type="button" onClick={onCancel} className="h-8 px-2 text-[12px] text-gray-500 underline">إلغاء</button>
      {error && <span className="text-[12px] text-red-700">{error}</span>}
      {Number(f.amount_jod) > 0 && row.amount_jod && Number(f.amount_jod) < Number(row.amount_jod) && (
        <span className="w-full text-[11px] text-amber-700">دفعة جزئية: موعد الاستحقاق لا يتقدّم حتى يكتمل مبلغ الدورة.</span>
      )}
    </form>
  );
}
