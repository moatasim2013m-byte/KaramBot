import { useCallback, useEffect, useState } from 'react';
import { Plus, X, AlertTriangle, Lock } from 'lucide-react';
import { Ltr } from '../../components/shared/Primitives';
import { PageHeader, Button, fieldClass, labelClass, Footnote } from '../../components/admin/ui';
import api from '../../utils/api';

/**
 * «إعدادات المنصة» — SHIFT's own switches and defaults, not any shop's.
 *
 * Every field is a PlatformSetting row (services/platformSettings.js holds the defaults, so an
 * untouched field shows what the platform is actually running on). The page is four sections, each
 * with its own save: a section saves only the keys changed in it, after one confirmation, and the
 * server writes platform_setting_changed with the before and after for each.
 *
 * Three switches open something wide and never ride on a section's save. Owner self-connect
 * (es_owner_enabled) stays locked until the spare-SIM run (G1) has passed: the server has no G1
 * record to check, so opening it asks the operator to type that G1 passed, on top of the old
 * confirmation. Public self-signup («جرّب مجانًا», P5) and coexistence (P5, off for October —
 * fresh SIMs only) ask for a sentence the server checks (adminPlatform.js CONFIRM_TO_ENABLE). The
 * Meta ids come from the deployment and are shown read-only. Secrets never appear on this page.
 */

const G1_SENTENCE = 'نجحت تجربة الشريحة الاحتياطية';
const PROVIDER_DOWN_MS = 15 * 60000; // accountHealth.providerDown

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

function SField({ id, label, hint, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelClass}>{label}</label>
      {children}
      {hint && <span className="text-[12.5px] text-shift-muted">{hint}</span>}
    </div>
  );
}

function NumberInput({ id, value, onChange, min = 0 }) {
  return (
    <input id={id} type="number" min={min} dir="ltr" value={value ?? ''} onChange={(e) => onChange(num(e.target.value))}
      className={`${fieldClass} text-right tabular-nums`} />
  );
}

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className="shrink-0 min-h-[44px] px-1 grid place-items-center disabled:opacity-50 disabled:cursor-not-allowed">
      <span className={`relative block w-12 h-7 rounded-full transition-colors ${checked ? 'bg-shift-ok' : 'bg-shift-field'}`}>
        <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'right-6' : 'right-1'}`} />
      </span>
    </button>
  );
}

function Msg({ msg }) {
  if (!msg) return null;
  return <p role="status" className={`m-0 text-[13px] ${msg.tone === 'error' ? 'text-shift-danger' : 'text-shift-ok'}`}>{msg.text}</p>;
}

function Warn({ children, tone = 'warn' }) {
  const cls = tone === 'bad' ? 'text-shift-danger bg-shift-dangerBg border-shift-dangerLine' : 'text-shift-warn bg-shift-warnBg border-transparent';
  return (
    <p className={`m-0 flex items-start gap-2 text-[13px] border rounded-xl px-3.5 py-2.5 ${cls}`}>
      <AlertTriangle size={15} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * One section: a draft per PlatformSetting key it holds, one save for the keys changed, one
 * confirmation. Each key resets to its stored value when that value changes, not when another
 * section saves: an unsaved edit in one section must survive a save in the next.
 */
function Section({ id, title, sub, keys, settings, onSaved, saveLabel, note, confirmText, top, children }) {
  const stored = JSON.stringify(keys.map((k) => settings?.[k] ?? null));
  const [draft, setDraft] = useState(() => Object.fromEntries(keys.map((k) => [k, settings?.[k]])));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    const values = JSON.parse(stored);
    setDraft(Object.fromEntries(keys.map((k, i) => [k, values[i]])));
  }, [stored]); // eslint-disable-line react-hooks/exhaustive-deps

  const changed = keys.filter((k) => JSON.stringify(draft[k] ?? null) !== JSON.stringify(settings?.[k] ?? null));
  const setKey = (k) => (v) => setDraft((d) => ({ ...d, [k]: typeof v === 'function' ? v(d[k]) : v }));

  const save = async () => {
    if (!changed.length) return;
    if (!window.confirm(confirmText || `حفظ «${title}»؟ يُطبَّق على كل المحلات خلال دقيقة.`)) return;
    setBusy(true); setMsg(null);
    // One PATCH per key, in order: a refused value stops the rest and says which field it was.
    for (const k of changed) {
      try {
        const res = await api.patch('/admin/platform-settings', { key: k, value: draft[k] });
        onSaved(k, res.data?.value !== undefined ? res.data.value : draft[k]);
      } catch (err) {
        setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' });
        setBusy(false);
        return;
      }
    }
    setMsg({ tone: 'ok', text: 'تم الحفظ' });
    setBusy(false);
  };

  return (
    <section aria-labelledby={id} className="bg-white border border-shift-line rounded-2xl px-[22px] py-5 flex flex-col gap-4">
      <div>
        <h2 id={id} className="m-0 font-display text-lg font-semibold text-shift-ink">{title}</h2>
        {sub && <p className="mt-1 mb-0 text-[13.5px] text-shift-body">{sub}</p>}
      </div>
      {top}
      {children && children(draft, setKey)}
      {keys.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-shift-line2">
          <span className="flex-[1_1_260px] text-[13px] text-shift-body">{note}</span>
          <Button variant="primary" onClick={save} disabled={busy || !changed.length}>{busy ? 'جارٍ…' : saveLabel}</Button>
          <div className="basis-full"><Msg msg={msg} /></div>
        </div>
      )}
    </section>
  );
}

function NumbersList({ id, value, onChange }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(value) ? value : [];
  const add = () => {
    const n = draft.trim();
    if (n && !list.includes(n)) onChange([...list, n]);
    setDraft('');
  };
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-[13px] text-shift-muted">لا أرقام بعد — تنبيهات شِفت لا تصل لأحد.</span>}
        {list.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 min-h-[36px] pr-3 pl-1 rounded-full bg-shift-line2 text-[13px] text-shift-ink">
            <span dir="ltr" className="tabular-nums">{n}</span>
            <button type="button" onClick={() => onChange(list.filter((x) => x !== n))} aria-label={`حذف ${n}`}
              className="w-8 h-8 grid place-items-center rounded-full text-shift-muted hover:text-shift-danger"><X size={14} /></button>
          </span>
        ))}
      </div>
      <div className="flex gap-2">
        <input id={id} value={draft} onChange={(e) => setDraft(e.target.value)} dir="ltr" placeholder="0791234567"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={`${fieldClass} text-right`} />
        <Button onClick={add} disabled={!draft.trim()} className="shrink-0"><Plus size={16} /> أضف</Button>
      </div>
    </div>
  );
}

/** The AI provider line: provider_status is written by the code when the AI fails, never here. */
function ProviderLine({ status }) {
  const last = status?.last_seen ? new Date(status.last_seen) : null;
  const down = last && Date.now() - last.getTime() >= 0 && Date.now() - last.getTime() < PROVIDER_DOWN_MS;
  const when = last ? last.toLocaleString('ar-JO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }) : null;
  return (
    <div className="flex flex-wrap items-center gap-2.5 px-3.5 py-3 rounded-xl bg-shift-canvas text-sm">
      <span aria-hidden="true" className={`w-2 h-2 rounded-full ${down ? 'bg-shift-danger' : 'bg-shift-ok'}`} />
      <b className="font-semibold">{down ? 'المزوّد متعطّل الآن' : 'المزوّد يعمل'}</b>
      <span className="text-shift-body">
        {last ? `· آخر تعطّل: ${when}${status.provider ? ` (${status.provider}${status.kind ? ` · ${status.kind}` : ''})` : ''}` : '· لم يُسجَّل أي تعطّل'}
      </span>
    </div>
  );
}

/**
 * «السماح للزبائن بربط واتساب بأنفسهم» (es_owner_enabled). Locked while off: the button that opens
 * it asks for the G1 sentence typed back and then the old confirmation. Closing needs only a
 * confirm — off is the safe side.
 */
function SelfConnect({ on, onSaved }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const flip = async () => {
    if (!on) {
      const typed = window.prompt(`الربط الذاتي يبقى مغلقًا حتى تنجح تجربة الربط الحقيقي على شريحة احتياطية (G1). بعد الفتح يربط كل صاحب محل واتساب بنفسه من لوحته.\n\nإن نجحت التجربة فعلًا، اكتب للتأكيد:\n${G1_SENTENCE}`);
      if (typed === null) return;
      if (typed.replace(/\s+/g, ' ').trim() !== G1_SENTENCE) { setMsg({ tone: 'error', text: 'العبارة غير مطابقة — بقي الربط الذاتي مغلقًا.' }); return; }
      if (!window.confirm('فتح الربط الذاتي لأصحاب المحلات؟ لا تفتحه قبل نجاح أول ربط حقيقي (G1) على شريحة احتياطية. بعد الفتح يربط كل صاحب محل واتساب بنفسه من لوحته.')) return;
    } else if (!window.confirm('إغلاق الربط الذاتي؟ لن يرى أصحاب المحلات زر «اربط واتساب»، وتربط شِفت معهم.')) {
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await api.patch('/admin/platform-settings', { key: 'es_owner_enabled', value: !on });
      onSaved('es_owner_enabled', res.data?.value !== undefined ? res.data.value : !on);
      setMsg({ tone: 'ok', text: 'تم الحفظ' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-2 p-3.5 rounded-xl border border-dashed border-shift-field">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-[1_1_260px]">
          <b className="font-semibold">السماح للزبائن بربط واتساب بأنفسهم</b>
          <div className="text-[13px] text-shift-body">
            {on ? 'مفتوح — كل صاحب محل يربط واتساب بنفسه من لوحته.' : 'يُفتح بعد نجاح تجربة الشريحة. إلى ذلك الحين تربط شِفت مع صاحب المحل من صفحة المحل.'}
          </div>
        </div>
        {on ? (
          <Button variant="danger" onClick={flip} disabled={busy}>{busy ? 'جارٍ…' : 'أغلق الربط الذاتي'}</Button>
        ) : (
          <button type="button" disabled aria-disabled="true"
            className="inline-flex items-center gap-1.5 min-h-[44px] px-4 rounded-xl border border-shift-line bg-shift-canvas text-shift-muted text-sm cursor-not-allowed">
            <Lock size={14} /> مغلق
          </button>
        )}
      </div>
      {!on && (
        <button type="button" onClick={flip} disabled={busy}
          className="self-start min-h-[40px] p-0 border-0 bg-transparent text-[13px] text-shift-accent hover:text-shift-ink disabled:opacity-50">
          {busy ? 'جارٍ…' : 'نجحت تجربة الشريحة؟ افتح الربط الذاتي…'}
        </button>
      )}
      <Msg msg={msg} />
    </div>
  );
}

/**
 * «التسجيل الذاتي العام»: the daily cap saves on its own; turning it ON asks for the typed
 * confirmation sentence the server sent (confirm_to_enable.self_signup) and passes it along.
 */
function SelfSignup({ settings, onSaved, confirmSentence }) {
  const [draft, setDraft] = useState(settings?.self_signup);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);
  const stored = JSON.stringify(settings?.self_signup ?? null);
  useEffect(() => { setDraft(JSON.parse(stored)); }, [stored]);
  const dirty = JSON.stringify(draft ?? null) !== stored;
  const wasOn = Boolean(settings?.self_signup?.enabled);
  const opening = !wasOn && Boolean(draft?.enabled);
  // The server refuses to open it while owner self-connect is closed: a self-signed shop could not
  // connect WhatsApp without SHIFT. Said here before the operator types the sentence.
  const esOwnerOff = settings?.es_owner_enabled !== true;

  const save = async () => {
    const body = { key: 'self_signup', value: draft };
    if (opening) {
      const sentence = confirmSentence || 'افتح التسجيل العام';
      const typed = window.prompt(`فتح التسجيل العام يسمح لأي محل لم تقابله بإنشاء حساب وتجربة كرم بوت، حتى ${draft?.daily_cap ?? 5} محلات في اليوم. للتأكيد اكتب: ${sentence}`);
      if (typed === null) return;
      body.confirm = typed;
    } else if (!window.confirm(wasOn && !draft?.enabled
      ? 'إغلاق التسجيل العام؟ تعود صفحة «جرّب مجانًا» إلى «التسجيل عبر دعوة من شِفت فقط». الحسابات التي سجّلت تبقى.'
      : 'حفظ الحد اليومي للتسجيل العام؟')) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.patch('/admin/platform-settings', body);
      onSaved('self_signup', res.data?.value !== undefined ? res.data.value : draft);
      setMsg({ tone: 'ok', text: 'تم الحفظ' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3 pt-4 border-t border-shift-line2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <b className="font-semibold">التسجيل الذاتي العام</b>
          <p className="m-0 text-[13px] text-shift-body">صفحة «جرّب مجانًا» بدون دعوة. مغلقة حتى بعد أول 10 زبائن، ويصلك تنبيه مع كل محل يسجّل بنفسه.</p>
        </div>
        <Toggle checked={Boolean(draft?.enabled)} onChange={(v) => setDraft((d) => ({ ...d, enabled: v }))} label="التسجيل الذاتي العام" />
      </div>
      <SField id="st-signup-cap" label="أقصى عدد تسجيلات في اليوم" hint="يُعدّ بتوقيت عمّان. بعده تقول الصفحة: اكتملت تسجيلات اليوم.">
        <NumberInput id="st-signup-cap" value={draft?.daily_cap} onChange={(n) => setDraft((d) => ({ ...d, daily_cap: n }))} min={1} />
      </SField>
      {esOwnerOff && (opening || wasOn) && (
        <Warn tone="bad">«الربط الذاتي» مغلق: من يسجّل بنفسه لن يستطيع ربط واتساب دون فريق شِفت. افتحه أولًا.</Warn>
      )}
      {opening && !esOwnerOff && <Warn>عند الحفظ ستُطلب منك كتابة عبارة التأكيد.</Warn>}
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={save} disabled={busy || !dirty}>{busy ? 'جارٍ…' : 'حفظ التسجيل العام'}</Button>
        <Msg msg={msg} />
      </div>
    </div>
  );
}

/**
 * «التطبيق والمنصة معًا» (coexistence, P5). Switching it on needs the sentence the server sends
 * (confirm_to_enable.coexistence) typed back, because it changes what every shop's connect
 * screen offers and holds SHIFT to Meta's 24-hour sync for each such number. Off needs only a
 * confirm.
 */
function Coexistence({ value, confirmText, onSaved }) {
  const on = Boolean(value?.enabled);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const flip = async () => {
    let confirm;
    if (!on) {
      confirm = window.prompt(
        `تفعيل الربط مع تطبيق واتساب للأعمال؟ سيظهر لكل محل خيار «رقم المحل الحالي وعليه واتساب»، وتلتزم شِفت بمزامنة كل رقم خلال 24 ساعة.\n\nللتأكيد اكتب:\n${confirmText || ''}`,
      );
      if (confirm === null) return;
    } else if (!window.confirm('إيقاف الربط مع تطبيق واتساب للأعمال؟ يختفي الخيار من شاشة الربط. الأرقام المربوطة به تبقى تعمل.')) {
      return;
    }
    setBusy(true); setMsg(null);
    try {
      const res = await api.patch('/admin/platform-settings', { key: 'coexistence', value: { enabled: !on }, confirm });
      onSaved('coexistence', res.data?.value !== undefined ? res.data.value : { enabled: !on });
      setMsg({ tone: 'ok', text: 'تم الحفظ' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' });
    } finally { setBusy(false); }
  };

  return (
    <div className="flex flex-col gap-3 pt-4 border-t border-shift-line2">
      <div className="flex items-center justify-between gap-3">
        <div>
          <b className="font-semibold">رقم واتساب موصول بتطبيق الهاتف (Coexistence)</b>
          <p className="m-0 text-[13px] text-shift-body">
            خيار «رقم المحل الحالي وعليه واتساب» في شاشة الربط — {on ? 'مفعّل' : 'مغلق، كل محل يربط شريحة جديدة'}.
          </p>
        </div>
        <Toggle checked={on} onChange={flip} disabled={busy} label="الربط مع تطبيق واتساب للأعمال" />
      </div>
      <Warn>
        جرّبه أولًا على رقم محل واحد صديق في إربد (دعم الأرقام الأردنية لم يُتحقق منه بعد). بعد كل ربط تطلب شِفت من Meta مزامنة جهات الاتصال والمحادثات خلال 24 ساعة، ويصلك تنبيه إن لم تكتمل بعد 20 ساعة.
      </Warn>
      <Msg msg={msg} />
    </div>
  );
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState(null);
  const [confirmTexts, setConfirmTexts] = useState({});
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/platform-settings')
      .then((res) => { setSettings(res.data?.settings || {}); setConfirmTexts(res.data?.confirm_to_enable || {}); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل إعدادات المنصة'));
    api.get('/admin/embedded-signup/config')
      .then((res) => setMeta(res.data))
      .catch(() => setMeta({}));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const sectionProps = { settings, onSaved };

  return (
    <div className="max-w-[800px] flex flex-col gap-5">
      <PageHeader title="إعدادات المنصة" sub="قواعد تنطبق على كل الزبائن، لا تخصّ أي محل. كل حفظ يُسجَّل باسمك مع القيمة قبل وبعد." />

      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}
      {!settings && !error && <div className="text-center py-16 text-shift-muted">جاري التحميل...</div>}

      {settings && (
        <>
          <Section id="s-offer" title="العرض والاشتراك" sub="ما يُعرض على كل زبون جديد، ومتى يتوقف الرد الآلي لمن تأخر في الدفع."
            keys={['campaign', 'late_policy']} saveLabel="حفظ العرض" {...sectionProps}
            note="مدة المجانية وبدايتها للعقود الجديدة فقط؛ العقود القائمة تبقى كما اتُّفق عليها. أيام السماح تنطبق على الجميع من الفحص اليومي التالي.">
            {(d, set) => {
              const v = d.campaign;
              const c = set('campaign');
              return (
                <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                  <SField id="st-camp" label="اسم العرض"><input id="st-camp" value={v?.name || ''} onChange={(e) => c({ ...v, name: e.target.value })} className={fieldClass} /></SField>
                  <SField id="st-days" label="مدة المجانية (يومًا)"><NumberInput id="st-days" value={v?.trial_days} onChange={(n) => c({ ...v, trial_days: n })} min={1} /></SField>
                  <SField id="st-start" label="تبدأ المجانية">
                    <select id="st-start" value={v?.trial_starts || 'first_reply'} onChange={(e) => c({ ...v, trial_starts: e.target.value })} className={fieldClass}>
                      <option value="first_reply">عند أول رد حقيقي للبوت على زبون</option>
                      <option value="connect">عند ربط واتساب</option>
                    </select>
                  </SField>
                  <SField id="st-backstop" label="أو بعد الربط بـ (يومًا) أيهما أسبق" hint="حتى لا تبقى فترة محل لا يراسله أحد مفتوحة للأبد.">
                    <NumberInput id="st-backstop" value={v?.backstop_days} onChange={(n) => c({ ...v, backstop_days: n })} min={1} />
                  </SField>
                  <SField id="st-grace" label="أيام السماح بعد الاستحقاق" hint="بعدها يُوقَف بوت المحل مؤقتًا وتبقى رسائله تصل لصندوقه، ويعود عند تسجيل الدفعة.">
                    <NumberInput id="st-grace" value={d.late_policy?.grace_days} onChange={(n) => set('late_policy')({ ...d.late_policy, grace_days: n })} />
                  </SField>
                </div>
              );
            }}
          </Section>

          <Section id="s-limits" title="التشغيل والحدود" sub="ما يحمي فاتورة الذكاء الاصطناعي."
            keys={['ai_limits']} saveLabel="حفظ الحدود" {...sectionProps}
            top={<ProviderLine status={settings.provider_status} />}
            note="عند بلوغ السقف: تتوقف ردود المحلات في المجانية أولًا، وتصل رسائلها لفرقها.">
            {(d, set) => {
              const v = d.ai_limits;
              const s = set('ai_limits');
              return (
                <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                  <SField id="st-cap" label="ردود شهرية لكل محل" hint="الافتراضي للعقود الجديدة؛ العقود القائمة تحتفظ بحدها.">
                    <NumberInput id="st-cap" value={v?.reply_month_default} onChange={(n) => s({ ...v, reply_month_default: n })} />
                  </SField>
                  <SField id="st-ceil" label="سقف الردود اليومي لكل المحلات"><NumberInput id="st-ceil" value={v?.platform_day_ceiling} onChange={(n) => s({ ...v, platform_day_ceiling: n })} /></SField>
                  <SField id="st-media" label="قراءة وسائط يوميًا لكل محل"><NumberInput id="st-media" value={v?.media_day_default} onChange={(n) => s({ ...v, media_day_default: n })} /></SField>
                  <SField id="st-policy" label="عند بلوغ السقف">
                    <select id="st-policy" value={v?.ceiling_policy || 'trials_first'} onChange={(e) => s({ ...v, ceiling_policy: e.target.value })} className={fieldClass}>
                      <option value="trials_first">أوقف التجارب أولًا</option>
                      {v?.ceiling_policy === 'all' && <option value="all">أوقف الجميع</option>}
                    </select>
                  </SField>
                </div>
              );
            }}
          </Section>

          <Section id="s-wa" title="واتساب والربط الذاتي" sub="حين يُفتح، يرى صاحب المحل زر «اربط واتساب» في رابط الدعوة ويربط بنفسه."
            keys={['invite_ttl_days']} saveLabel="حفظ الرابط" {...sectionProps}
            note="مدة الرابط للروابط الجديدة؛ الروابط المرسلة تبقى على مدتها."
            top={(
              <>
                <div className="flex flex-col gap-2 text-sm">
                  <span className="text-[13px] text-shift-body">قبل فتح الربط الذاتي:</span>
                  <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
                    <li className="flex items-center gap-2.5"><span aria-hidden="true" className="w-[18px] h-[18px] rounded-full border-2 border-shift-gold" /><b className="font-semibold">تجربة الربط على شريحة احتياطية (G1)</b></li>
                    <li className="flex items-center gap-2.5"><span aria-hidden="true" className="w-[18px] h-[18px] rounded-full border-2 border-shift-field" />التحقق من حد Meta للزبائن الجدد أسبوعيًا</li>
                  </ul>
                </div>
                <SelfConnect on={settings.es_owner_enabled === true} onSaved={onSaved} />
                <SelfSignup {...sectionProps} confirmSentence={confirmTexts.self_signup} />
                <Coexistence value={settings.coexistence} confirmText={confirmTexts.coexistence} onSaved={onSaved} />
                <details className="text-[13.5px] text-shift-body">
                  <summary className="cursor-pointer min-h-[40px] flex items-center">تفاصيل تقنية (Meta، للقراءة فقط)</summary>
                  <dl className="m-0 mt-2 flex flex-col gap-1.5">
                    {[
                      ['تطبيق Meta', meta?.app_id],
                      ['إعداد تسجيل الدخول', meta?.config_id],
                      ['إصدار واجهة Graph', meta?.graph_version],
                    ].map(([label, value]) => (
                      <div key={label} className="flex items-center justify-between gap-3">
                        <dt>{label}</dt>
                        <dd className="m-0 text-shift-ink"><Ltr className="font-mono text-xs">{value || '—'}</Ltr></dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </>
            )}>
            {(d, set) => (
              <div className="pt-4 border-t border-shift-line2">
                <SField id="st-ttl" label="مدة صلاحية رابط الانضمام (أيام)">
                  <NumberInput id="st-ttl" value={d.invite_ttl_days} onChange={set('invite_ttl_days')} min={1} />
                </SField>
              </div>
            )}
          </Section>

          <Section id="s-pay" title="بيانات التحصيل والتنبيهات" sub="يظهر قسم «كيف أدفع؟» للزبائن فقط بعد تعبئة كليك أو الحساب البنكي."
            keys={['payment_instructions', 'shift_alert_numbers']} saveLabel="حفظ البيانات" {...sectionProps}
            note="أرقام التنبيهات تصلها: زبون فتح الرابط، ربط، تعثّر، أول رد، تعطّل الذكاء الاصطناعي، بلوغ السقف.">
            {(d, set) => {
              const v = d.payment_instructions;
              const p = set('payment_instructions');
              return (
                <div className="grid gap-3.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
                  <SField id="st-cliq" label="اسم كليك (CliQ)"><input id="st-cliq" value={v?.cliq_alias || ''} onChange={(e) => p({ ...v, cliq_alias: e.target.value })} dir="ltr" className={`${fieldClass} text-right`} /></SField>
                  <SField id="st-iban" label="IBAN"><input id="st-iban" value={v?.iban || ''} onChange={(e) => p({ ...v, iban: e.target.value.toUpperCase() })} dir="ltr" placeholder="JO.. .... ...." className={`${fieldClass} text-right font-mono`} /></SField>
                  <SField id="st-holder" label="اسم صاحب الحساب"><input id="st-holder" value={v?.holder || ''} onChange={(e) => p({ ...v, holder: e.target.value })} className={fieldClass} /></SField>
                  <div className="col-span-full">
                    <SField id="st-alert" label="أرقام تنبيهات شِفت">
                      <NumbersList id="st-alert" value={d.shift_alert_numbers} onChange={set('shift_alert_numbers')} />
                    </SField>
                  </div>
                </div>
              );
            }}
          </Section>
        </>
      )}

      <Footnote>الأسرار (رمز التطبيق، رمز التحقق) تُقرأ من Secret Manager وقت التشغيل ولا تظهر هنا أبدًا.</Footnote>
    </div>
  );
}
