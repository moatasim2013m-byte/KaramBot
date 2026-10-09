import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  AlertCircle, Check, Copy, Eye, EyeOff, ExternalLink, Loader2, MessageCircle,
} from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { isInAppBrowser } from '../utils/facebookSdk';
import ConnectWhatsApp, { OWNER_ENDPOINTS, COEX_NOTICE } from '../components/whatsapp/ConnectWhatsApp';
import TryTheBot from '../components/whatsapp/TryTheBot';

/**
 * «انضمام» — /join#<token>, the one page a new shop owner sees between SHIFT's WhatsApp message
 * and their own panel (docs/panels/spec.md, «Signup flow», steps 3–10).
 *
 * Phone-first and one decision per screen, because it is opened from a WhatsApp chat on the
 * owner's phone, usually standing in the shop. Public: the owner has no session until the
 * password step redeems the link, after which every call runs on their own session and the
 * backend takes the business from it, never from this page.
 *
 * The token rides in the fragment, which browsers never send, and is wiped from the address bar
 * the moment it is redeemed. Staff and manager invites keep /activate: this wizard is the owner's.
 *
 * What survives a reload: the step, in sessionStorage, and only while signed in. A reload with no
 * session and a used link lands on «الرابط منتهٍ أو مستخدم» with a way to sign in, and a signed-in
 * owner who reopens the link is offered their panel or the rest of the steps.
 *
 * /join with no link and no session is the public «جرّب مجانًا» (P5, routes/publicSignup.js): a
 * short form when SHIFT has opened self-signup (GET /public/signup/config), otherwise «التسجيل عبر
 * دعوة من شِفت فقط» with a way to message SHIFT. A signup is signed straight in, proves its mobile
 * («أكّد رقمك»: the code sent from that mobile's WhatsApp to SHIFT; until then the mobile is not
 * the login, so a stranger cannot take someone else's), then continues at the connect step,
 * exactly like an invited owner after their password.
 */

const SHIFT_WA = '962776788972';
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const STORE_KEY = 'karam_join';

// Which of «١ حسابك · ٢ واتساب · ٣ البوت» each screen belongs to.
const STEP_GROUP = { signup: 0, verify: 0, password: 0, connect: 1, confirm: 1, wrong_number: 1, payment: 1, teach: 2, try: 2 };
const GROUPS = ['١ حسابك', '٢ واتساب', '٣ البوت'];

// What «عالق؟» tells SHIFT, so the operator knows where they stopped without asking.
const STEP_LABEL = {
  loading: 'فتح الرابط',
  in_app: 'فتح الرابط في المتصفح',
  invalid: 'الرابط منتهٍ أو مستخدم',
  invite_only: 'التسجيل عبر دعوة',
  signup: 'التسجيل',
  verify: 'تأكيد رقم الموبايل',
  resume: 'العودة للانضمام',
  password: 'اختيار كلمة المرور',
  connect: 'ربط واتساب',
  confirm: 'تأكيد رقم المحل',
  wrong_number: 'الرقم ليس رقم المحل',
  payment: 'بطاقة الدفع لدى Meta',
  teach: 'تعليم البوت',
  try: 'تجربة البوت',
};

function waLink(text) {
  return `https://wa.me/${SHIFT_WA}?text=${encodeURIComponent(text)}`;
}

function stuckText(info, step) {
  const who = info?.owner_first_name ? `أنا ${info.owner_first_name}` : 'مرحبًا';
  const shop = info?.shop_name ? ` من ${info.shop_name}` : '';
  return `${who}${shop}، توقفت عند: ${STEP_LABEL[step] || 'الانضمام'}`;
}

// The sector's business_type, for a lookup that sends only the sector (the server maps it the
// same way: restaurant and clinic have their own workflows, everything else is generic).
function businessTypeOf(info, user) {
  if (user?.business_type) return user.business_type;
  if (info?.business_type) return info.business_type;
  if (info?.sector === 'restaurant' || info?.sector === 'clinic') return info.sector;
  return 'generic';
}

/** The lookup as the wizard reads it, whichever field names the server answers with. */
function normalizeInvite(d) {
  const name = d?.name || '';
  return {
    shop_name: d?.shop_name || d?.business_name || '',
    owner_first_name: d?.owner_first_name || name.trim().split(/\s+/)[0] || '',
    sector: d?.sector || null,
    business_type: d?.business_type || null,
    phone_masked: d?.phone_masked || null,
    email: d?.email || null,
    role: d?.role || null,
    connected: Boolean(d?.connected),
  };
}

function readStore() {
  try { return JSON.parse(sessionStorage.getItem(STORE_KEY)) || null; } catch { return null; }
}
function writeStore(value) {
  try {
    if (value) sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(STORE_KEY);
  } catch { /* private mode or blocked storage: the wizard still works, a reload restarts it */ }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

// Android only: reopen this page in Chrome. The fragment cannot ride in the intent's data part,
// so the full URL goes in the fallback too.
function chromeIntentUrl() {
  const { host, pathname, search, href } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

const btnPrimary = 'w-full inline-flex items-center justify-center gap-2 rounded-xl bg-green-600 px-4 h-12 text-[15px] font-semibold text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = 'w-full inline-flex items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-4 h-12 text-[14px] text-gray-800 hover:bg-gray-50 disabled:opacity-50';
const btnChoice = (on) => `w-full text-right rounded-xl border px-4 min-h-12 py-3 text-[14px] ${on ? 'border-green-600 bg-green-50 text-green-900' : 'border-gray-200 bg-white text-gray-800 hover:bg-gray-50'}`;
const inputClass = 'w-full h-12 px-3 text-[15px] border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-green-500';

function Progress({ step }) {
  const at = STEP_GROUP[step];
  if (at === undefined) return null;
  return (
    <ol className="flex items-center gap-1.5 text-[12px]" aria-label="خطوات الانضمام">
      {GROUPS.map((g, i) => (
        <li key={g} className="flex-1">
          <div className={`h-1.5 rounded-full ${i <= at ? 'bg-green-600' : 'bg-gray-200'}`} />
          <p className={`mt-1 text-center ${i === at ? 'font-semibold text-gray-900' : 'text-gray-400'}`}>{g}</p>
        </li>
      ))}
    </ol>
  );
}

function Shell({ step, info, children }) {
  return (
    <div className="min-h-screen bg-gray-50" dir="rtl">
      <div className="mx-auto w-full max-w-md px-4 pb-10 pt-5">
        <p className="text-center text-[13px] font-semibold text-gray-700">كرم بوت — من شِفت، إربد</p>
        <div className="mt-4"><Progress step={step} /></div>
        <main className="mt-5">{children}</main>
        <footer className="mt-8 text-center">
          <a href={waLink(stuckText(info, step))} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-[13px] text-gray-600 underline underline-offset-2">
            <MessageCircle size={14} /> عالق؟ راسل شِفت على واتساب
          </a>
        </footer>
      </div>
    </div>
  );
}

function Card({ children }) {
  return <section className="rounded-2xl border border-gray-200 bg-white p-5">{children}</section>;
}

/* ── Failure screens ──────────────────────────────────────────────────────── */

function InAppScreen({ info }) {
  const [copied, setCopied] = useState(false);
  return (
    <Card>
      {info?.shop_name && <p className="text-[13px] text-gray-500">{info.shop_name}</p>}
      <h1 className="mt-1 text-lg font-bold text-gray-900">افتح الرابط في Chrome أو Safari لتتمكن من ربط واتساب</h1>
      <p className="mt-2 text-[13px] text-gray-600">متصفح واتساب أو فيسبوك أو إنستغرام لا يفتح نافذة الربط من Meta. انسخ الرابط والصقه في المتصفح.</p>
      <div className="mt-4 space-y-2">
        {/android/i.test(navigator.userAgent) && (
          <a href={chromeIntentUrl()} className={btnPrimary}>افتح في المتصفح</a>
        )}
        <button type="button" className={btnSecondary}
          onClick={async () => { if (await copyText(window.location.href)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
          <Copy size={15} /> {copied ? 'نُسخ الرابط' : 'نسخ الرابط'}
        </button>
      </div>
    </Card>
  );
}

function InvalidScreen() {
  return (
    <Card>
      <AlertCircle size={24} className="text-red-500" />
      <h1 className="mt-2 text-lg font-bold text-gray-900">الرابط منتهٍ أو مستخدم</h1>
      <p className="mt-1 text-[13px] text-gray-600">رابط الانضمام صالح 7 أيام ويُستخدم مرة واحدة.</p>
      <div className="mt-4 space-y-2">
        <a href={waLink('مرحبًا، رابط الانضمام إلى كرم بوت عندي منتهٍ. أرجو رابطًا جديدًا.')}
          target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          اطلب رابطًا جديدًا على واتساب
        </a>
        <p className="pt-2 text-center text-[13px] text-gray-600">اخترت كلمة مرور من قبل؟ حسابك مفعّل.</p>
        <Link to="/login" className={btnSecondary}>تسجيل الدخول</Link>
      </div>
    </Card>
  );
}

function InviteOnlyScreen() {
  return (
    <Card>
      <h1 className="text-lg font-bold text-gray-900">التسجيل عبر دعوة من شِفت فقط</h1>
      <p className="mt-1 text-[13px] text-gray-600">نرسل لكل محل رابط انضمام خاصًا به على واتساب. راسلنا ونرسل لك رابطك.</p>
      <div className="mt-4 space-y-2">
        <a href={waLink('مرحبًا، بدي أجرّب كرم بوت لمحلي.')} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
          <MessageCircle size={16} /> راسل شِفت على واتساب
        </a>
        <p className="pt-2 text-center text-[13px] text-gray-600">عندك حساب؟</p>
        <Link to="/login" className={btnSecondary}>تسجيل الدخول</Link>
      </div>
    </Card>
  );
}

const SIGNUP_SECTORS = [
  ['restaurant', 'مطعم'],
  ['clinic', 'عيادة'],
  ['pharmacy', 'صيدلية'],
  ['salon', 'صالون'],
  ['clothing', 'محل ملابس'],
  ['shop', 'محل آخر'],
];

/** «جرّب مجانًا»: the shop, the owner's mobile and their own password, in one screen. */
function SignupStep({ onDone }) {
  const [form, setForm] = useState({ shop_name: '', sector: '', owner_name: '', owner_phone: '', password: '', website: '' });
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.shop_name.trim()) { setError('اكتب اسم المحل'); return; }
    if (!form.sector) { setError('اختر نوع النشاط'); return; }
    if (!form.owner_name.trim()) { setError('اكتب اسمك'); return; }
    if (form.password.length < 10) { setError('كلمة المرور يجب أن تكون 10 أحرف على الأقل'); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.post('/public/signup', form);
      onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إنشاء الحساب، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">جرّب مجانًا</h1>
      <p className="mt-1 text-[14px] text-gray-700">كرم بوت يرد على زبائن محلك على واتساب. الشهر الأول مجاني، وبعد التسجيل تربط رقم واتساب المحل.</p>
      <form onSubmit={submit} className="mt-4 space-y-3" noValidate>
        <label className="block">
          <span className="text-[14px] text-gray-800">اسم المحل</span>
          <input value={form.shop_name} onChange={set('shop_name')} required maxLength={120} className={`${inputClass} mt-1.5`} />
        </label>
        <fieldset>
          <legend className="text-[14px] text-gray-800">نوع النشاط</legend>
          <div className="mt-1.5 grid grid-cols-2 gap-2">
            {SIGNUP_SECTORS.map(([value, label]) => (
              <button key={value} type="button" onClick={() => setForm((f) => ({ ...f, sector: value }))}
                aria-pressed={form.sector === value} className={btnChoice(form.sector === value)}>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="block">
          <span className="text-[14px] text-gray-800">اسمك</span>
          <input value={form.owner_name} onChange={set('owner_name')} required maxLength={120} autoComplete="name" className={`${inputClass} mt-1.5`} />
        </label>
        <label className="block">
          <span className="text-[14px] text-gray-800">رقم موبايلك (للدخول)</span>
          <input value={form.owner_phone} onChange={set('owner_phone')} required inputMode="tel" autoComplete="tel"
            placeholder="07XXXXXXXX" dir="ltr" className={`${inputClass} mt-1.5 text-right`} />
        </label>
        <label className="block">
          <span className="text-[14px] text-gray-800">اختر كلمة مرور (10 أحرف على الأقل)</span>
          <div className="relative mt-1.5">
            <input type={show ? 'text' : 'password'} value={form.password} onChange={set('password')}
              autoComplete="new-password" required minLength={10} dir="ltr" className={`${inputClass} pl-12`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              className="absolute left-0 top-0 flex h-12 w-12 items-center justify-center text-gray-400">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        {/* Honeypot: hidden from people and screen readers; a bot that fills it is refused. */}
        <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: 1, height: 1, overflow: 'hidden' }}>
          <label>الموقع<input name="website" tabIndex={-1} autoComplete="off" value={form.website} onChange={set('website')} /></label>
        </div>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> جارٍ إنشاء الحساب…</> : 'أنشئ حسابي'}
        </button>
        <p className="text-center text-[13px] text-gray-600">عندك حساب؟ <Link to="/login" className="underline underline-offset-2">تسجيل الدخول</Link></p>
      </form>
    </Card>
  );
}

// The sentence the wa.me link fills in; the server reads the six digits from it (publicSignup.js
// codeText builds the same one).
const codeText = (code) => `رمز تأكيد كرم بوت: ${code}`;
const VERIFY_POLL_MS = 4000;

/**
 * «أكّد رقمك»: the mobile typed at signup becomes the login (and the shop's alert number) only
 * once a message with the code comes from it to SHIFT's WhatsApp. The page asks every few seconds.
 */
function VerifyStep({ code: initialCode, onVerified }) {
  const [code, setCode] = useState(initialCode || null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  // A reload loses the code (only its hash is kept): ask for a fresh one.
  useEffect(() => {
    if (code) return undefined;
    let alive = true;
    api.post('/public/signup/verify/code')
      .then((res) => {
        if (!alive) return;
        if (res.data?.verified) onVerified();
        else setCode(res.data?.code || null);
      })
      .catch((err) => { if (alive) setError(err.response?.data?.error || 'تعذّر تجهيز رمز التأكيد، حاول مرة أخرى'); });
    return () => { alive = false; };
  }, [code, onVerified]);

  useEffect(() => {
    if (!code) return undefined;
    let alive = true;
    const check = () => api.post('/public/signup/verify')
      .then((res) => { if (alive && res.data?.verified) onVerified(); })
      .catch((err) => {
        if (!alive) return;
        // 409: the mobile is proven but already on another account; anything else is retried.
        if (err.response?.status === 409 || err.response?.status === 403) setError(err.response.data?.error || null);
      });
    const timer = setInterval(check, VERIFY_POLL_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [code, onVerified]);

  const newCode = async () => {
    setBusy(true); setError(null);
    try {
      const res = await api.post('/public/signup/verify/code');
      if (res.data?.verified) onVerified();
      else setCode(res.data?.code || null);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تجهيز رمز التأكيد، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">أكّد رقم موبايلك</h1>
      <p className="mt-1 text-[14px] text-gray-700">
        من واتساب على الموبايل الذي كتبته، أرسل الرمز إلى شِفت. بعدها يصير رقمك هو رقم الدخول، وتصلك عليه تنبيهات المحل.
      </p>
      {code ? (
        <>
          <p className="mt-4 rounded-xl bg-gray-50 py-3 text-center text-2xl font-bold tracking-[0.3em] text-gray-900 tabular-nums" dir="ltr">{code}</p>
          <div className="mt-4 space-y-2">
            <a href={waLink(codeText(code))} target="_blank" rel="noopener noreferrer" className={btnPrimary}>
              <MessageCircle size={16} /> أرسل الرمز على واتساب
            </a>
            <p className="flex items-center justify-center gap-2 text-[13px] text-gray-500">
              <Loader2 size={14} className="animate-spin" /> ننتظر وصول الرمز…
            </p>
            <button type="button" onClick={newCode} disabled={busy} className={btnSecondary}>أرسل لي رمزًا جديدًا</button>
          </div>
        </>
      ) : (
        !error && <p className="mt-4 flex items-center gap-2 text-[14px] text-gray-600"><Loader2 size={16} className="animate-spin" /> لحظة…</p>
      )}
      {error && <p className="mt-3 text-[13px] text-red-600">{error}</p>}
      {error && (
        <p className="mt-2 text-center text-[13px] text-gray-600">عندك حساب؟ <Link to="/login" className="underline underline-offset-2">تسجيل الدخول</Link></p>
      )}
    </Card>
  );
}

function ResumeScreen({ info, onContinue }) {
  return (
    <Card>
      <Check size={24} className="text-green-600" />
      <h1 className="mt-2 text-lg font-bold text-gray-900">حسابك مفعّل{info?.owner_first_name ? ` يا ${info.owner_first_name}` : ''}</h1>
      <p className="mt-1 text-[13px] text-gray-600">تابع من لوحتك، أو أكمل خطوات الانضمام من حيث توقفت.</p>
      <div className="mt-4 space-y-2">
        <Link to="/overview" className={btnPrimary}>افتح لوحتي</Link>
        <button type="button" onClick={onContinue} className={btnSecondary}>أكمل خطوات الانضمام</button>
      </div>
    </Card>
  );
}

/* ── ١ حسابك ──────────────────────────────────────────────────────────────── */

function PasswordStep({ info, token, onDone }) {
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 10) { setError('كلمة المرور يجب أن تكون 10 أحرف على الأقل'); return; }
    setBusy(true); setError(null);
    try {
      const res = await api.post('/auth/activate', { token, password });
      onDone(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تفعيل الحساب، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="text-xl font-bold text-gray-900">أهلًا {info.owner_first_name}</h1>
      {info.shop_name && <p className="mt-1 text-[14px] text-gray-700">{info.shop_name} على كرم بوت — من شِفت</p>}
      {(info.phone_masked || info.email) && (
        <p className="mt-3 rounded-xl bg-gray-50 px-3 py-2 text-[13px] text-gray-700">
          رقم الدخول: <bdi dir="ltr" className="font-medium tabular-nums">{info.phone_masked || info.email}</bdi>
        </p>
      )}
      <form onSubmit={submit} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-[14px] text-gray-800">اختر كلمة مرور (10 أحرف على الأقل)</span>
          <div className="relative mt-1.5">
            <input type={show ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password" required minLength={10} dir="ltr" className={`${inputClass} pl-12`} />
            <button type="button" onClick={() => setShow((s) => !s)} aria-label={show ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
              className="absolute left-0 top-0 flex h-12 w-12 items-center justify-center text-gray-400">
              {show ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>
        <p className="text-[12px] text-gray-500">أنت وحدك تختار كلمة مرورك</p>
        {error && <p className="text-[13px] text-red-600">{error}</p>}
        <button type="submit" disabled={busy} className={btnPrimary}>
          {busy ? <><Loader2 size={16} className="animate-spin" /> جارٍ التفعيل…</> : 'التالي'}
        </button>
      </form>
    </Card>
  );
}

/* ── ٢ واتساب ─────────────────────────────────────────────────────────────── */

function ConnectStep({ info, onConnected, onSkip, onAlreadyConnected }) {
  // null while asking; true once the owner router answers; false when SHIFT has not opened
  // self-connect yet (503 until G1 passed) — then the owner is told SHIFT will connect with them.
  const [esOpen, setEsOpen] = useState(null);
  // SHIFT has switched coexistence on (the owner /config says so): the shop's current number can be
  // linked while it stays on the WhatsApp Business app, so nobody is told to delete it.
  const [coexOn, setCoexOn] = useState(false);
  const [simAnswer, setSimAnswer] = useState(null); // 'new' | 'existing' | 'existing_ok'
  const [fbAnswer, setFbAnswer] = useState(null);   // 'yes' | 'no'

  useEffect(() => {
    let alive = true;
    api.get(OWNER_ENDPOINTS.config)
      .then((cfg) => {
        if (alive) setCoexOn(Boolean(cfg?.data?.coexistence));
        return api.get(`${OWNER_ENDPOINTS.base}/status`).catch(() => null);
      })
      .then((res) => {
        if (!alive) return;
        // Already connected (SHIFT connected it attended, or a reload after Meta's window).
        if (res?.data?.status === 'connected') { onConnected(res.data.onboarding || null); return; }
        setEsOpen(true);
      })
      .catch(() => {
        if (!alive) return;
        // Self-connect is closed, but SHIFT already connected this shop attended: nothing to do
        // here except the card step.
        if (info?.connected) onAlreadyConnected();
        else setEsOpen(false);
      });
    return () => { alive = false; };
  }, [onConnected, onAlreadyConnected, info?.connected]);

  if (esOpen === null) {
    return <Card><p className="flex items-center gap-2 text-[14px] text-gray-600"><Loader2 size={16} className="animate-spin" /> لحظة…</p></Card>;
  }

  if (esOpen === false) {
    return (
      <Card>
        <h1 className="text-lg font-bold text-gray-900">اربط واتساب المحل</h1>
        <p className="mt-2 text-[14px] text-gray-700">سيتواصل معك فريق شِفت لربط واتساب.</p>
        <p className="mt-1 text-[13px] text-gray-500">جهّز الهاتف الذي فيه شريحة رقم المحل، وحساب فيسبوك. حتى ذلك الحين علّم البوت عن محلك.</p>
        <div className="mt-4"><button type="button" onClick={onSkip} className={btnPrimary}>التالي</button></div>
      </Card>
    );
  }

  // With coexistence on, the shop's current number is ready as it is: nothing to delete.
  const coexPath = coexOn && simAnswer === 'existing';
  const simReady = simAnswer === 'new' || simAnswer === 'existing_ok' || coexPath;

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-lg font-bold text-gray-900">اربط واتساب المحل</h1>
        <p className="mt-3 text-[14px] font-medium text-gray-800">أي رقم سيرد عليه البوت؟</p>
        <div className="mt-2 space-y-2">
          <button type="button" className={btnChoice(simAnswer === 'new')} onClick={() => setSimAnswer('new')}>
            شريحة جديدة ليس عليها واتساب — الخيار الأنسب
          </button>
          <button type="button" className={btnChoice(simAnswer === 'existing' || simAnswer === 'existing_ok')} onClick={() => setSimAnswer('existing')}>
            رقم المحل الحالي وعليه واتساب
          </button>
        </div>
        {coexPath && (
          <div className="mt-3 rounded-xl bg-green-50 p-3 text-[13px] text-green-900">
            <p>تقدر تربطه وهو باقٍ على تطبيق واتساب للأعمال في هاتفك، ومعه محادثاتك القديمة، ويرد كرم بوت على الزبائن معك.</p>
            <ul className="mt-2 list-disc space-y-1 pr-4 text-[12px]">
              <li>{COEX_NOTICE.inactivity}</li>
              <li>{COEX_NOTICE.owner_hold}</li>
              <li>{COEX_NOTICE.throughput}</li>
            </ul>
            <p className="mt-2 text-[12px]">هذا لرقم عليه تطبيق واتساب للأعمال. إن كان عليه واتساب العادي فالأسهل شريحة جديدة.</p>
          </div>
        )}
        {simAnswer === 'existing' && !coexOn && (
          <div className="mt-3 rounded-xl bg-amber-50 p-3 text-[13px] text-amber-900">
            <p>يجب حذف حساب واتساب من هذا الرقم أولًا، وستضيع محادثاته القديمة. الأفضل شريحة جديدة، أو تواصل مع شِفت.</p>
            <div className="mt-3 space-y-2">
              <button type="button" className={btnSecondary} onClick={() => setSimAnswer('new')}>سأستخدم شريحة جديدة</button>
              <button type="button" className={btnSecondary} onClick={() => setSimAnswer('existing_ok')}>حذفت واتساب من الرقم، أكمل</button>
              <a href={waLink(stuckText(info, 'connect'))} target="_blank" rel="noopener noreferrer" className={btnSecondary}>تواصل مع شِفت</a>
            </div>
          </div>
        )}
      </Card>

      {simReady && (
        <Card>
          <p className="text-[14px] font-medium text-gray-800">هل لديك حساب فيسبوك تستطيع الدخول إليه الآن؟</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" className={btnChoice(fbAnswer === 'yes')} onClick={() => setFbAnswer('yes')}>نعم</button>
            <button type="button" className={btnChoice(fbAnswer === 'no')} onClick={() => setFbAnswer('no')}>لا</button>
          </div>
          {fbAnswer === 'no' && (
            <div className="mt-3 rounded-xl bg-gray-50 p-3 text-[13px] text-gray-800">
              <p>يمكنك إنشاء حساب خلال دقيقتين، أو نربط معك.</p>
              <div className="mt-3 space-y-2">
                <a href={waLink(`${stuckText(info, 'connect')} — أريد حجز 10 دقائق لربط واتساب معكم`)}
                  target="_blank" rel="noopener noreferrer" className={btnPrimary}>احجز 10 دقائق مع شِفت</a>
                <a href="https://www.facebook.com/r.php" target="_blank" rel="noopener noreferrer" className={btnSecondary}>
                  أنشئ حساب فيسبوك <ExternalLink size={14} />
                </a>
                <button type="button" className={btnSecondary} onClick={() => setFbAnswer('yes')}>صار عندي حساب، أكمل</button>
              </div>
            </div>
          )}
        </Card>
      )}

      {simReady && fbAnswer === 'yes' && (
        <div>
          {/* The green button, enabled only once Meta's SDK has loaded (ConnectWhatsApp preloads it
              on mount and calls FB.login straight from the tap). */}
          <ConnectWhatsApp
            endpoints={OWNER_ENDPOINTS}
            preferCoexistence={coexPath}
            onChange={(next) => { if (next?.status === 'connected') onConnected(next.onboarding || null); }}
          />
          <p className="mt-3 text-center text-[12px] text-gray-500">
            أسهل من الكمبيوتر؟ ادخل إلى <bdi dir="ltr">app.shifts-ai.com</bdi> برقمك وكلمة المرور
          </p>
        </div>
      )}
    </div>
  );
}

function ConfirmStep({ onb, onYes, onNo }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  // The next screen promises «سيتواصل معك فريق شِفت», so SHIFT has to hear it before it shows.
  const no = async () => {
    setBusy(true); setError(null);
    try {
      await api.post(OWNER_ENDPOINTS.wrongNumber);
      onNo();
    } catch (err) {
      setError(err.response?.data?.message || err.response?.data?.error || 'تعذّر الإرسال، حاول مرة أخرى أو راسل شِفت');
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="flex items-center gap-2 text-[13px] text-green-700"><Check size={16} /> ربطنا واتساب بكرم بوت</div>
      <h1 className="mt-3 text-lg font-bold text-gray-900">هل هذا رقم محلك؟</h1>
      {onb?.display_phone && (
        <p className="mt-2 text-2xl font-semibold text-gray-900"><bdi dir="ltr" className="tabular-nums">{onb.display_phone}</bdi></p>
      )}
      {onb?.verified_name && (
        <p className="mt-2 text-[13px] text-gray-600">
          الاسم الذي يراه زبائنك: {onb.verified_name} — تراجعه Meta، عادة خلال يوم أو يومين
        </p>
      )}
      <div className="mt-5 space-y-2">
        <button type="button" onClick={onYes} disabled={busy} className={btnPrimary}>نعم، أكمل</button>
        <button type="button" onClick={no} disabled={busy} className={btnSecondary}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} لا، ليس هذا الرقم
        </button>
      </div>
      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </Card>
  );
}

function WrongNumberStep({ info, onContinue }) {
  return (
    <Card>
      <AlertCircle size={24} className="text-amber-500" />
      <h1 className="mt-2 text-lg font-bold text-gray-900">سيتواصل معك فريق شِفت خلال ساعات الدوام</h1>
      <p className="mt-1 text-[13px] text-gray-600">لن يتغير شيء حتى يراجع فريقنا الربط معك.</p>
      <div className="mt-4 space-y-2">
        <a href={waLink(`${stuckText(info, 'wrong_number')} — الرقم المربوط ليس رقم محلي`)}
          target="_blank" rel="noopener noreferrer" className={btnPrimary}>راسل شِفت الآن</a>
        <button type="button" onClick={onContinue} className={btnSecondary}>علّم البوت عن محلك بينما تنتظر</button>
      </div>
    </Card>
  );
}

function PaymentStep({ onNext }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const claim = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/whatsapp/status/payment-method-claim');
      onNext();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <Card>
      <h1 className="text-lg font-bold text-gray-900">آخر خطوة لدى Meta: بطاقة الدفع</h1>
      <p className="mt-2 text-[14px] text-gray-700">تحاسبك Meta على رسائل واتساب مباشرة من بطاقتك حسب عدد الرسائل، ولا تمر هذه الرسوم عبر شِفت.</p>
      <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[13px] text-amber-900">بدون بطاقة قد ترفض Meta ردود البوت.</p>
      <div className="mt-4 space-y-2">
        <a href={WHATSAPP_MANAGER_URL} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
          افتح إعدادات الدفع في WhatsApp Manager <ExternalLink size={14} />
        </a>
        <button type="button" onClick={claim} disabled={busy} className={btnPrimary}>
          {busy ? <Loader2 size={16} className="animate-spin" /> : null} أضفت البطاقة
        </button>
        <button type="button" onClick={onNext} disabled={busy} className="w-full h-11 text-[14px] text-gray-600 underline underline-offset-2">لاحقًا</button>
      </div>
      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}
    </Card>
  );
}

/* ── ٣ البوت ──────────────────────────────────────────────────────────────── */

const HOURS_CHOICES = ['كل يوم 9ص–10م', 'السبت–الخميس 9ص–6م'];

function GenericTeach({ onSaved, onSkip }) {
  const [hoursChoice, setHoursChoice] = useState(null); // one of HOURS_CHOICES | 'other'
  const [hoursOther, setHoursOther] = useState('');
  const [location, setLocation] = useState('');
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    const hours = hoursChoice === 'other' ? hoursOther.trim() : (hoursChoice ? `ساعات الدوام: ${hoursChoice}` : '');
    const posts = [];
    if (hours) posts.push({ kind: 'hours', content: hours });
    if (location.trim()) posts.push({ kind: 'fact', content: location.trim() });
    if (question.trim() && answer.trim()) posts.push({ kind: 'faq', question: question.trim(), content: answer.trim() });
    if (!posts.length) { onSkip(); return; }
    setBusy(true); setError(null);
    try {
      // One at a time, so a failure says which card did not save and the rest are not doubled
      // on a second press.
      for (const p of posts) {
        await api.post('/knowledge', p);
        if (p.kind === 'hours') { setHoursChoice(null); setHoursOther(''); }
        if (p.kind === 'fact') setLocation('');
        if (p.kind === 'faq') { setQuestion(''); setAnswer(''); }
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[14px] font-semibold text-gray-900">الدوام</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {HOURS_CHOICES.map((h) => (
            <button key={h} type="button" onClick={() => setHoursChoice(h)}
              className={`rounded-full border px-3 h-10 text-[13px] ${hoursChoice === h ? 'border-green-600 bg-green-50 text-green-900' : 'border-gray-200 text-gray-700'}`}>{h}</button>
          ))}
          <button type="button" onClick={() => setHoursChoice('other')}
            className={`rounded-full border px-3 h-10 text-[13px] ${hoursChoice === 'other' ? 'border-green-600 bg-green-50 text-green-900' : 'border-gray-200 text-gray-700'}`}>غير ذلك</button>
        </div>
        {hoursChoice === 'other' && (
          <input value={hoursOther} onChange={(e) => setHoursOther(e.target.value)} className={`${inputClass} mt-2`}
            placeholder="مثلًا: السبت–الخميس 10ص–11م، الجمعة بعد الصلاة" />
        )}
      </Card>
      <Card>
        <p className="text-[14px] font-semibold text-gray-900">الموقع والتوصيل</p>
        <textarea value={location} onChange={(e) => setLocation(e.target.value)} rows={2}
          className="mt-2 w-full rounded-xl border border-gray-200 p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="مثلًا: إربد، شارع الجامعة قرب دوار القبة. نوصّل داخل إربد بدينار." />
      </Card>
      <Card>
        <p className="text-[14px] font-semibold text-gray-900">أكثر سؤال يسأله زبائنك</p>
        <input value={question} onChange={(e) => setQuestion(e.target.value)} className={`${inputClass} mt-2`} placeholder="السؤال" />
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} rows={2}
          className="mt-2 w-full rounded-xl border border-gray-200 p-3 text-[14px] focus:outline-none focus:ring-2 focus:ring-green-500"
          placeholder="جوابك" />
      </Card>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <TeachButtons busy={busy} onSave={save} onSkip={onSkip} />
    </div>
  );
}

function RestaurantTeach({ info, onSaved, onSkip }) {
  const [rows, setRows] = useState([{ name: '', price: '' }, { name: '', price: '' }, { name: '', price: '' }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setRow = (i, key, val) => setRows((r) => r.map((row, j) => (j === i ? { ...row, [key]: val } : row)));

  const save = async () => {
    // Arabic-Indic digits are what many phones type; the price column is a number.
    const toNumber = (v) => parseFloat(String(v).replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))));
    const filled = rows.filter((r) => r.name.trim());
    if (!filled.length) { onSkip(); return; }
    if (filled.some((r) => !Number.isFinite(toNumber(r.price)) || toNumber(r.price) < 0)) {
      setError('اكتب سعر كل صنف بالأرقام'); return;
    }
    setBusy(true); setError(null);
    try {
      // The menu screen cannot create categories, so a first item goes into «الأصناف», made here
      // once and reused after.
      const cats = await api.get('/menu/categories');
      const list = cats.data?.categories || [];
      let categoryId = (list.find((c) => c.name_ar === 'الأصناف') || list[0])?.id;
      if (!categoryId) {
        const made = await api.post('/menu/categories', { name_ar: 'الأصناف' });
        categoryId = made.data?.category?.id;
      }
      // One at a time; each saved row leaves the form, so a second press after a failure does
      // not add the same dish twice.
      for (const row of filled) {
        await api.post('/menu/items', { category_id: categoryId, name_ar: row.name.trim(), price: toNumber(row.price) });
        setRows((r) => r.filter((x) => x !== row));
      }
      onSaved();
    } catch (err) {
      setError('تعذّر حفظ الأصناف، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[14px] font-semibold text-gray-900">أضف 3 أصناف بأسعارها</p>
        <div className="mt-2 space-y-2">
          {rows.map((r, i) => (
            <div key={i} className="flex gap-2">
              <input value={r.name} onChange={(e) => setRow(i, 'name', e.target.value)} className={`${inputClass} flex-1`} placeholder="اسم الصنف" />
              <input value={r.price} onChange={(e) => setRow(i, 'price', e.target.value)} inputMode="decimal" dir="ltr"
                className={`${inputClass} w-24 text-center`} placeholder="د.أ" />
            </div>
          ))}
        </div>
        <a href={waLink(`${stuckText(info, 'teach')} — أرسل لكم صورة القائمة`)} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-block text-[13px] text-gray-600 underline underline-offset-2">
          أو صوّر القائمة وأرسلها لشِفت على واتساب
        </a>
      </Card>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <TeachButtons busy={busy} onSave={save} onSkip={onSkip} />
    </div>
  );
}

function ClinicTeach({ onSaved, onSkip }) {
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [duration, setDuration] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const save = async () => {
    if (!name.trim()) { onSkip(); return; }
    setBusy(true); setError(null);
    try {
      await api.post('/clinic/services', {
        name_ar: name.trim(),
        price: price === '' ? null : Number(price),
        duration_minutes: Number(duration) || 30,
      });
      onSaved();
    } catch (err) {
      setError('تعذّر حفظ الخدمة، حاول مرة أخرى');
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Card>
        <p className="text-[14px] font-semibold text-gray-900">أضف خدمة وسعرها ومدتها</p>
        <input value={name} onChange={(e) => setName(e.target.value)} className={`${inputClass} mt-2`} placeholder="مثلًا: تنظيف أسنان" />
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="block text-[12px] text-gray-600">السعر (د.أ)
            <input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" dir="ltr" className={`${inputClass} mt-1 text-center`} />
          </label>
          <label className="block text-[12px] text-gray-600">المدة (دقيقة)
            <input value={duration} onChange={(e) => setDuration(e.target.value)} inputMode="numeric" dir="ltr" className={`${inputClass} mt-1 text-center`} />
          </label>
        </div>
      </Card>
      {error && <p className="text-[13px] text-red-600">{error}</p>}
      <TeachButtons busy={busy} onSave={save} onSkip={onSkip} />
    </div>
  );
}

function TeachButtons({ busy, onSave, onSkip }) {
  return (
    <div className="space-y-2">
      <button type="button" onClick={onSave} disabled={busy} className={btnPrimary}>
        {busy ? <Loader2 size={16} className="animate-spin" /> : null} حفظ والتالي
      </button>
      <button type="button" onClick={onSkip} disabled={busy} className="w-full h-11 text-[14px] text-gray-600 underline underline-offset-2">لاحقًا</button>
    </div>
  );
}

function TeachStep({ info, businessType, onNext }) {
  const Body = businessType === 'restaurant' ? RestaurantTeach : businessType === 'clinic' ? ClinicTeach : GenericTeach;
  return (
    <div className="space-y-3">
      <div>
        <h1 className="text-lg font-bold text-gray-900">علّم البوت عن محلك</h1>
        <p className="mt-1 text-[13px] text-gray-600">دقيقة واحدة تكفي. تستطيع الإضافة والتعديل لاحقًا من لوحتك.</p>
      </div>
      <Body info={info} onSaved={onNext} onSkip={onNext} />
    </div>
  );
}

const TRY_HINTS = {
  restaurant: ['ما أوقات الدوام؟', 'هل عندكم توصيل؟', 'شو عندكم أكل؟'],
  clinic: ['ما أوقات الدوام؟', 'بدي أحجز', 'كم سعر الكشفية؟'],
  generic: ['ما أوقات الدوام؟', 'هل عندكم توصيل؟', 'بدي أحجز'],
};

function TryStep({ businessType, onb, onFinish }) {
  const digits = String(onb?.display_phone || '').replace(/\D/g, '');
  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold text-gray-900">جرّب البوت</h1>
      <TryTheBot suggestions={TRY_HINTS[businessType] || TRY_HINTS.generic} />
      {digits && (
        <a href={`https://wa.me/${digits}?text=${encodeURIComponent('مرحبا')}`} target="_blank" rel="noopener noreferrer" className={btnSecondary}>
          جرّب الحقيقي: راسل رقم المحل من هاتف آخر
        </a>
      )}
      <button type="button" onClick={onFinish} className={btnPrimary}>افتح لوحتي</button>
    </div>
  );
}

/* ── The wizard ───────────────────────────────────────────────────────────── */

export default function JoinPage() {
  // Read once, before anything rewrites the URL.
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const [inApp] = useState(() => isInAppBrowser());
  const navigate = useNavigate();
  const { user, setSession } = useAuth();

  const [step, setStep] = useState('loading');
  const [info, setInfo] = useState(null);
  const [onb, setOnb] = useState(null);

  const signedInOwner = user?.role === 'business_owner';

  // Remember where the owner is, so a reload (or coming back from Meta's tab) resumes.
  useEffect(() => {
    if (!signedInOwner || STEP_GROUP[step] === undefined || step === 'password') return;
    writeStore({ step, info, onb });
  }, [step, info, onb, signedInOwner]);

  useEffect(() => {
    let alive = true;
    const fromUser = () => ({
      shop_name: user?.business_name || '',
      owner_first_name: String(user?.name || '').trim().split(/\s+/)[0] || '',
      business_type: user?.business_type || null,
    });

    if (!token) {
      // No link in the URL: a reload after the password step, or the owner coming back.
      const saved = readStore();
      if (signedInOwner && saved?.step) {
        setInfo(saved.info || fromUser()); setOnb(saved.onb || null); setStep(saved.step);
      } else if (signedInOwner && !user?.phone && !user?.email) {
        // A self-signup that has not proven its mobile yet (no login but this session).
        setInfo(fromUser()); setStep('verify');
      } else if (signedInOwner) {
        setInfo(fromUser()); setStep('resume');
      } else {
        // A visitor with no link: «جرّب مجانًا» only when SHIFT opened it; any failure reads closed.
        api.get('/public/signup/config')
          .then((res) => { if (alive) setStep(res.data?.enabled ? 'signup' : 'invite_only'); })
          .catch(() => { if (alive) setStep('invite_only'); });
      }
      return () => { alive = false; };
    }

    // The lookup also tells SHIFT the link was opened (AccountEvent join_opened), so it runs even
    // in an in-app browser, where the owner is then sent to Chrome or Safari.
    api.post('/auth/activate/lookup', { token })
      .then((res) => {
        if (!alive) return;
        const next = normalizeInvite(res.data);
        // A staff or manager invite opened here by mistake: theirs is the plain activation page.
        if (next.role && next.role !== 'business_owner') {
          navigate(`/activate#${token}`, { replace: true });
          return;
        }
        setInfo(next);
        setStep(inApp ? 'in_app' : 'password');
      })
      .catch(() => {
        if (!alive) return;
        // Same 404 for expired, used and unknown links. A signed-in owner has used theirs.
        if (signedInOwner) { setInfo(fromUser()); setStep('resume'); } else setStep('invalid');
      });
    return () => { alive = false; };
    // Runs once per page load: the token and the session at that moment decide the first screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const afterActivate = (data) => {
    // Clear the fragment first, so the token does not sit in the address bar or the history.
    window.history.replaceState(null, '', '/join');
    setSession?.(data.token, data.user);
    setInfo((i) => ({
      ...i,
      shop_name: i?.shop_name || data.user?.business_name || '',
      business_type: data.user?.business_type || i?.business_type || null,
    }));
    // A shop SHIFT connected beforehand still passes through «connect», which finds it connected
    // and goes straight to «هل هذا رقم محلك؟».
    setStep('connect');
  };

  // A self-signup is signed in already; it proves its mobile, then continues where an invited
  // owner does after the password. The code rides in `info` so a reload keeps showing it.
  const afterSignup = (data) => {
    setSession?.(data.token, data.user);
    setInfo({
      shop_name: data.user?.business_name || '',
      owner_first_name: String(data.user?.name || '').trim().split(/\s+/)[0] || '',
      business_type: data.user?.business_type || null,
      verify_code: data.verify?.code || null,
    });
    setStep('verify');
  };

  const onVerified = useStableCallback(() => {
    setInfo((i) => ({ ...i, verify_code: null }));
    setStep('connect');
  });

  const onConnected = useStableCallback((o) => {
    setOnb(o);
    setStep('confirm');
  });

  const onAlreadyConnected = useStableCallback(() => setStep('payment'));

  const finish = () => {
    writeStore(null);
    navigate('/overview', { replace: true });
  };

  const businessType = businessTypeOf(info, user);
  const afterPayment = () => setStep('teach');

  let body;
  if (step === 'loading') {
    body = <Card><p className="flex items-center gap-2 text-[14px] text-gray-600"><Loader2 size={16} className="animate-spin" /> جارٍ فتح الرابط…</p></Card>;
  } else if (step === 'in_app') body = <InAppScreen info={info} />;
  else if (step === 'invalid') body = <InvalidScreen />;
  else if (step === 'invite_only') body = <InviteOnlyScreen />;
  else if (step === 'signup') body = <SignupStep onDone={afterSignup} />;
  else if (step === 'verify') body = <VerifyStep code={info?.verify_code} onVerified={onVerified} />;
  else if (step === 'resume') body = <ResumeScreen info={info} onContinue={() => setStep('connect')} />;
  else if (step === 'password') body = <PasswordStep info={info} token={token} onDone={afterActivate} />;
  else if (step === 'connect') body = <ConnectStep info={info} onConnected={onConnected} onAlreadyConnected={onAlreadyConnected} onSkip={() => setStep('teach')} />;
  else if (step === 'confirm') {
    body = (
      <ConfirmStep onb={onb}
        onYes={() => setStep(onb?.payment?.confirmed ? 'teach' : 'payment')}
        onNo={() => setStep('wrong_number')} />
    );
  } else if (step === 'wrong_number') body = <WrongNumberStep info={info} onContinue={() => setStep('teach')} />;
  else if (step === 'payment') body = <PaymentStep onNext={afterPayment} />;
  else if (step === 'teach') body = <TeachStep info={info} businessType={businessType} onNext={() => setStep('try')} />;
  else body = <TryStep businessType={businessType} onb={onb} onFinish={finish} />;

  return <Shell step={step} info={info}>{body}</Shell>;
}

// A callback whose identity never changes but which always runs the latest render's closure, so
// ConnectStep's mount effect (which depends on it) runs once.
function useStableCallback(fn) {
  const [ref] = useState(() => ({ current: fn }));
  ref.current = fn;
  const [stable] = useState(() => (...args) => ref.current(...args));
  return stable;
}
