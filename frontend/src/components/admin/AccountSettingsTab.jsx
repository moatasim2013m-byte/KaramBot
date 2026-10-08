import { useState } from 'react';
import { Save, Plus, X } from 'lucide-react';
import api from '../../utils/api';
import { Panel } from '../shared/Primitives';
import BotPauseControl from './BotPauseControl';

/**
 * «الإعدادات» — the shop's general, AI and policy settings on one tab, aware of its type.
 *
 * It replaces three tabs (عام · الذكاء الاصطناعي · السياسات). Delivery fields show for restaurants
 * only, because no other shop delivers through the bot. «أرقام التنبيهات» is where the bot reaches
 * a human, and «رسالة خارج الدوام» with the opening hours is what a customer gets at night.
 *
 * Each card saves only its own keys. ai_config never carries `enabled`: the pause is its own
 * switch (BotPauseControl), so a form opened before a pause cannot switch the bot back on.
 */

const input = 'w-full h-9 border border-gray-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-gray-400';
const area = 'w-full border border-gray-200 rounded-md px-3 py-2 text-[13px] resize-none focus:outline-none focus:ring-1 focus:ring-gray-400';

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
    <label className="block">
      <span className="block text-[12px] text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-gray-400">{hint}</span>}
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
    <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100">
      <button type="button" onClick={onSave} disabled={busy}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gray-900 text-white text-[13px] disabled:opacity-50">
        <Save size={13} /> {busy ? 'جارٍ…' : 'احفظ'}
      </button>
      {saved && <span className="text-[12px] text-emerald-700">تم الحفظ</span>}
      {error && <span className="text-[12px] text-red-700">{error}</span>}
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
    <Panel title="عام">
      <div className="p-4 grid gap-3 sm:grid-cols-2">
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
    </Panel>
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
          <span key={v} className="inline-flex items-center gap-1 h-7 pr-2.5 pl-1 rounded-full bg-gray-100 text-[12px] text-gray-800">
            {ltr ? <span dir="ltr" className="tabular-nums">{v}</span> : v}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== v))} className="p-0.5 text-gray-400 hover:text-red-600" title="حذف">
              <X size={11} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={placeholder} dir={ltr ? 'ltr' : undefined}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={input} />
        <button type="button" onClick={add} disabled={!draft.trim() || (max && value.length >= max)}
          className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-md border border-gray-200 text-[12px] text-gray-700 disabled:opacity-40">
          <Plus size={12} /> أضف
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
    <Panel title="البوت">
      <div className="p-4 space-y-3">
        <Field label="حالة البوت">
          <BotPauseControl accountId={biz.id} enabled={botEnabled} onChange={onBotChange} />
        </Field>
        <Field label="شخصية البوت"><input value={f.personality} onChange={set('personality')} className={input} /></Field>
        <Field label="رسالة الترحيب"><textarea rows={3} value={f.greeting_message} onChange={set('greeting_message')} className={area} /></Field>
        <Field label="رسالة التحويل للموظف"><textarea rows={2} value={f.fallback_message} onChange={set('fallback_message')} className={area} /></Field>
        <div>
          <span className="block text-[12px] text-gray-600 mb-1">كلمات تحوّل للموظف</span>
          <ListInput value={f.handoff_keywords} onChange={(v) => setF({ ...f, handoff_keywords: v })} placeholder="مثال: موظف" />
        </div>
        <div>
          <span className="block text-[12px] text-gray-600 mb-1">أرقام التنبيهات</span>
          <ListInput value={f.alert_wa_numbers} onChange={(v) => setF({ ...f, alert_wa_numbers: v })}
            placeholder="0791234567" max={MAX_ALERT_NUMBERS} ltr />
          <span className="block mt-1 text-[11px] text-gray-400">
            هنا تصل تنبيهات المحل: زبون يطلب موظفًا، أو رسالة لم يُرد عليها. حتى {MAX_ALERT_NUMBERS} أرقام.
            {!ai.alert_template && ' قالب التنبيه لم يُعتمد بعد عند Meta، فالتنبيه يصل فقط خلال 24 ساعة من آخر رسالة من الرقم.'}
          </span>
        </div>
        <Field label="رسالة خارج الدوام" hint="إذا كُتبت: من يراسل خارج الدوام تصله مرة في اليوم بدل رد البوت. فارغة: البوت يرد في كل وقت.">
          <textarea rows={2} value={f.out_of_hours_message} onChange={set('out_of_hours_message')} className={area} />
        </Field>
        <div>
          <span className="block text-[12px] text-gray-600 mb-1">أوقات الدوام</span>
          <ul className="space-y-1">
            {hours.map((d, i) => (
              <li key={d.day} className="flex items-center gap-2 text-[13px]">
                <span className="w-16 shrink-0 text-gray-700">{d.day}</span>
                {d.closed ? <span className="flex-1 text-gray-400">مغلق</span> : (
                  <span className="flex-1 flex items-center gap-1.5" dir="ltr">
                    <input type="time" value={d.open} onChange={(e) => setDay(i, { open: e.target.value })} className="h-8 rounded-md border border-gray-200 px-2 text-[12px]" />
                    <span className="text-gray-400">–</span>
                    <input type="time" value={d.close} onChange={(e) => setDay(i, { close: e.target.value })} className="h-8 rounded-md border border-gray-200 px-2 text-[12px]" />
                  </span>
                )}
                <label className="shrink-0 inline-flex items-center gap-1 text-[12px] text-gray-600">
                  <input type="checkbox" checked={d.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} /> مغلق
                </label>
              </li>
            ))}
          </ul>
        </div>
      </div>
      <SaveBar {...s} onSave={() => s.save({ ai_config: f, opening_hours: hours })} />
    </Panel>
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
    <Panel title="التوصيل والطلبات">
      <div className="p-4 grid gap-3 sm:grid-cols-2">
        <Field label="رسوم التوصيل (د.أ)">
          <input type="number" step="0.1" min="0" dir="ltr" value={f.delivery_fee}
            onChange={(e) => setF({ ...f, delivery_fee: parseFloat(e.target.value) || 0 })} className={input} />
        </Field>
        <Field label="الحد الأدنى للطلب (د.أ)">
          <input type="number" step="0.1" min="0" dir="ltr" value={f.min_order_amount}
            onChange={(e) => setF({ ...f, min_order_amount: parseFloat(e.target.value) || 0 })} className={input} />
        </Field>
        <div className="sm:col-span-2">
          <span className="block text-[12px] text-gray-600 mb-1">طرق الدفع عند الاستلام</span>
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
    </Panel>
  );
}

export default function AccountSettingsTab({ biz, botEnabled, onBotChange, onSaved }) {
  return (
    <div className="space-y-4">
      <GeneralCard biz={biz} onSaved={onSaved} />
      <BotCard biz={biz} botEnabled={botEnabled} onBotChange={onBotChange} onSaved={onSaved} />
      {biz.business_type === 'restaurant' && <DeliveryCard biz={biz} onSaved={onSaved} />}
    </div>
  );
}
