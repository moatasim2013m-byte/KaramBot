import { useState } from 'react';
import { Save, Plus, X } from 'lucide-react';
import api from '../../utils/api';
import BotPauseControl from './BotPauseControl';
import { Button, Card, fieldClass, labelClass } from './ui';

/**
 * «الإعدادات» — the shop's general, AI and policy settings on one tab, aware of its type.
 *
 * It replaces three tabs (عام · الذكاء الاصطناعي · السياسات). Delivery fields show for restaurants
 * only, because no other shop delivers through the bot. «أرقام التنبيهات» is where the bot reaches
 * a human, and «رسالة خارج الدوام» with the opening hours is what a customer gets at night.
 *
 * Each card saves only its own keys. ai_config never carries `enabled`: the pause is its own
 * switch (BotPauseControl), so a form opened before a pause cannot switch the bot back on.
 *
 * «طريقة رد البوت» comes first, as on the design: it is what an operator opens this tab for.
 */

const input = fieldClass;
const area = 'w-full px-3 py-2.5 border border-shift-field rounded-xl text-[15px] text-shift-ink bg-white resize-none placeholder:text-shift-muted';
const timeInput = 'h-10 px-2 border border-shift-field rounded-[10px] text-sm text-shift-ink bg-white';

const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];
const MAX_ALERT_NUMBERS = 5;

// The owner's /bot editor keeps one row per day; rows of another shape are kept in day order
// and filled with defaults, so there is always something editable.
function normaliseHours(raw) {
  const byDay = new Map();
  if (Array.isArray(raw)) for (const r of raw) if (r && typeof r === 'object' && DAYS.includes(r.day)) byDay.set(r.day, r);
  return DAYS.map((day) => {
    const r = byDay.get(day) || {};
    return { day, open: r.open || '09:00', close: r.close || '21:00', closed: Boolean(r.closed) };
  });
}

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-1.5 min-w-0">
      <span className={labelClass}>{label}</span>
      {children}
      {hint && <span className="text-[12.5px] text-shift-muted">{hint}</span>}
    </label>
  );
}

function useSave(accountId, onSaved) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const save = async (payload) => {
    setBusy(true); setError(null);
    try {
      const res = await api.patch(`/businesses/${accountId}`, payload);
      onSaved?.(res.data?.business || {});
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ');
    } finally { setBusy(false); }
  };
  return { busy, saved, error, save };
}

function SaveBar({ busy, saved, error, onSave }) {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-4">
      <Button variant="primary" onClick={onSave} disabled={busy}>
        <Save size={15} /> {busy ? 'جارٍ…' : 'حفظ'}
      </Button>
      {saved && <span role="status" className="text-[13px] text-shift-ok">تم الحفظ</span>}
      {error && <span role="alert" className="text-[13px] text-shift-danger">{error}</span>}
    </div>
  );
}

function GeneralCard({ biz, onSaved }) {
  const [f, setF] = useState({
    name: biz.name || '', city: biz.city || '', address: biz.address || '', currency: biz.currency || 'JOD',
    timezone: biz.timezone || 'Asia/Amman', language_default: biz.language_default || 'ar', status: biz.status || 'active',
  });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const s = useSave(biz.id, onSaved);
  return (
    <Card title="عام">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="اسم المحل"><input value={f.name} onChange={set('name')} className={input} /></Field>
        <Field label="المدينة"><input value={f.city} onChange={set('city')} placeholder="مثال: إربد" className={input} /></Field>
        <Field label="العنوان"><input value={f.address} onChange={set('address')} className={input} /></Field>
        <Field label="العملة">
          <select value={f.currency} onChange={set('currency')} className={input}>
            <option value="JOD">دينار أردني</option>
            <option value="USD">دولار أمريكي</option>
            {f.currency && !['JOD', 'USD'].includes(f.currency) && <option value={f.currency}>{f.currency}</option>}
          </select>
        </Field>
        <Field label="لغة البوت">
          <select value={f.language_default} onChange={set('language_default')} className={input}>
            <option value="ar">العربية</option>
            <option value="en">الإنجليزية</option>
          </select>
        </Field>
        <Field label="المنطقة الزمنية"><input value={f.timezone} onChange={set('timezone')} dir="ltr" className={`${input} font-mono`} /></Field>
        <Field label="حالة الحساب" hint="غير «نشط» يوقف ردود البوت ورسائل الزبائن تبقى تصل لصندوق المحل. لإيقاف مؤقت مع سبب استعمل «أوقف البوت مؤقتًا».">
          <select value={f.status} onChange={set('status')} className={input}>
            <option value="active">نشط</option>
            <option value="inactive">غير نشط</option>
            <option value="suspended">موقوف</option>
          </select>
        </Field>
      </div>
      <SaveBar {...s} onSave={() => s.save(f)} />
    </Card>
  );
}

function ListInput({ value, onChange, placeholder, max, ltr }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const v = draft.trim();
    if (v && !value.includes(v) && (!max || value.length < max)) onChange([...value, v]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {value.map((v) => (
          <span key={v} className="inline-flex items-center gap-1 min-h-[32px] pr-3 pl-1 rounded-full bg-shift-line2 text-[13px] text-shift-ink">
            {ltr ? <span dir="ltr" className="tabular-nums">{v}</span> : v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="w-8 h-8 grid place-items-center rounded-full text-shift-muted hover:text-shift-danger" title="حذف" aria-label={`حذف ${v}`}>
              <X size={13} />
            </button>
          </span>
        ))}
      </div>
      <div className={`${value.length ? 'mt-2' : ''} flex gap-2`}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} dir={ltr ? 'ltr' : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={input} />
        <button type="button" onClick={add} disabled={!draft.trim() || (max && value.length >= max)}
          className="shrink-0 inline-flex items-center gap-1 h-11 px-3.5 rounded-xl border border-shift-field bg-white text-sm text-shift-ink hover:bg-[#F1F3F7] disabled:opacity-50">
          <Plus size={14} /> أضف
        </button>
      </div>
    </div>
  );
}

function BotCard({ biz, botEnabled, onBotChange, onSaved }) {
  const ai = biz.ai_config || {};
  const [f, setF] = useState({
    personality: ai.personality || '',
    greeting_message: ai.greeting_message || '',
    fallback_message: ai.fallback_message || '',
    handoff_keywords: Array.isArray(ai.handoff_keywords) ? ai.handoff_keywords : [],
    alert_wa_numbers: Array.isArray(ai.alert_wa_numbers) ? ai.alert_wa_numbers : [],
    out_of_hours_message: ai.out_of_hours_message || '',
  });
  const [hours, setHours] = useState(() => normaliseHours(biz.opening_hours));
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const setDay = (i, patch) => setHours((h) => h.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  const s = useSave(biz.id, onSaved);

  return (
    <Card title="طريقة رد البوت">
      <div className="flex flex-col gap-3.5">
        {/* A div, not Field's label: a label would press the pause button when its text is clicked. */}
        <div className="flex flex-col gap-1.5">
          <span className={labelClass}>حالة البوت</span>
          <BotPauseControl accountId={biz.id} name={biz.name} enabled={botEnabled} onChange={onBotChange} />
        </div>
        <Field label="شخصية البوت"><input value={f.personality} onChange={set('personality')} className={input} /></Field>
        <Field label="رسالة الترحيب"><textarea rows={3} value={f.greeting_message} onChange={set('greeting_message')} className={area} /></Field>
        <Field label="رسالة التحويل للموظف"><textarea rows={2} value={f.fallback_message} onChange={set('fallback_message')} className={area} /></Field>
        <div>
          <span className={`block mb-1.5 ${labelClass}`}>كلمات تحوّل للموظف</span>
          <ListInput value={f.handoff_keywords} onChange={(v) => setF({ ...f, handoff_keywords: v })} placeholder="مثال: موظف" />
        </div>
        <div>
          <span className={`block mb-1.5 ${labelClass}`}>أرقام تنبيهات المحل</span>
          <ListInput value={f.alert_wa_numbers} onChange={(v) => setF({ ...f, alert_wa_numbers: v })}
            placeholder="0791234567" max={MAX_ALERT_NUMBERS} ltr />
          <span className="block mt-1.5 text-[12.5px] text-shift-muted">
            هنا تصل تنبيهات المحل: زبون يطلب موظفًا، أو رسالة لم يُرد عليها. حتى {MAX_ALERT_NUMBERS} أرقام.
            {!ai.alert_template && ' قالب التنبيه لم يُعتمد بعد عند Meta، فالتنبيه يصل فقط خلال 24 ساعة من آخر رسالة من الرقم.'}
          </span>
        </div>
        <Field label="رسالة خارج الدوام" hint="إذا كُتبت: من يراسل خارج الدوام تصله مرة في اليوم بدل رد البوت. فارغة: البوت يرد في كل وقت.">
          <textarea rows={2} value={f.out_of_hours_message} onChange={set('out_of_hours_message')} className={area} />
        </Field>
        <div>
          <span className={`block mb-1.5 ${labelClass}`}>أوقات الدوام</span>
          <ul className="m-0 p-0 list-none flex flex-col gap-1.5">
            {hours.map((d, i) => (
              <li key={d.day} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="w-16 shrink-0 text-shift-ink">{d.day}</span>
                {d.closed ? <span className="flex-1 text-shift-muted">مغلق</span> : (
                  <span className="flex-1 flex items-center gap-1.5" dir="ltr">
                    <input type="time" value={d.open} onChange={(e) => setDay(i, { open: e.target.value })} aria-label={`${d.day} يفتح`} className={timeInput} />
                    <span className="text-shift-muted">–</span>
                    <input type="time" value={d.close} onChange={(e) => setDay(i, { close: e.target.value })} aria-label={`${d.day} يغلق`} className={timeInput} />
                  </span>
                )}
                <label className="shrink-0 inline-flex items-center gap-1.5 min-h-[40px] text-[13px] text-shift-body">
                  <input type="checkbox" checked={d.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} className="w-4 h-4" /> مغلق
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <SaveBar {...s} onSave={() => s.save({ ai_config: f, opening_hours: hours })} />
    </Card>
  );
}

function DeliveryCard({ biz, onSaved }) {
  const p = biz.policies || {};
  const [f, setF] = useState({
    delivery_fee: p.delivery_fee ?? 0,
    min_order_amount: p.min_order_amount ?? 0,
    payment_methods: Array.isArray(p.payment_methods) ? p.payment_methods : [],
    delivery_policy: p.delivery_policy || '',
  });
  const s = useSave(biz.id, onSaved);
  return (
    <Card title="التوصيل والطلبات">
      <div className="grid gap-3.5 sm:grid-cols-2">
        <Field label="رسوم التوصيل (د.أ)">
          <input type="number" step="0.1" min="0" dir="ltr" value={f.delivery_fee}
            onChange={(e) => setF({ ...f, delivery_fee: parseFloat(e.target.value) || 0 })} className={input} />
        </Field>
        <Field label="الحد الأدنى للطلب (د.أ)">
          <input type="number" step="0.1" min="0" dir="ltr" value={f.min_order_amount}
            onChange={(e) => setF({ ...f, min_order_amount: parseFloat(e.target.value) || 0 })} className={input} />
        </Field>
        <div className="sm:col-span-2">
          <span className={`block mb-1.5 ${labelClass}`}>طرق الدفع عند الاستلام</span>
          <ListInput value={f.payment_methods} onChange={(v) => setF({ ...f, payment_methods: v })} placeholder="مثال: نقدًا" />
        </div>
        <div className="sm:col-span-2">
          <Field label="سياسة التوصيل">
            <textarea rows={2} value={f.delivery_policy} onChange={(e) => setF({ ...f, delivery_policy: e.target.value })} className={area} />
          </Field>
        </div>
      </div>
      {/* The whole policies object: the server replaces it, so other keys are carried over. */}
      <SaveBar {...s} onSave={() => s.save({ policies: { ...(biz.policies || {}), ...f } })} />
    </Card>
  );
}

export default function AccountSettingsTab({ biz, botEnabled, onBotChange, onSaved }) {
  return (
    <div className="max-w-[760px] flex flex-col gap-4">
      <BotCard biz={biz} botEnabled={botEnabled} onBotChange={onBotChange} onSaved={onSaved} />
      {biz.business_type === 'restaurant' && <DeliveryCard biz={biz} onSaved={onSaved} />}
      <GeneralCard biz={biz} onSaved={onSaved} />
    </div>
  );
}
