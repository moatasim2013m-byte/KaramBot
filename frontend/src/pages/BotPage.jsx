import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Save, X, Plus, ArrowLeft, Bell, UtensilsCrossed, Stethoscope } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import KnowledgeByGroup from '../components/whatsapp/KnowledgeByGroup';
import KnowledgeGaps from '../components/whatsapp/KnowledgeGaps';
import TryTheBot from '../components/whatsapp/TryTheBot';
import { Ltr } from '../components/shared/Primitives';

/**
 * «البوت» — everything about what the bot says, on one page.
 *
 * The owner sees every card: the pause switch, what the bot knows, what it did not know, the
 * tester, how it replies and where its alerts go. A manager sees knowledge, gaps and the tester
 * only: the bot's voice and switch are the owner's (PATCH /businesses/:id refuses ai_config from
 * anyone else, so hiding those cards is honesty, not the protection).
 */

const input = 'w-full rounded-md border border-gray-200 px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-green-500';

function Card({ title, children, footer }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex items-center px-4 h-11 border-b border-gray-100">
        <h3 className="text-[14px] font-semibold text-gray-800">{title}</h3>
      </header>
      <div className="p-4 space-y-3">{children}</div>
      {footer}
    </section>
  );
}

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] font-medium text-gray-700 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-gray-500">{hint}</span>}
    </label>
  );
}

function SaveBar({ busy, saved, error, onSave, label = 'احفظ' }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100">
      <button type="button" onClick={onSave} disabled={busy}
        className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-green-600 text-white text-[13px] font-medium disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} {label}
      </button>
      {saved && <span className="text-[12px] text-emerald-700">تم الحفظ</span>}
      {error && <span className="text-[12px] text-red-700">{error}</span>}
    </div>
  );
}

/** One PATCH with a busy, saved and error state, shared by every card on the page. */
function useSave(businessId, onSaved) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);
  const save = async (body) => {
    setBusy(true); setError(null); setSaved(false);
    try {
      const res = await api.patch(`/businesses/${businessId}`, body);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      if (onSaved) onSaved(res.data.business);
      return true;
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return { busy, saved, error, save };
}

// ─── حالة البوت ────────────────────────────────────────────────────────────────
function PauseCard({ biz, onSaved }) {
  const enabled = biz.ai_config?.enabled !== false;
  // SHIFT's pause (late payment, wrong prices) is SHIFT's to lift: the server refuses the owner's
  // resume with a 403, and the switch says so rather than inviting a tap that cannot work.
  const shiftPaused = !enabled && biz.ai_config?.paused_by === 'shift';
  const { busy, error, save } = useSave(biz.id, onSaved);
  // Through PATCH /businesses/:id with ai_config.enabled: the server writes bot_paused or
  // bot_resumed with the owner as the actor, so SHIFT sees who switched it and when.
  const flip = () => save({ ai_config: { enabled: !enabled } });

  return (
    <Card title="حالة البوت">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[14px] font-medium text-gray-900">البوت يرد على الزبائن</p>
          <p className={`text-[12px] mt-0.5 ${enabled ? 'text-emerald-700' : 'text-amber-800'}`}>
            {enabled ? 'يعمل ويرد على كل رسالة.'
              : shiftPaused ? 'أوقف فريق شِفت البوت — تواصل معهم لإعادة تشغيله. الرسائل تصلك في «المحادثات».'
                : 'موقوف مؤقتًا — الرسائل تصلك في «المحادثات».'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} onClick={flip} disabled={busy || shiftPaused}
          className={`relative shrink-0 w-14 h-8 rounded-full transition-colors disabled:opacity-50 ${enabled ? 'bg-green-600' : 'bg-gray-300'}`}>
          <span className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${enabled ? 'right-7' : 'right-1'}`} />
        </button>
      </div>
      {error && <p className="text-[12px] text-red-700">{error}</p>}
    </Card>
  );
}

// ─── طريقة الرد ────────────────────────────────────────────────────────────────
const DAYS = ['السبت', 'الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة'];

/**
 * opening_hours: the generic workflow pastes it into the prompt, and once the owner has written an
 * out-of-hours message the server enforces it for every shop type (services/openingHours.js). The
 * editor keeps
 * one row per day; rows of another shape (typed by SHIFT earlier) are kept in the day order and
 * filled with the defaults so the owner sees something editable rather than nothing.
 */
function normaliseHours(raw) {
  const byDay = new Map();
  if (Array.isArray(raw)) {
    for (const r of raw) if (r && typeof r === 'object' && DAYS.includes(r.day)) byDay.set(r.day, r);
  }
  return DAYS.map((day) => {
    const r = byDay.get(day) || {};
    return { day, open: r.open || '09:00', close: r.close || '21:00', closed: Boolean(r.closed) };
  });
}

function KeywordChips({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const add = () => {
    const w = draft.trim();
    if (w && !value.includes(w)) onChange([...value, w]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {value.map((w) => (
          <span key={w} className="inline-flex items-center gap-1 h-8 pr-3 pl-1 rounded-full bg-gray-100 text-[13px] text-gray-800">
            {w}
            <button type="button" onClick={() => onChange(value.filter((x) => x !== w))} className="p-1 text-gray-400 hover:text-red-600" title="حذف">
              <X size={12} />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-2 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="مثال: موظف"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={input} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          className="shrink-0 inline-flex items-center gap-1 h-10 px-3 rounded-md border border-gray-200 text-[13px] text-gray-700 disabled:opacity-40">
          <Plus size={13} /> أضف
        </button>
      </div>
    </div>
  );
}

function ReplyCard({ biz, onSaved }) {
  const ai = biz.ai_config || {};
  const [greeting, setGreeting] = useState(ai.greeting_message || '');
  const [fallback, setFallback] = useState(ai.fallback_message || '');
  const [keywords, setKeywords] = useState(Array.isArray(ai.handoff_keywords) ? ai.handoff_keywords : []);
  const [outOfHours, setOutOfHours] = useState(ai.out_of_hours_message || '');
  const [hours, setHours] = useState(() => normaliseHours(biz.opening_hours));
  const { busy, saved, error, save } = useSave(biz.id, onSaved);

  const setDay = (i, patch) => setHours((h) => h.map((d, k) => (k === i ? { ...d, ...patch } : d)));

  // Only these keys: the server merges ai_config with `||`, so nothing else of the bot's settings
  // (the pause above all) is touched by saving a greeting.
  const onSave = () => save({
    ai_config: {
      greeting_message: greeting,
      fallback_message: fallback,
      handoff_keywords: keywords,
      out_of_hours_message: outOfHours,
    },
    opening_hours: hours,
  });

  return (
    <Card title="طريقة الرد" footer={<SaveBar busy={busy} saved={saved} error={error} onSave={onSave} />}>
      <Field label="رسالة الترحيب" hint="أول ما يقرأه الزبون حين يراسلك.">
        <textarea rows={3} value={greeting} onChange={(e) => setGreeting(e.target.value)} className={`${input} resize-none`} />
      </Field>
      <Field label="رسالة التحويل للموظف" hint="يقولها البوت حين يسلّم المحادثة لك أو لفريقك.">
        <textarea rows={2} value={fallback} onChange={(e) => setFallback(e.target.value)} className={`${input} resize-none`} />
      </Field>
      <div>
        <span className="block text-[13px] font-medium text-gray-700 mb-1">كلمات تحوّل للموظف</span>
        <KeywordChips value={keywords} onChange={setKeywords} />
        <span className="block mt-1 text-[11px] text-gray-500">إذا كتب الزبون إحدى هذه الكلمات تصلك المحادثة مباشرة.</span>
      </div>
      <Field label="رسالة خارج الدوام"
        hint="إذا كتبتها: من يراسلك خارج أوقات الدوام أدناه تصله هذه الرسالة مرة في اليوم بدل رد البوت، وتصلك محادثته في «المحادثات». اتركها فارغة ليرد البوت في كل وقت.">
        <textarea rows={2} value={outOfHours} onChange={(e) => setOutOfHours(e.target.value)}
          placeholder="مثال: أهلًا! نحن مغلقون الآن ونرد عليك أول ما نفتح." className={`${input} resize-none`} />
      </Field>
      <div>
        <span className="block text-[13px] font-medium text-gray-700 mb-1">أوقات الدوام</span>
        <ul className="space-y-1.5">
          {hours.map((d, i) => (
            <li key={d.day} className="flex items-center gap-2 text-[13px]">
              <span className="w-16 shrink-0 text-gray-700">{d.day}</span>
              {d.closed ? (
                <span className="flex-1 text-gray-400">مغلق</span>
              ) : (
                <span className="flex-1 flex items-center gap-1.5" dir="ltr">
                  <input type="time" value={d.open} onChange={(e) => setDay(i, { open: e.target.value })}
                    className="h-9 rounded-md border border-gray-200 px-2 text-[13px]" />
                  <span className="text-gray-400">–</span>
                  <input type="time" value={d.close} onChange={(e) => setDay(i, { close: e.target.value })}
                    className="h-9 rounded-md border border-gray-200 px-2 text-[13px]" />
                </span>
              )}
              <label className="shrink-0 inline-flex items-center gap-1 text-[12px] text-gray-600">
                <input type="checkbox" checked={d.closed} onChange={(e) => setDay(i, { closed: e.target.checked })} /> مغلق
              </label>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}

// ─── إلى أين تصل التنبيهات ──────────────────────────────────────────────────────
const MAX_ALERT_NUMBERS = 5; // the owner's mobile plus up to 4 more

function AlertsCard({ biz, ownerPhone, onSaved }) {
  const [numbers, setNumbers] = useState(Array.isArray(biz.ai_config?.alert_wa_numbers) ? biz.ai_config.alert_wa_numbers : []);
  const [draft, setDraft] = useState('');
  const { busy, saved, error, save } = useSave(biz.id, (b) => {
    if (Array.isArray(b?.ai_config?.alert_wa_numbers)) setNumbers(b.ai_config.alert_wa_numbers);
    if (onSaved) onSaved(b);
  });
  const templateReady = Boolean(biz.ai_config?.alert_template);

  const add = () => {
    const n = draft.trim();
    if (!n || numbers.includes(n) || numbers.length >= MAX_ALERT_NUMBERS) return;
    setNumbers([...numbers, n]);
    setDraft('');
  };

  // A number typed but not yet added with «أضف» still counts: a save that drops it is a lost alert.
  const onSave = () => {
    const pending = draft.trim();
    const list = pending && !numbers.includes(pending) && numbers.length < MAX_ALERT_NUMBERS ? [...numbers, pending] : numbers;
    setDraft('');
    save({ ai_config: { alert_wa_numbers: list } });
  };

  return (
    <Card title="إلى أين تصل التنبيهات" footer={<SaveBar busy={busy} saved={saved} error={error} onSave={onSave} />}>
      <p className="text-[12px] text-gray-600 leading-relaxed">
        نرسل على هذه الأرقام حين يطلب زبون موظفًا، أو لا يعرف البوت الجواب، أو ترفض واتساب توصيل رسالة. بدون رقم هنا لا يعرف أحد.
      </p>
      {ownerPhone && !numbers.some((n) => n.replace(/\D/g, '').endsWith(ownerPhone.replace(/\D/g, '').slice(-9))) && (
        <button type="button" onClick={() => numbers.length < MAX_ALERT_NUMBERS && setNumbers([...numbers, ownerPhone])}
          className="text-[12px] text-green-700 underline underline-offset-2">
          أضف رقمي <Ltr>{ownerPhone}</Ltr>
        </button>
      )}
      <ul className="space-y-1.5">
        {numbers.map((n) => (
          <li key={n} className="flex items-center justify-between h-10 px-3 rounded-md bg-gray-50">
            <Ltr className="text-[14px] text-gray-800">{n}</Ltr>
            <button type="button" onClick={() => setNumbers(numbers.filter((x) => x !== n))} className="p-1.5 text-gray-400 hover:text-red-600" title="حذف">
              <X size={14} />
            </button>
          </li>
        ))}
        {numbers.length === 0 && <li className="text-[12px] text-amber-800">لا يوجد رقم بعد.</li>}
      </ul>
      {numbers.length < MAX_ALERT_NUMBERS && (
        <div className="flex gap-2">
          <input value={draft} onChange={(e) => setDraft(e.target.value)} dir="ltr" inputMode="tel" placeholder="07XXXXXXXX"
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={input} />
          <button type="button" onClick={add} disabled={!draft.trim()}
            className="shrink-0 inline-flex items-center gap-1 h-10 px-3 rounded-md border border-gray-200 text-[13px] text-gray-700 disabled:opacity-40">
            <Plus size={13} /> أضف
          </button>
        </div>
      )}
      <p className="flex items-center gap-1.5 text-[12px] text-gray-600">
        <Bell size={12} className={templateReady ? 'text-emerald-600' : 'text-amber-600'} />
        التنبيهات خارج 24 ساعة: {templateReady ? 'مفعّلة' : 'بانتظار موافقة Meta على القالب'}
      </p>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function BotPage() {
  const { user } = useAuth();
  const [biz, setBiz] = useState(null);
  const [error, setError] = useState(null);
  const [menuCount, setMenuCount] = useState(null);
  const owner = user?.role === 'business_owner' || user?.role === 'platform_admin';
  const bizType = user?.business_type;

  const load = useCallback(() => {
    if (!user?.business_id) return;
    api.get(`/businesses/${user.business_id}`)
      .then((r) => { setBiz(r.data.business); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل إعدادات البوت'));
  }, [user?.business_id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (bizType !== 'restaurant') return;
    api.get('/menu/full')
      .then((r) => setMenuCount((r.data.menu || []).reduce((n, c) => n + (c.items?.length || 0), 0)))
      .catch(() => setMenuCount(null));
  }, [bizType]);

  // The saved row comes back from the PATCH; taking it keeps every card on the same truth.
  const onSaved = (b) => { if (b) setBiz(b); };

  if (!user?.business_id) return <p className="text-center py-16 text-gray-500 text-sm">لا يوجد حساب محل مرتبط بهذا المستخدم.</p>;
  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!biz) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  // Restaurants and clinics answer from their menu or their services first, so for those two the
  // card points at where that knowledge is. Their bots also read the notes below (the answers
  // taught from «ما عرف يجاوب» land there), so the notes are shown for every shop.
  const catalogue = bizType === 'restaurant'
    ? { to: '/menu', Icon: UtensilsCrossed, label: menuCount != null ? `القائمة (${menuCount} صنفًا)` : 'القائمة' }
    : bizType === 'clinic'
      ? { to: '/clinic', Icon: Stethoscope, label: 'الخدمات والأطباء' }
      : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">البوت</h1>

      {owner && <PauseCard biz={biz} onSaved={onSaved} />}

      {catalogue && (
        <Link to={catalogue.to} className="flex items-center justify-between gap-3 rounded-xl border border-gray-200 bg-white px-4 h-14">
          <span className="flex items-center gap-2 text-[14px] font-semibold text-gray-800">
            <catalogue.Icon size={17} className="text-green-600" />
            ماذا يعرف البوت: {catalogue.label}
          </span>
          <ArrowLeft size={16} className="text-gray-400" />
        </Link>
      )}
      {/* sector from GET /businesses/:id (a pharmacy is business_type 'generic'), else /me's. */}
      <KnowledgeByGroup sector={biz.sector || user?.sector || bizType} />

      <KnowledgeGaps />

      <TryTheBot />

      {owner && <ReplyCard biz={biz} onSaved={onSaved} />}
      {owner && <AlertsCard biz={biz} ownerPhone={user?.phone} onSaved={onSaved} />}
    </div>
  );
}
