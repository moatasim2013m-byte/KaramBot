import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Receipt } from 'lucide-react';
import api from '../../utils/api';
import { Timestamp, Num, SkeletonRows, EmptyState } from '../shared/Primitives';
import { Button, Card, Pill, fieldClass, labelClass } from './ui';
import { dayMonth } from './operatorView';

/**
 * What this customer bought, and what they have paid for it.
 *
 * Payments are typed in by staff with the transfer or CliQ reference — the record a bank
 * statement is reconciled against. No gateway sits behind this on purpose.
 *
 * «العقد» also carries the plan's terms that the bot is held to: the monthly reply cap and the end
 * of the free month. A free month turns «فعّال» when its first payment is recorded, and a partial
 * payment does not move the due date a whole cycle (the server decides both).
 *
 * Each contract leads with its tiles (plan and price, status, the free month or the next due date,
 * paid so far), then its actions, terms and payments.
 */

const SOLUTION_LABEL = { karam_bot: 'كرم بوت', automation: 'أتمتة', website: 'موقع', custom: 'حل مخصص' };
const STATUS_LABEL = { trial: 'فترة مجانية', active: 'فعّال', past_due: 'متأخر', paused: 'موقوف مؤقتًا', cancelled: 'ملغي' };
const STATUS_PILL = { trial: 'trial', active: 'ok', past_due: 'bad', paused: 'warn', cancelled: 'neutral' };
const CYCLE_LABEL = { monthly: 'شهري', quarterly: 'ربع سنوي', yearly: 'سنوي', one_time: 'مرة واحدة' };
const METHOD_LABEL = { cliq: 'كليك', bank_transfer: 'تحويل بنكي', cash: 'نقدًا', card: 'بطاقة', other: 'أخرى' };

const input = fieldClass;
const small = 'h-10 px-3 border border-shift-field rounded-[10px] text-sm text-shift-ink bg-white';

function Lbl({ text, children, className = '' }) {
  return <label className={`flex flex-col gap-1.5 min-w-0 ${className}`}><span className={labelClass}>{text}</span>{children}</label>;
}

function Tile({ label, children }) {
  return (
    <div className="bg-shift-canvas rounded-xl p-3 min-w-0">
      <div className="text-[13px] text-shift-body">{label}</div>
      <div className="font-semibold text-shift-ink">{children}</div>
    </div>
  );
}

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
    <form onSubmit={submit} className="mb-3 p-3.5 rounded-xl bg-shift-canvas flex flex-col gap-3">
      <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
        <Lbl text="الحل">
          <select value={f.solution} onChange={set('solution')} className={input}>
            {Object.entries(SOLUTION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Lbl>
        <Lbl text="اسم الباقة (اختياري)"><input value={f.plan_name} onChange={set('plan_name')} className={input} /></Lbl>
        <Lbl text="المبلغ بالدينار"><input value={f.amount_jod} onChange={set('amount_jod')} type="number" min="0" step="0.01" required dir="ltr" className={`${input} text-right`} /></Lbl>
        <Lbl text="الدورة">
          <select value={f.billing_cycle} onChange={set('billing_cycle')} className={input}>
            {Object.entries(CYCLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Lbl>
        <Lbl text="الحالة">
          <select value={f.status} onChange={set('status')} className={input}>
            {['trial', 'active'].map((v) => <option key={v} value={v}>{STATUS_LABEL[v]}</option>)}
          </select>
        </Lbl>
        <Lbl text="يبدأ في"><input value={f.starts_at} onChange={set('starts_at')} type="date" required dir="ltr" className={input} /></Lbl>
      </div>
      <Lbl text="ملاحظات"><input value={f.notes} onChange={set('notes')} placeholder="ما اتُّفق عليه بالضبط" className={input} /></Lbl>
      {error && <p role="alert" className="m-0 text-[13px] text-shift-danger">{error}</p>}
      <Button type="submit" variant="primary" disabled={busy} className="self-start">
        {busy ? 'جارٍ...' : 'تسجيل العقد'}
      </Button>
    </form>
  );
}

function RecordPayment({ accountId, sub, onDone }) {
  const [f, setF] = useState({ amount_jod: String(sub.amount_jod), method: 'cliq', paid_at: new Date().toISOString().slice(0, 10), reference: '' });
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
    <form onSubmit={submit} className="mt-3 p-3.5 rounded-xl bg-shift-canvas flex flex-wrap items-end gap-3">
      <Lbl text="المبلغ (د.أ)" className="basis-28 grow"><input value={f.amount_jod} onChange={set('amount_jod')} type="number" min="0.01" step="0.01" required dir="ltr" className={`${input} text-right`} /></Lbl>
      <Lbl text="الطريقة" className="basis-32 grow">
        <select value={f.method} onChange={set('method')} className={input}>
          {Object.entries(METHOD_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </Lbl>
      <Lbl text="التاريخ" className="basis-36 grow"><input value={f.paid_at} onChange={set('paid_at')} type="date" required dir="ltr" className={input} /></Lbl>
      <Lbl text="رقم التحويل / المرجع" className="basis-44 grow"><input value={f.reference} onChange={set('reference')} dir="ltr" className={`${input} text-right`} /></Lbl>
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? 'جارٍ...' : 'تسجيل دفعة'}
      </Button>
      {error && <span role="alert" className="basis-full text-[13px] text-shift-danger">{error}</span>}
    </form>
  );
}

/**
 * The terms the cost guard reads: «ردود الشهر» (the snapshotted cap) and «نهاية الفترة المجانية».
 * Both are on the Subscription row, so changing the platform default never rewrites a deal.
 */
function Terms({ accountId, sub, onDone }) {
  const [cap, setCap] = useState(sub.ai_replies_month ?? '');
  const [trialEnd, setTrialEnd] = useState(sub.trial_ends_at ? String(sub.trial_ends_at).slice(0, 10) : '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [saved, setSaved] = useState(false);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError(null);
    try {
      const body = {};
      if (String(cap) !== String(sub.ai_replies_month ?? '')) body.ai_replies_month = cap === '' ? null : Number(cap);
      if (trialEnd !== (sub.trial_ends_at ? String(sub.trial_ends_at).slice(0, 10) : '')) body.trial_ends_at = trialEnd || null;
      if (Object.keys(body).length === 0) { setBusy(false); return; }
      await api.patch(`/admin/accounts/${accountId}/subscriptions/${sub.id}`, body);
      setSaved(true); setTimeout(() => setSaved(false), 2000);
      onDone();
    } catch (err) { setError(err.response?.data?.error || 'تعذّر الحفظ'); }
    finally { setBusy(false); }
  };

  return (
    <form onSubmit={save} className="mt-3 pt-3 border-t border-shift-line2 flex flex-wrap items-center gap-2 text-[13.5px] text-shift-body">
      <label className="flex items-center gap-2">ردود الشهر:
        <input value={cap} onChange={(e) => setCap(e.target.value.replace(/\D/g, ''))} inputMode="numeric" dir="ltr" placeholder="الافتراضي" className={`${small} w-28`} />
      </label>
      {sub.status === 'trial' && (
        <label className="flex items-center gap-2">نهاية الفترة المجانية:
          <input value={trialEnd} onChange={(e) => setTrialEnd(e.target.value)} type="date" dir="ltr" className={small} />
        </label>
      )}
      <Button type="submit" size="sm" disabled={busy} className="!min-h-[40px]">
        {busy ? 'جارٍ…' : 'احفظ الشروط'}
      </Button>
      {saved && <span role="status" className="text-shift-ok">تم</span>}
      {error && <span role="alert" className="text-shift-danger">{error}</span>}
      {sub.status === 'trial' && <span className="basis-full text-[13px] text-shift-muted">تصبح «فعّال» عند تسجيل أول دفعة.</span>}
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

  const link = 'min-h-[40px] px-2 text-[13.5px] underline underline-offset-2';

  return (
    <div className="flex flex-col gap-4">
      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}

      <Card
        title="الاشتراك والعقد"
        action={<Button size="sm" onClick={() => setAdding((v) => !v)} aria-expanded={adding ? 'true' : 'false'} className="!min-h-[40px]"><Plus size={15} /> عقد جديد</Button>}
      >
        {adding && <NewContract accountId={accountId} onDone={() => { setAdding(false); load(); }} />}

        {!subs ? <SkeletonRows rows={3} cols={5} /> : subs.length === 0 ? (
          <EmptyState icon={Receipt} tone="neutral" title="لا يوجد عقد مسجّل" hint="سجّل ما اتُّفق عليه مع العميل حتى يظهر في لوحة المنصة" />
        ) : (
          <div className="flex flex-col">
            {subs.map((sub, i) => (
              <div key={sub.id} className={i > 0 ? 'mt-4 pt-4 border-t border-shift-line' : ''}>
                <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
                  <Tile label="الباقة">
                    {SOLUTION_LABEL[sub.solution] || sub.solution}{sub.plan_name ? ` — ${sub.plan_name}` : ''} · <Num>{sub.amount_jod}</Num> د.أ <span className="font-normal text-shift-body">/ {CYCLE_LABEL[sub.billing_cycle]}</span>
                  </Tile>
                  <Tile label="الحالة"><Pill tone={STATUS_PILL[sub.status] || 'neutral'}>{STATUS_LABEL[sub.status] || sub.status}</Pill></Tile>
                  {sub.status === 'trial' && sub.trial_ends_at ? (
                    <Tile label="المجانية">{dayMonth(sub.starts_at)} ← {dayMonth(sub.trial_ends_at)}</Tile>
                  ) : (
                    <Tile label="منذ">{dayMonth(sub.starts_at)}</Tile>
                  )}
                  <Tile label={sub.status === 'trial' ? 'أول استحقاق' : 'الدفعة القادمة'}>{sub.next_due_at ? dayMonth(sub.next_due_at) : '—'}</Tile>
                  <Tile label="مدفوع"><Num>{sub.total_paid_jod}</Num> د.أ</Tile>
                </div>

                <div className="mt-2 flex flex-wrap items-center gap-1">
                  {sub.status !== 'cancelled' && (
                    <button type="button" onClick={() => setPaying(paying === sub.id ? null : sub.id)} className={`${link} text-shift-accent`}>تسجيل دفعة</button>
                  )}
                  {sub.status === 'active' && <button type="button" onClick={() => setStatus(sub, 'paused')} className={`${link} text-shift-body`}>إيقاف مؤقت</button>}
                  {sub.status === 'paused' && <button type="button" onClick={() => setStatus(sub, 'active')} className={`${link} text-shift-body`}>استئناف</button>}
                  {sub.status !== 'cancelled' && <button type="button" onClick={() => setStatus(sub, 'cancelled')} className={`${link} text-shift-danger`}>إلغاء</button>}
                </div>

                {sub.solution === 'karam_bot' && sub.status !== 'cancelled' && <Terms accountId={accountId} sub={sub} onDone={load} />}
                {paying === sub.id && <RecordPayment accountId={accountId} sub={sub} onDone={() => { setPaying(null); load(); }} />}
                {sub.payments.length > 0 ? (
                  <ul className="m-0 mt-3 p-0 list-none flex flex-col gap-1">
                    {sub.payments.map((p) => (
                      <li key={p.id} className="text-[13px] text-shift-body flex flex-wrap gap-x-3">
                        <Num className="text-shift-ink w-20">{p.amount_jod} د.أ</Num>
                        <span>{METHOD_LABEL[p.method] || p.method}</span>
                        <Timestamp value={p.paid_at} />
                        {p.reference && <span dir="ltr" className="font-mono text-[12px]">{p.reference}</span>}
                      </li>
                    ))}
                  </ul>
                ) : sub.status !== 'cancelled' && (
                  <p className="m-0 mt-3 text-sm text-shift-body">
                    لا دفعات بعد. <Link to={`/admin/billing?pay=${encodeURIComponent(accountId)}`} className="text-shift-accent hover:text-shift-ink no-underline">سجّل دفعة من «الاشتراكات والدفعات»</Link>
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
