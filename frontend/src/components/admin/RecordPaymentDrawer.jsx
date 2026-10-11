import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../../utils/api';
import { Drawer, Button, chipClass, fieldClass, labelClass, btnClass } from './ui';
import { dayMonth, jod } from './operatorView';

/**
 * «سجّل دفعة» in a side drawer: المبلغ، التاريخ، الطريقة، رقم المرجع — and, before saving, what
 * saving will do to this shop's contract, worked out from the billing row.
 *
 * The payment is recorded against the shop's live Karam Bot contract. The billing row names it
 * when the server sends subscription_id; otherwise it is looked up here, the same choice the cost
 * guard makes (the newest contract that is not cancelled, Karam Bot first). The server turns a
 * free month «فعّال» on its first payment and moves the due date only for a full cycle's money
 * (admin.js cyclesCompleted), so the preview below follows the same arithmetic in cents.
 *
 * Ending a free month early is its own action under the save button, never a side effect of a
 * payment: it PATCHes the contract (trial_ends_at, next_due_at, status) after its own confirmation.
 */

const METHODS = [['cliq', 'كليك'], ['bank_transfer', 'تحويل بنكي'], ['cash', 'نقدًا']];
const cents = (v) => Math.round(Number(v || 0) * 100);

function liveContract(subs) {
  const open = (subs || []).filter((s) => s.status !== 'cancelled');
  return open.find((s) => s.solution === 'karam_bot') || open[0] || null;
}

/** The server's nextDue (admin.js): one cycle on from a date; one_time has none. */
function advance(iso, cycle, n) {
  if (!iso || cycle === 'one_time') return null;
  const d = new Date(iso);
  for (let i = 0; i < n; i += 1) {
    if (cycle === 'monthly') d.setMonth(d.getMonth() + 1);
    else if (cycle === 'quarterly') d.setMonth(d.getMonth() + 3);
    else if (cycle === 'yearly') d.setFullYear(d.getFullYear() + 1);
    else return null;
  }
  return d.toISOString();
}

/** What saving this payment will do, in the order the server does it. */
function Preview({ row, contract, amount, method }) {
  const a = cents(amount);
  if (a <= 0) return null;
  const price = cents(contract.amount_jod);
  const recurring = contract.billing_cycle !== 'one_time' && price > 0;
  // What the running total already carries into this cycle: the price less what is still owed.
  const owed = row.due_jod !== null && row.due_jod !== undefined ? cents(row.due_jod) : price;
  const carried = recurring ? (price - owed) % price : 0;
  const cycles = recurring ? Math.floor((carried + a) / price) : 0;
  const status = contract.status;
  const becomesActive = status === 'trial' || (status === 'past_due' && cycles > 0);
  const after = becomesActive ? 'active' : status;
  const nextDue = cycles > 0 ? advance(contract.next_due_at || new Date().toISOString(), contract.billing_cycle, cycles) : null;
  const left = recurring && cycles === 0 ? (price - carried - a) / 100 : 0;

  return (
    <div className="p-4 rounded-xl bg-shift-canvas text-sm leading-[1.8] text-shift-ink space-y-1">
      <p className="m-0">
        سيُسجّل مبلغ <b className="font-semibold">{jod(a / 100)}</b> ({METHODS.find(([v]) => v === method)?.[1]}) على عقد «{contract.plan_name || 'كرم بوت'}».
      </p>
      {status === 'trial' && (
        <p className="m-0">
          الاشتراك في المجانية{row.trial_ends_at || contract.trial_ends_at ? <> حتى <bdi>{dayMonth(row.trial_ends_at || contract.trial_ends_at)}</bdi></> : null}:
          {' '}يصبح «فعّال» مع هذه الدفعة.
        </p>
      )}
      {status === 'past_due' && (cycles > 0
        ? <p className="m-0">يعود الاشتراك «فعّال».</p>
        : <p className="m-0 text-shift-warn">لا تكفي لإغلاق الدورة المتأخرة: يبقى الاشتراك «متأخر».</p>)}
      {row.bot_paused_for_late && after !== 'past_due' && <p className="m-0">ويعود الرد الآلي الذي أوقفته سياسة التأخر.</p>}
      {cycles > 0 && nextDue && (
        <p className="m-0">
          يتقدّم الاستحقاق{contract.next_due_at ? <> من <bdi>{dayMonth(contract.next_due_at)}</bdi></> : null} إلى <bdi>{dayMonth(nextDue)}</bdi>
          {cycles > 1 ? ` (${cycles} دورات)` : ''}.
        </p>
      )}
      {recurring && cycles === 0 && (
        <p className="m-0 text-shift-warn">
          دفعة جزئية: موعد الاستحقاق{contract.next_due_at ? <> يبقى <bdi>{dayMonth(contract.next_due_at)}</bdi></> : ' لا يتقدّم'} حتى يكتمل مبلغ الدورة (باقٍ {jod(left)}).
        </p>
      )}
    </div>
  );
}

/** «إنهاء المجانية…»: today becomes the free month's last day and the first payment falls due. */
function EndTrial({ row, contract, onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const end = async () => {
    if (!window.confirm(`إنهاء المجانية لـ${row.name} اليوم؟ تصبح حالة الاشتراك «فعّال» ويستحق أول دفع اليوم، وبعد أيام السماح يُوقَف الرد الآلي إن لم يُدفع. لا تُسجَّل أي دفعة.`)) return;
    const today = new Date().toISOString().slice(0, 10);
    setBusy(true); setError(null);
    try {
      await api.patch(`/admin/accounts/${row.account_id}/subscriptions/${contract.id}`, { trial_ends_at: today, next_due_at: today, status: 'active' });
      onDone?.(`انتهت المجانية لـ${row.name}. أول دفع مستحق اليوم.`);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إنهاء المجانية');
    } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-col gap-1">
      <button type="button" onClick={end} disabled={busy}
        className="self-start min-h-[40px] p-0 border-0 bg-transparent text-shift-danger text-[13.5px] hover:underline disabled:opacity-50">
        {busy ? 'جارٍ…' : 'إنهاء المجانية وبدء الاشتراك المدفوع الآن…'}
      </button>
      {error && <p role="alert" className="m-0 text-[13px] text-shift-danger">{error}</p>}
    </div>
  );
}

export default function RecordPaymentDrawer({ row, onDone, onCancel }) {
  // The contract the payment lands on: the billing row's own fields, or the looked-up one.
  const [contract, setContract] = useState(row.subscription_id ? {
    id: row.subscription_id, status: row.status, amount_jod: row.amount_jod, billing_cycle: row.billing_cycle,
    next_due_at: row.next_due_at, trial_ends_at: row.trial_ends_at, plan_name: row.plan_name,
  } : null);
  const [looking, setLooking] = useState(!row.subscription_id);
  const [f, setF] = useState({
    amount_jod: row.due_jod ? String(row.due_jod) : row.amount_jod ? String(row.amount_jod) : '',
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
        setContract(sub || null);
        if (sub && !row.amount_jod) setF((x) => ({ ...x, amount_jod: String(sub.amount_jod) }));
      })
      .catch(() => setError('تعذّر قراءة عقد هذا المحل'))
      .finally(() => setLooking(false));
  }, [row.account_id, row.subscription_id, row.amount_jod]);

  const submit = async (e) => {
    e.preventDefault();
    if (!contract) return;
    setBusy(true); setError(null);
    try {
      await api.post(`/admin/accounts/${row.account_id}/subscriptions/${contract.id}/payments`, f);
      onDone?.(`سُجّلت دفعة ${f.amount_jod} د.أ لـ${row.name}. تظهر في سجل الزبون.`);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تسجيل الدفعة');
    } finally { setBusy(false); }
  };

  return (
    <Drawer title={`تسجيل دفعة — ${row.name}`} onClose={onCancel}>
      {looking ? (
        <p className="m-0 text-sm text-shift-body">جارٍ قراءة العقد…</p>
      ) : !contract ? (
        <div className="flex flex-col gap-3 text-sm text-shift-body">
          <p className="m-0">لا يوجد عقد لهذا المحل لتُسجَّل عليه الدفعة.</p>
          {error && <p role="alert" className="m-0 text-shift-danger">{error}</p>}
          <Link to={`/admin/accounts/${row.account_id}?tab=contract`} className={`${btnClass('secondary')} self-start`}>سجّل عقدًا</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-3.5">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pay-amount" className={labelClass}>المبلغ (د.أ)</label>
              <input id="pay-amount" value={f.amount_jod} onChange={set('amount_jod')} type="number" min="0.01" step="0.01" required dir="ltr"
                className={`${fieldClass} text-right tabular-nums`} />
            </div>
            <div className="flex flex-col gap-1.5">
              <label htmlFor="pay-date" className={labelClass}>تاريخ الدفع</label>
              <input id="pay-date" value={f.paid_at} onChange={set('paid_at')} type="date" required dir="ltr" className={fieldClass} />
            </div>
          </div>

          <fieldset className="border-0 m-0 p-0">
            <legend className={`${labelClass} p-0 mb-2`}>الطريقة</legend>
            <div role="radiogroup" aria-label="الطريقة" className="flex flex-wrap gap-1.5">
              {METHODS.map(([v, l]) => (
                <button key={v} type="button" role="radio" aria-checked={f.method === v ? 'true' : 'false'}
                  onClick={() => setF({ ...f, method: v })} className={chipClass(f.method === v)}>{l}</button>
              ))}
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="pay-ref" className={labelClass}>رقم المرجع <span className="font-normal text-shift-body">(اختياري للنقد)</span></label>
            <input id="pay-ref" value={f.reference} onChange={set('reference')} dir="ltr" placeholder="CLQ-…" className={`${fieldClass} text-right`} />
          </div>

          <Preview row={row} contract={contract} amount={f.amount_jod} method={f.method} />

          {error && <p role="alert" className="m-0 text-[13px] text-shift-danger">{error}</p>}
          <Button type="submit" variant="primary" size="lg" disabled={busy}>{busy ? 'جارٍ…' : 'حفظ الدفعة'}</Button>
          {contract.status === 'trial' && <EndTrial row={row} contract={contract} onDone={onDone} />}
          <p className="m-0 text-[13px] text-shift-body">الدفعة لا تُحذف من اللوحة بعد الحفظ، فراجع المبلغ والتاريخ قبل الحفظ.</p>
        </form>
      )}
    </Drawer>
  );
}
