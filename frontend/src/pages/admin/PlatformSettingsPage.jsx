import { useCallback, useEffect, useState } from 'react';
import { Save, Plus, X, AlertTriangle } from 'lucide-react';
import { Panel, Ltr } from '../../components/shared/Primitives';
import api from '../../utils/api';

/**
 * «إعدادات المنصة» — SHIFT's own switches and defaults, not any shop's.
 *
 * Every block is a PlatformSetting row (services/platformSettings.js holds the defaults, so an
 * untouched block shows what the platform is actually running on). Each block saves on its own,
 * after a confirmation, and the server writes platform_setting_changed with the before and after.
 *
 * Two things are deliberately not switches here: public self-signup (greyed until after the
 * first ten shops) and the Meta ids, which come from the deployment and are shown read-only.
 * Coexistence (P5) is a switch, off for October (fresh SIMs only), and switching it on takes a
 * typed sentence the server checks. Secrets never appear on this page.
 */

const input = 'w-full h-9 border border-gray-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-gray-400';

function Field({ label, hint, children }) {
  return (
    <label className="block">
      <span className="block text-[12px] text-gray-600 mb-1">{label}</span>
      {children}
      {hint && <span className="block mt-1 text-[11px] text-gray-400">{hint}</span>}
    </label>
  );
}

/** One PlatformSetting key: its own draft, its own save, its own confirmation. */
function Block({ title, settingKey, settings, onSaved, confirmText, children, note }) {
  const [draft, setDraft] = useState(settings?.[settingKey]);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  // Reset to the stored value when that value changes, not when another block saves: an unsaved
  // edit in one block must survive a save in the next.
  const stored = JSON.stringify(settings?.[settingKey] ?? null);
  useEffect(() => { setDraft(JSON.parse(stored)); }, [stored]);

  const dirty = JSON.stringify(draft ?? null) !== stored;

  const save = async () => {
    if (!window.confirm(confirmText || `حفظ «${title}»؟ يُطبَّق على كل المحلات خلال دقيقة.`)) return;
    setBusy(true); setMsg(null);
    try {
      const res = await api.patch('/admin/platform-settings', { key: settingKey, value: draft });
      onSaved(settingKey, res.data?.value !== undefined ? res.data.value : draft);
      setMsg({ tone: 'ok', text: 'تم الحفظ' });
    } catch (err) {
      setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' });
    } finally { setBusy(false); }
  };

  return (
    <Panel title={title}>
      <div className="p-4 space-y-3">
        {children(draft, setDraft)}
        {note}
      </div>
      <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100">
        <button type="button" onClick={save} disabled={busy || !dirty}
          className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gray-900 text-white text-[12px] disabled:opacity-40">
          <Save size={12} /> {busy ? 'جارٍ…' : 'احفظ'}
        </button>
        {msg && <span className={`text-[12px] ${msg.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

const num = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v));

function NumberInput({ value, onChange, min = 0 }) {
  return (
    <input type="number" min={min} dir="ltr" value={value ?? ''} onChange={(e) => onChange(num(e.target.value))}
      className={`${input} tabular-nums`} />
  );
}

function Toggle({ checked, onChange, disabled, label }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative shrink-0 w-12 h-7 rounded-full transition-colors disabled:opacity-40 ${checked ? 'bg-green-600' : 'bg-gray-300'}`}>
      <span className={`absolute top-1 w-5 h-5 rounded-full bg-white shadow transition-all ${checked ? 'right-6' : 'right-1'}`} />
    </button>
  );
}

function NumbersList({ value, onChange }) {
  const [draft, setDraft] = useState('');
  const list = Array.isArray(value) ? value : [];
  const add = () => {
    const n = draft.trim();
    if (n && !list.includes(n)) onChange([...list, n]);
    setDraft('');
  };
  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {list.length === 0 && <span className="text-[12px] text-gray-400">لا أرقام بعد — تنبيهات شِفت لا تصل لأحد.</span>}
        {list.map((n) => (
          <span key={n} className="inline-flex items-center gap-1 h-7 pr-2.5 pl-1 rounded-full bg-gray-100 text-[12px]">
            <span dir="ltr" className="tabular-nums">{n}</span>
            <button type="button" onClick={() => onChange(list.filter((x) => x !== n))} className="p-0.5 text-gray-400 hover:text-red-600" title="حذف"><X size={11} /></button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-2">
        <input value={draft} onChange={(e) => setDraft(e.target.value)} dir="ltr" placeholder="0791234567"
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } }} className={input} />
        <button type="button" onClick={add} disabled={!draft.trim()}
          className="shrink-0 inline-flex items-center gap-1 h-9 px-3 rounded-md border border-gray-200 text-[12px] text-gray-700 disabled:opacity-40">
          <Plus size={12} /> أضف
        </button>
      </div>
    </div>
  );
}

/**
 * «التطبيق والمنصة معًا» (coexistence, P5). Not a Block: switching it on needs the sentence the
 * server sends (coexistence_confirm) typed back, because it changes what every shop's connect
 * screen offers and holds SHIFT to Meta's 24-hour sync for each such number. Off needs only a
 * confirm.
 */
function CoexistenceBlock({ value, confirmText, onSaved }) {
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
    <Panel title="رقم واتساب موصول بتطبيق الهاتف (Coexistence)">
      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-[13px] text-gray-800">خيار «رقم المحل الحالي وعليه واتساب» في شاشة الربط</p>
            <p className="text-[11px] text-gray-500">{on ? 'مفعّل' : 'مغلق — كل محل يربط شريحة جديدة'}</p>
          </div>
          <Toggle checked={on} onChange={flip} disabled={busy} label="الربط مع تطبيق واتساب للأعمال" />
        </div>
        <p className="flex items-start gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          جرّبه أولًا على رقم محل واحد صديق في إربد (دعم الأرقام الأردنية لم يُتحقق منه بعد). بعد كل ربط تطلب شِفت من Meta مزامنة جهات الاتصال والمحادثات خلال 24 ساعة، ويصلك تنبيه إن لم تكتمل بعد 20 ساعة.
        </p>
        {msg && <span className={`text-[12px] ${msg.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{msg.text}</span>}
      </div>
    </Panel>
  );
}

export default function PlatformSettingsPage() {
  const [settings, setSettings] = useState(null);
  const [meta, setMeta] = useState(null);
  const [coexConfirm, setCoexConfirm] = useState('');
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/platform-settings')
      .then((res) => { setSettings(res.data?.settings || {}); setCoexConfirm(res.data?.coexistence_confirm || ''); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل إعدادات المنصة'));
    api.get('/admin/embedded-signup/config')
      .then((res) => setMeta(res.data))
      .catch(() => setMeta({}));
  }, []);

  useEffect(() => { load(); }, [load]);

  const onSaved = (key, value) => setSettings((s) => ({ ...s, [key]: value }));
  const blockProps = { settings, onSaved };

  return (
    <div className="space-y-4 max-w-[900px]">
      <div>
        <h1 className="text-lg font-bold text-gray-900">إعدادات المنصة</h1>
        <p className="text-xs text-gray-500 mt-0.5">إعدادات شِفت نفسها — لا تخصّ أي محل. كل حفظ مسجّل بقيمته قبل وبعد.</p>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {!settings && !error && <div className="text-center py-16 text-gray-400">جاري التحميل...</div>}

      {settings && (
        <>
          <Block title="العرض الحالي" settingKey="campaign" {...blockProps}>
            {(v, set) => (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="اسم الحملة"><input value={v?.name || ''} onChange={(e) => set({ ...v, name: e.target.value })} className={input} /></Field>
                <Field label="مدة الفترة المجانية (يومًا)"><NumberInput value={v?.trial_days} onChange={(n) => set({ ...v, trial_days: n })} min={1} /></Field>
                <Field label="تبدأ الفترة المجانية من">
                  <select value={v?.trial_starts || 'first_reply'} onChange={(e) => set({ ...v, trial_starts: e.target.value })} className={input}>
                    <option value="first_reply">أول رد للبوت على زبون</option>
                    <option value="connect">ربط واتساب</option>
                  </select>
                </Field>
                <Field label="أو بعد الربط بـ (يومًا) أيهما أسبق" hint="حتى لا تبقى فترة محل لا يراسله أحد مفتوحة للأبد.">
                  <NumberInput value={v?.backstop_days} onChange={(n) => set({ ...v, backstop_days: n })} min={1} />
                </Field>
              </div>
            )}
          </Block>

          <Block title="حدود الذكاء الاصطناعي" settingKey="ai_limits" {...blockProps}>
            {(v, set) => (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="ردود شهرية لكل محل" hint="الافتراضي للعقود الجديدة؛ العقود القائمة تحتفظ بحدها.">
                  <NumberInput value={v?.reply_month_default} onChange={(n) => set({ ...v, reply_month_default: n })} />
                </Field>
                <Field label="قراءة وسائط يوميًا لكل محل"><NumberInput value={v?.media_day_default} onChange={(n) => set({ ...v, media_day_default: n })} /></Field>
                <Field label="سقف الردود اليومي للمنصة"><NumberInput value={v?.platform_day_ceiling} onChange={(n) => set({ ...v, platform_day_ceiling: n })} /></Field>
                <Field label="عند بلوغ السقف">
                  <select value={v?.ceiling_policy || 'trials_first'} onChange={(e) => set({ ...v, ceiling_policy: e.target.value })} className={input}>
                    <option value="trials_first">أوقف التجارب أولًا</option>
                  </select>
                </Field>
              </div>
            )}
          </Block>

          <Block title="الربط الذاتي" settingKey="es_owner_enabled" {...blockProps}
            confirmText={settings.es_owner_enabled
              ? 'إغلاق الربط الذاتي؟ لن يرى أصحاب المحلات زر «اربط واتساب»، وتربط شِفت معهم.'
              : 'فتح الربط الذاتي لأصحاب المحلات؟ لا تفتحه قبل نجاح أول ربط حقيقي (G1) على شريحة احتياطية. بعد الفتح يربط كل صاحب محل واتساب بنفسه من لوحته.'}
            note={!settings.es_owner_enabled && (
              <p className="flex items-start gap-1.5 text-[12px] text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                يبقى مغلقًا حتى ينجح أول ربط حقيقي مع Meta (G1). إلى ذلك الحين تربط شِفت مع صاحب المحل من صفحة المحل.
              </p>
            )}>
            {(v, set) => (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-gray-800">السماح للزبائن بربط واتساب بأنفسهم</span>
                <Toggle checked={Boolean(v)} onChange={set} label="الربط الذاتي" />
              </div>
            )}
          </Block>

          <Block title="رابط الانضمام" settingKey="invite_ttl_days" {...blockProps}>
            {(v, set) => (
              <Field label="مدة صلاحية رابط الانضمام (أيام)" hint="للروابط الجديدة؛ الروابط المرسلة تبقى على مدتها.">
                <NumberInput value={v} onChange={set} min={1} />
              </Field>
            )}
          </Block>

          <Block title="طرق الدفع التي يراها الزبون" settingKey="payment_instructions" {...blockProps}
            note={<p className="text-[11px] text-gray-400">بطاقة «كيف أدفع؟» تبقى مخفية عن الزبائن ما دامت هذه الحقول فارغة.</p>}>
            {(v, set) => (
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="اسم CliQ"><input value={v?.cliq_alias || ''} onChange={(e) => set({ ...v, cliq_alias: e.target.value })} dir="ltr" className={input} /></Field>
                <Field label="اسم صاحب الحساب"><input value={v?.holder || ''} onChange={(e) => set({ ...v, holder: e.target.value })} className={input} /></Field>
                <div className="sm:col-span-2">
                  <Field label="IBAN"><input value={v?.iban || ''} onChange={(e) => set({ ...v, iban: e.target.value.toUpperCase() })} dir="ltr" className={`${input} font-mono`} /></Field>
                </div>
              </div>
            )}
          </Block>

          <Block title="سياسة التأخر" settingKey="late_policy" {...blockProps}>
            {(v, set) => (
              <Field label="أيام السماح بعد موعد الدفع" hint="بعدها يُوقَف بوت المحل مؤقتًا وتبقى رسائله تصل لصندوقه، ويعود عند تسجيل الدفعة.">
                <NumberInput value={v?.grace_days} onChange={(n) => set({ ...v, grace_days: n })} />
              </Field>
            )}
          </Block>

          <Block title="أرقام شِفت للتنبيهات" settingKey="shift_alert_numbers" {...blockProps}
            note={<p className="text-[11px] text-gray-400">تصلها تنبيهات المنصة: زبون فتح الرابط، ربط، تعثّر، أول رد، تعطّل الذكاء الاصطناعي، بلوغ السقف.</p>}>
            {(v, set) => <NumbersList value={v} onChange={set} />}
          </Block>

          <Panel title="التسجيل الذاتي العام">
            <div className="p-4 flex items-center justify-between gap-3 opacity-60">
              <div>
                <p className="text-[13px] text-gray-800">صفحة تسجيل عامة بدون دعوة</p>
                <p className="text-[11px] text-gray-500">بعد أول 10 زبائن</p>
              </div>
              <Toggle checked={Boolean(settings.self_signup?.enabled)} onChange={() => {}} disabled label="التسجيل الذاتي العام" />
            </div>
          </Panel>

          <CoexistenceBlock value={settings.coexistence} confirmText={coexConfirm} onSaved={onSaved} />
        </>
      )}

      <Panel title="Meta (للقراءة فقط)">
        <dl className="divide-y divide-gray-50">
          {[
            ['تطبيق Meta', meta?.app_id],
            ['إعداد تسجيل الدخول', meta?.config_id],
            ['إصدار واجهة Graph', meta?.graph_version],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between px-4 h-10">
              <dt className="text-[13px] text-gray-600">{label}</dt>
              <dd className="text-[13px] text-gray-900"><Ltr className="font-mono text-xs">{value || '—'}</Ltr></dd>
            </div>
          ))}
        </dl>
      </Panel>

      <p className="text-[11px] text-gray-400 px-1">
        الأسرار (رمز التطبيق، رمز التحقق) تُقرأ من Secret Manager وقت التشغيل ولا تظهر هنا أبدًا.
      </p>
    </div>
  );
}
