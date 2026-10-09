import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, X, Loader2, Copy, ExternalLink } from 'lucide-react';
import api from '../../utils/api';
import {
  preload, getLoadedSdk, launchEmbeddedSignup, isFacebookOrigin, isInAppBrowser,
} from '../../utils/facebookSdk';
import { connectView } from './connectView';

/**
 * «اربط واتساب» — Embedded Signup v4, in Arabic, for SHIFT's attended connect and later the owner.
 *
 * The browser's whole job is to collect Meta's signup result and the 30-second code and hand
 * both to the backend. No Graph call and no token ever happens here.
 *
 * `endpoints` picks whose routes it talks to: adminEndpoints(accountId) is SHIFT's mirror, where
 * the account comes from the URL; OWNER_ENDPOINTS is the owner's own router, which takes the
 * business from the session and stays closed (503) until G1 has passed. The body never names a
 * business: the backend refuses one with a 400.
 *
 * What the screen can be in, all read back from GET /status on mount so a reload in the middle
 * shows «حاول مرة أخرى» or «أكمل الربط» instead of a fresh start: not connected; Meta's window
 * open; exchanging; stopped part-way (with a PIN field when the number already has two-step
 * verification); a WABA with no number («أضف الرقم»); waiting for SHIFT to pick the number;
 * removed by Meta («أعد الربط»); connected, with the payment card step after it. connectView.js
 * decides which, and what the button says.
 */

export function adminEndpoints(accountId) {
  return {
    config: '/admin/embedded-signup/config',
    base: `/admin/accounts/${encodeURIComponent(accountId || '')}/embedded-signup`,
    audience: 'staff',
  };
}

export const OWNER_ENDPOINTS = {
  config: '/whatsapp/embedded-signup/config',
  base: '/whatsapp/embedded-signup',
  // «لا، ليس هذا الرقم» on /join: tells SHIFT (needs_operator, wrong_number, an alert).
  wrongNumber: '/whatsapp/embedded-signup/wrong-number',
  audience: 'owner',
};

const SUPPORT_WA = 'https://wa.me/962776788972';

// The four things the server does after the popup, in the order onboarding.step records them.
const STEPS = [
  ['code_received', 'وصلت موافقتك'],
  ['token_exchanged', 'تحققنا أن الرقم يخصك'],
  ['subscribed', 'ربطنا الرقم بكرم بوت'],
  ['registered', 'سجّلنا الرقم لدى واتساب'],
];
const STEP_INDEX = Object.fromEntries(STEPS.map(([k], i) => [k, i]));

// failed_step may name the stage that failed or the step last reached; both read the same way to
// the person in front of the screen. Anything unknown gets a neutral phrase, never the raw name.
const FAILED_STEP_LABEL = {
  exchange: 'تأكيد موافقتك',
  code_received: 'التحقق من الرقم',
  verify: 'التحقق من الرقم',
  token_exchanged: 'ربط الرقم بكرم بوت',
  subscribe: 'ربط الرقم بكرم بوت',
  subscribed: 'تسجيل الرقم',
  register: 'تسجيل الرقم',
  registered: 'إكمال الربط',
  link: 'إكمال الربط',
};
function failedStepLabel(onb) {
  return FAILED_STEP_LABEL[onb?.failed_step] || FAILED_STEP_LABEL[onb?.step] || 'إحدى خطوات الربط';
}

// Meta's current_step names are not documented; they are read by keyword so an owner never sees
// an English constant. The board keeps the raw value from the event.
function metaStepLabel(step) {
  const s = String(step || '').toUpperCase();
  if (s.includes('VERIF') || s.includes('OTP') || s.includes('CODE')) return 'التحقق من الرقم';
  if (s.includes('PHONE') || s.includes('NUMBER')) return 'إدخال الرقم';
  if (s.includes('PROFILE') || s.includes('NAME')) return 'اسم النشاط';
  if (s.includes('WABA') || s.includes('WHATSAPP')) return 'حساب واتساب للأعمال';
  if (s.includes('BUSINESS') || s.includes('PORTFOLIO')) return 'اختيار حساب الأعمال';
  if (s.includes('LOGIN') || s.includes('AUTH')) return 'تسجيل الدخول إلى فيسبوك';
  if (s.includes('PERMISSION') || s.includes('CONSENT')) return 'الموافقة على الصلاحيات';
  return 'إحدى خطوات Meta';
}

const NAME_STATUS = {
  APPROVED: 'مقبول',
  AVAILABLE_WITHOUT_REVIEW: 'مقبول',
  PENDING_REVIEW: 'قيد المراجعة',
  DECLINED: 'مرفوض',
  EXPIRED: 'منتهٍ',
  NONE: 'لم يُراجَع بعد',
};

// A copy of backend/src/config/metaNotices.js, which the browser cannot import. Keep the two in
// step: backend/tests/embeddedSignup.test.js fails when a string here differs from the server's.
// No dates, and never a promise of «بدون رسوم»: Meta bills the shop directly.
const WHATSAPP_MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const PAYMENT_NOTICES = {
  missing: {
    owner: {
      short: 'أضف بطاقة الدفع لدى Meta',
      long: 'أضف بطاقة دفع في WhatsApp Manager. بدونها قد ترفض Meta ردود البوت على زبائنك. هذه خطوة عندك أنت، لا عند شِفت.',
    },
    staff: {
      short: 'بدون بطاقة دفع مؤكدة لدى Meta',
      long: 'بدون طريقة دفع لدى Meta لا تُسلَّم ردود البوت للزبائن. Meta لا تُخبرنا إن كانت مضافة، فأكّدها يدويًا بعد أن تراها في WhatsApp Manager.',
    },
  },
  claimed: {
    owner: {
      short: 'أضفت البطاقة — بانتظار تأكيد شِفت',
      long: 'شكرًا. سيتأكد فريق شِفت من ظهور البطاقة في حسابك لدى Meta.',
    },
    staff: {
      short: 'الزبون أضاف البطاقة — بانتظار تأكيدك',
      long: 'يقول الزبون إنه أضاف بطاقة الدفع. تأكد من ظهورها في WhatsApp Manager ثم أكّدها هنا.',
    },
  },
  blocked: {
    owner: {
      short: 'رفضت واتساب ردود البوت — أضف بطاقة دفع لدى Meta',
      long: 'رفضت Meta تسليم ردود البوت لزبائنك بسبب طريقة الدفع. أضف بطاقة دفع أو صحّح بطاقتك في WhatsApp Manager. رسائل زبائنك ما زالت تصلك في «المحادثات».',
    },
    staff: {
      short: 'رفضت واتساب ردود البوت — طريقة الدفع لدى Meta',
      long: 'فشل إرسال رد بخطأ Meta رقم 131042 (طريقة الدفع). على الزبون إضافة بطاقة دفع أو تصحيحها في WhatsApp Manager.',
    },
  },
};

// Coexistence (P5): a number that stays on the WhatsApp Business app on the owner's phone. A copy
// of backend/src/services/coexistence.js NOTICE_AR; backend/tests/coexistence.test.js fails when
// the two differ. Offered only when the server's config says SHIFT has switched it on.
const COEX_NOTICE = {
  inactivity: 'افتح واتساب للأعمال على هاتف المحل مرة كل بضعة أيام على الأقل: إذا بقي الهاتف دون استخدام نحو 14 يومًا تفصل Meta الرقم عن كرم بوت، ويلزم ربطه من جديد.',
  throughput: 'سرعة الإرسال على هذا الرقم محدودة بـ20 رسالة في الثانية، وهذا أكثر من كافٍ لمحل.',
  owner_hold: 'حين ترد على زبون من التطبيق يسكت البوت في تلك المحادثة ساعتين.',
};

function paymentState(payment) {
  if (!payment) return 'missing';
  if (payment.blocked) return 'blocked';
  if (payment.confirmed) return null;
  return payment.claimed ? 'claimed' : 'missing';
}

/**
 * The contract is {status, onboarding}. An older server answered {onboarding} alone, so the
 * status is derived from it rather than shown as nothing.
 */
function normalize(data, previousStatus) {
  const onboarding = data?.onboarding || null;
  let status = data?.status;
  if (!status) {
    if (!onboarding) status = previousStatus || 'not_started';
    else if (onboarding.connected || onboarding.step === 'done') status = 'connected';
    else if (onboarding.failed) status = 'failed';
    else status = 'in_progress';
  }
  return { status, onboarding };
}

// Android only: an intent link that reopens this page in Chrome. iOS has no equivalent, so it
// gets the copy button. A URL fragment cannot ride in the intent's data part, so it goes in the
// fallback URL as well.
function chromeIntentUrl() {
  const { host, pathname, search, href } = window.location;
  return `intent://${host}${pathname}${search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(href)};end`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

const btnPrimary = 'inline-flex items-center justify-center gap-2 rounded-lg bg-green-600 px-4 h-10 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed';
const btnSecondary = 'inline-flex items-center justify-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 h-9 text-[13px] text-gray-800 hover:bg-gray-50 disabled:opacity-50';

function StepList({ reached, failedAt, working }) {
  return (
    <ul className="mt-3 space-y-1.5">
      {STEPS.map(([key, label], i) => {
        const done = i <= reached;
        const failed = failedAt === i;
        return (
          <li key={key} className="flex items-center gap-2 text-[13px]">
            {done ? <Check size={14} className="text-emerald-600" />
              : failed ? <X size={14} className="text-red-500" />
                : working ? <Loader2 size={14} className="animate-spin text-gray-400" />
                  : <span className="inline-block h-3.5 w-3.5 rounded-full border border-gray-300" />}
            <span className={done ? 'text-gray-500' : failed ? 'text-red-700' : 'text-gray-700'}>{label}</span>
          </li>
        );
      })}
    </ul>
  );
}

export default function ConnectWhatsApp({ endpoints, beforeConnectNote = null, onChange, framed = true }) {
  const { config: configUrl, base, audience = 'owner' } = endpoints || {};
  const isStaff = audience === 'staff';

  const [remote, setRemote] = useState(null); // {status, onboarding} from the server
  const [loadError, setLoadError] = useState(null);
  const [config, setConfig] = useState(null);
  const [sdkReady, setSdkReady] = useState(false);
  const [sdkFailed, setSdkFailed] = useState(false);
  const [busy, setBusy] = useState(null); // null | 'popup' | 'exchanging' | 'retrying'
  const [problem, setProblem] = useState(null); // {kind, text, sessionId?}
  const [pin, setPin] = useState('');
  const [copied, setCopied] = useState(false);
  const [inApp] = useState(() => isInAppBrowser());

  // Meta's FINISH payload arrives on a message event and the code on the FB.login callback; the
  // backend needs both. Whichever lands first waits here.
  const finishRef = useRef(null);
  const finishWaiter = useRef(null);
  // Set when Meta's window itself said why it closed, so the login callback does not overwrite
  // «توقفت عند…» with a guess.
  const metaOutcomeRef = useRef(null);
  const blockedCount = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Kept beside the state so the update and the parent's callback happen once, outside a
  // setState updater (which React may run twice).
  const remoteRef = useRef(null);
  const applyRemote = useCallback((data) => {
    const next = normalize(data, remoteRef.current?.status);
    remoteRef.current = next;
    setRemote(next);
    if (onChangeRef.current) onChangeRef.current(next);
  }, []);

  // Where it stands, so a reload resumes instead of restarting.
  useEffect(() => {
    if (!base) return undefined;
    let alive = true;
    api.get(`${base}/status`)
      .then((res) => { if (alive) { remoteRef.current = normalize(res.data); setRemote(remoteRef.current); } })
      .catch((err) => {
        if (!alive) return;
        // No onboarding yet is a 404 on some servers: that is simply «not started».
        if (err.response?.status === 404) { remoteRef.current = { status: 'not_started', onboarding: null }; setRemote(remoteRef.current); }
        else setLoadError(err.response?.data?.message || err.response?.data?.error_ar || 'تعذّر قراءة حالة الربط.');
      });
    return () => { alive = false; };
  }, [base]);

  // Config, then the SDK, on mount: the tap must find FB already loaded.
  useEffect(() => {
    if (!configUrl) return undefined;
    let alive = true;
    api.get(configUrl)
      .then((res) => {
        if (!alive) return;
        setConfig(res.data);
        preload({ appId: res.data.app_id, graphVersion: res.data.graph_version, locale: res.data.locale || 'ar_AR' })
          .then(() => { if (alive) setSdkReady(true); })
          .catch(() => { if (alive) setSdkFailed(true); });
      })
      .catch((err) => {
        // The owner router answers 503 «الربط الذاتي متوقف مؤقتًا» until G1 has passed.
        if (alive) setLoadError(err.response?.data?.message || err.response?.data?.error || 'تعذّر تحميل إعدادات واتساب.');
      });
    return () => { alive = false; };
  }, [configUrl]);

  const retryLoadSdk = () => {
    if (!config) return;
    setSdkFailed(false);
    preload({ appId: config.app_id, graphVersion: config.graph_version, locale: config.locale || 'ar_AR' })
      .then(() => setSdkReady(true))
      .catch(() => setSdkFailed(true));
  };

  const postEvent = useCallback((body) => {
    if (!base) return;
    api.post(`${base}/events`, body).catch(() => {}); // telemetry: never in the way of the screen
  }, [base]);

  // Meta's events for the flow, only trusted from facebook.com.
  useEffect(() => {
    function onMessage(event) {
      if (!isFacebookOrigin(event.origin)) return;
      let payload;
      try {
        payload = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      } catch {
        return; // facebook.com sends other, non-JSON chatter through this channel
      }
      if (payload?.type !== 'WA_EMBEDDED_SIGNUP') return;
      const name = String(payload.event || '');
      const data = payload.data || {};

      // Every FINISH* is a success: FINISH, FINISH_ONLY_WABA (maybe no number),
      // FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING (coexistence; the server holds off /register).
      // The server decides what each means; dropping one here used to burn the 30-second code.
      if (name.startsWith('FINISH') && !data.error_message) {
        finishRef.current = {
          finish_event: name,
          waba_id: data.waba_id,
          phone_number_id: data.phone_number_id,
          meta_business_id: data.business_id,
          session_id: data.session_id,
        };
        if (finishWaiter.current) finishWaiter.current();
        return;
      }

      // Meta's docs show a user-facing error as CANCEL carrying error_message, older flows as
      // ERROR. Both are errors; a CANCEL with only current_step is someone closing the window.
      const isError = name === 'ERROR' || Boolean(data.error_message);
      if (!isError && name !== 'CANCEL') return;

      if (isError) {
        metaOutcomeRef.current = 'error';
        setProblem({
          kind: 'meta_error',
          text: data.error_message ? `أبلغت Meta عن خطأ: ${data.error_message}` : 'أبلغت Meta عن خطأ أثناء الربط.',
          sessionId: data.session_id || null,
        });
      } else {
        metaOutcomeRef.current = 'cancel';
        setProblem({
          kind: 'abandoned',
          text: `توقفت عند: ${metaStepLabel(data.current_step)}. لم يضِع شيء — أكمل من هنا.`,
        });
      }
      postEvent({
        event: name === 'ERROR' ? 'ERROR' : 'CANCEL',
        current_step: data.current_step,
        error_message: data.error_message,
        error_code: data.error_code,
        session_id: data.session_id,
      });
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [postEvent]);

  // FINISH normally lands before the login callback. If not, wait a moment, then send the code
  // with what we have: the code is what expires, and the server can find the number itself.
  const waitForFinish = (ms) => new Promise((resolve) => {
    if (finishRef.current) { resolve(finishRef.current); return; }
    const t = setTimeout(() => { finishWaiter.current = null; resolve(finishRef.current); }, ms);
    finishWaiter.current = () => { clearTimeout(t); finishWaiter.current = null; resolve(finishRef.current); };
  });

  const failWith = (err, fallback) => {
    const body = err.response?.data;
    if (body?.onboarding || body?.status) applyRemote(body);
    setProblem({ kind: 'server', text: body?.message || body?.error_ar || fallback });
  };

  const exchange = async (code) => {
    setBusy('exchanging');
    const finish = await waitForFinish(1500);
    const body = { code };
    for (const [k, v] of Object.entries(finish || {})) if (v) body[k] = v;
    try {
      const res = await api.post(`${base}/exchange`, body);
      applyRemote(res.data);
    } catch (err) {
      failWith(err, 'تعذّر إكمال الربط. اضغط «أكمل الربط» للمحاولة مرة أخرى.');
    } finally {
      setBusy(null);
    }
  };

  // Called straight from the click. Nothing is awaited before FB.login (inside
  // launchEmbeddedSignup): an await here spends the tap, and the browser blocks Meta's window.
  // `mode` 'coexistence' asks Meta for the WhatsApp Business app flow; anything else (a click
  // event, when used as onClick directly) is the usual new-number flow.
  const launch = (mode) => {
    const coexistence = mode === 'coexistence' && Boolean(config?.coexistence);
    const FB = getLoadedSdk();
    if (!FB || !config) {
      setProblem({ kind: 'sdk', text: 'نافذة فيسبوك لم تجهز بعد. انتظر لحظة ثم اضغط مرة أخرى.' });
      return;
    }
    finishRef.current = null;
    metaOutcomeRef.current = null;
    const startedAt = Date.now();
    const pending = launchEmbeddedSignup(FB, { configId: config.config_id, coexistence });
    setProblem(null);
    setBusy('popup');
    postEvent({ event: 'LAUNCHED' });

    pending.then(({ code }) => {
      if (code) { exchange(code); return; }
      setBusy(null);
      if (metaOutcomeRef.current) return; // Meta already said why; that message stays
      // A callback with no code almost at once means the window never opened.
      if (Date.now() - startedAt < 1500) {
        blockedCount.current += 1;
        const again = blockedCount.current > 1;
        setProblem({
          kind: 'blocked',
          text: again
            ? (isStaff
              ? 'ما زال المتصفح يمنع نافذة فيسبوك. اسمح بالنوافذ المنبثقة لهذا الموقع، أو جرّب متصفحًا آخر.'
              : 'جرّب من الكمبيوتر، أو اطلب من شِفت أن يربط معك.')
            : 'منع المتصفح نافذة فيسبوك — اضغط مرة أخرى.',
        });
      } else {
        setProblem({ kind: 'closed', text: 'أُغلقت نافذة فيسبوك قبل أن تكتمل الخطوات. لم يضِع شيء — أكمل من هنا.' });
      }
    });
  };

  const retry = async (withPin) => {
    setBusy('retrying');
    setProblem(null);
    try {
      const res = await api.post(`${base}/retry`, withPin ? { pin: withPin } : {});
      applyRemote(res.data);
      setPin('');
    } catch (err) {
      failWith(err, 'تعذّرت إعادة المحاولة.');
    } finally {
      setBusy(null);
    }
  };

  const copySession = async (id) => {
    if (await copyText(id)) { setCopied(true); setTimeout(() => setCopied(false), 2000); }
  };

  const status = remote?.status;
  const onb = remote?.onboarding || null;
  // The state and its one button (connectView.js): the label is the button the server's Arabic
  // names in that state, «أعد الربط», «أضف الرقم», «حاول مرة أخرى» or «أكمل الربط».
  const view = connectView({ status, onb, problem, isStaff });
  const connected = view.kind === 'connected';
  const waitingOperator = view.kind === 'waiting_operator';
  const { started } = view;
  const resumeOnServer = view.action === 'retry';
  const reached = onb?.step === 'done' ? STEPS.length - 1 : (STEP_INDEX[onb?.step] ?? -1);
  const canLaunch = Boolean(sdkReady && config && base) && !busy;

  const frame = framed ? 'rounded-xl border border-gray-200 bg-white p-4' : 'p-4';

  // ── Loading ────────────────────────────────────────────────────────────────
  if (!remote && !loadError) {
    return (
      <div className={frame} dir="rtl">
        <p className="flex items-center gap-2 text-[13px] text-gray-500"><Loader2 size={14} className="animate-spin" /> جارٍ قراءة حالة الربط…</p>
      </div>
    );
  }

  // ── Connected ──────────────────────────────────────────────────────────────
  if (connected) {
    const pay = paymentState(onb?.payment);
    const notice = pay ? PAYMENT_NOTICES[pay][isStaff ? 'staff' : 'owner'] : null;
    const nameLabel = NAME_STATUS[onb?.name_status];
    return (
      <div className={frame} dir="rtl">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100"><Check size={14} className="text-emerald-700" /></span>
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-gray-900">
              واتساب متصل{onb?.display_phone && <>: <bdi dir="ltr">{onb.display_phone}</bdi></>}
            </p>
            {onb?.verified_name && (
              <p className="mt-0.5 text-[13px] text-gray-600">
                الاسم الذي يراه الزبائن: {onb.verified_name}{nameLabel && <span className="text-gray-400"> ({nameLabel})</span>}
              </p>
            )}
            {onb?.name_status === 'PENDING_REVIEW' && (
              <p className="mt-0.5 text-[12px] text-gray-500">تراجع Meta الاسم، عادة خلال يوم أو يومين.</p>
            )}
            {onb?.name_status === 'DECLINED' && (
              <p className="mt-0.5 text-[12px] text-red-700">رفضت Meta الاسم — يرى الزبائن الرقم بدل الاسم.</p>
            )}
          </div>
        </div>

        {onb?.coexistence && (
          <div className="mt-3 rounded-lg bg-blue-50 p-3 text-[13px] text-blue-900">
            <p className="font-medium">الرقم يعمل على تطبيق واتساب للأعمال وعلى كرم بوت معًا.</p>
            <p className="mt-1 text-[12px]">{COEX_NOTICE.inactivity}</p>
            <p className="mt-1 text-[12px]">{COEX_NOTICE.owner_hold}</p>
          </div>
        )}

        {/* The last step is the customer's own, and it is the one that silently blocks
            sending, so it sits in the open rather than in a footnote. */}
        {notice && (
          <div className={`mt-3 rounded-lg p-3 text-[13px] ${pay === 'blocked' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-medium">{notice.short}</p>
            <p className="mt-1 text-[12px]">{notice.long}</p>
            <a href={WHATSAPP_MANAGER_URL} target="_blank" rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 font-medium underline">
              افتح إعدادات الدفع في WhatsApp Manager <ExternalLink size={12} />
            </a>
          </div>
        )}
      </div>
    );
  }

  // ── Everything before «connected» ─────────────────────────────────────────
  const buttonLabel = view.label;
  const failedAt = (status === 'failed' || problem?.kind === 'server') && reached >= 0 && reached < STEPS.length - 1
    ? reached + 1 : null;

  return (
    <div className={frame} dir="rtl">
      {loadError && (
        <div className="mb-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-800">{loadError}</div>
      )}

      {!started && view.kind === 'steps' && beforeConnectNote && !busy && (
        <p className="mb-3 rounded-lg bg-gray-50 p-3 text-[13px] text-gray-700">{beforeConnectNote}</p>
      )}

      {inApp ? (
        // Meta's popup does not work in WhatsApp's or Facebook's own browser, so no button here.
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-[13px] text-amber-900">
          <p className="font-medium">افتح الرابط في Chrome أو Safari لتتمكن من ربط واتساب.</p>
          <p className="mt-1 text-[12px]">متصفح واتساب أو فيسبوك أو إنستغرام لا يفتح نافذة الربط من Meta.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {/android/i.test(navigator.userAgent) && (
              <a href={chromeIntentUrl()} className={btnSecondary}>افتح في المتصفح</a>
            )}
            <button type="button" className={btnSecondary}
              onClick={async () => { if (await copyText(window.location.href)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}>
              <Copy size={13} /> {copied ? 'نُسخ الرابط' : 'نسخ الرابط'}
            </button>
          </div>
        </div>
      ) : busy === 'popup' ? (
        <div className="rounded-lg bg-blue-50 p-4 text-[13px] text-blue-900">
          <p className="flex items-center gap-2 font-medium"><Loader2 size={14} className="animate-spin" /> أكمل الخطوات في نافذة فيسبوك — لا تغلق هذه الصفحة.</p>
        </div>
      ) : busy === 'exchanging' || busy === 'retrying' ? (
        <div>
          <p className="flex items-center gap-2 text-[14px] font-medium text-gray-900"><Loader2 size={15} className="animate-spin" /> جارٍ الربط…</p>
          <StepList reached={busy === 'retrying' ? reached : -1} failedAt={null} working />
        </div>
      ) : view.kind === 'revoked' || view.kind === 'needs_number' ? (
        // Their own cards, with no step list: a revoked shop's steps were all done once and
        // would show four green ticks, and a WABA with no number has no step to stop at.
        <div>
          <div className={`rounded-lg p-4 text-[13px] ${view.kind === 'revoked' ? 'bg-red-50 text-red-900' : 'bg-amber-50 text-amber-900'}`}>
            <p className="font-medium">
              {view.kind === 'revoked'
                ? 'انفصل كرم بوت عن حساب Meta — البوت لا يستقبل الرسائل.'
                : 'حساب واتساب للأعمال جاهز لكن بلا رقم.'}
            </p>
            {onb?.last_error_ar && <p className="mt-1 text-[12px]">{onb.last_error_ar}</p>}
            {problem && <p className="mt-1 text-[12px]">{problem.text}</p>}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button type="button" onClick={launch} disabled={!canLaunch} className={btnPrimary}>{buttonLabel}</button>
            {!isStaff && (
              <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer" className={btnSecondary}>تواصل مع شِفت</a>
            )}
            {!sdkReady && !sdkFailed && !loadError && (
              <span className="flex items-center gap-1 text-[12px] text-gray-400"><Loader2 size={12} className="animate-spin" /> جارٍ تجهيز نافذة فيسبوك…</span>
            )}
          </div>
          {sdkFailed && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900">
              <p>تعذّر تحميل فيسبوك. أوقف مانع الإعلانات لهذا الموقع أو جرّب متصفحًا آخر.</p>
              <button type="button" onClick={retryLoadSdk} className="mt-2 font-medium underline">حاول التحميل مرة أخرى</button>
            </div>
          )}
        </div>
      ) : waitingOperator ? (
        <div className="rounded-lg bg-amber-50 p-4 text-[13px] text-amber-900">
          <p className="font-medium">وصل الربط إلى خطوة يكملها فريق شِفت — لا داعي لإعادة الخطوات.</p>
          {onb?.last_error_ar && <p className="mt-1 text-[12px]">{onb.last_error_ar}</p>}
          {isStaff && (
            <p className="mt-2 text-[12px] text-amber-800">
              أكمله من «ربط بدون حساب» في صفحة «نظرة عامة»: «أكمل الربط» ثم معرّف الرقم من WhatsApp Manager.
            </p>
          )}
          {!isStaff && (
            <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer" className="mt-2 inline-block font-medium underline">تواصل مع شِفت</a>
          )}
        </div>
      ) : (
        <div>
          {(status === 'in_progress' || status === 'failed') && onb?.step && (
            <>
              <p className="text-[14px] font-medium text-gray-900">توقف الربط عند: {failedStepLabel(onb)}</p>
              <StepList reached={reached} failedAt={failedAt} />
            </>
          )}

          {onb?.last_error_ar && !problem && (
            <p className="mt-3 rounded-lg bg-red-50 p-3 text-[13px] text-red-800">{onb.last_error_ar}</p>
          )}

          {problem && (
            <div className={`mt-3 rounded-lg p-3 text-[13px] ${problem.kind === 'abandoned' || problem.kind === 'closed' ? 'bg-gray-50 text-gray-800' : 'bg-red-50 text-red-800'}`}>
              <p>{problem.text}</p>
              {problem.sessionId && (
                <button type="button" onClick={() => copySession(problem.sessionId)}
                  className="mt-2 inline-flex items-center gap-1 text-[12px] font-medium underline">
                  <Copy size={12} /> {copied ? 'نُسخ رمز الجلسة' : 'نسخ رمز الجلسة للدعم'}
                </button>
              )}
            </div>
          )}

          {/* Two-step verification already set elsewhere: Meta accepts only that PIN. */}
          {onb?.needs_pin && (
            <form className="mt-3 rounded-lg border border-gray-200 p-3"
              onSubmit={(e) => { e.preventDefault(); if (/^\d{6}$/.test(pin)) retry(pin); }}>
              <label htmlFor="es-pin" className="block text-[13px] font-medium text-gray-800">رمز التحقق بخطوتين لرقمك</label>
              <p className="mt-0.5 text-[12px] text-gray-500">إذا لم تعرفه: WhatsApp Manager ← الرقم ← التحقق بخطوتين.</p>
              <div className="mt-2 flex items-center gap-2">
                <input id="es-pin" inputMode="numeric" autoComplete="one-time-code" maxLength={6} dir="ltr"
                  value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-32 rounded-lg border border-gray-200 px-3 h-9 text-center font-mono tracking-[0.3em] focus:outline-none focus:ring-1 focus:ring-green-500"
                  placeholder="••••••" />
                <button type="submit" disabled={pin.length !== 6} className={btnPrimary}>أكمل الربط</button>
              </div>
            </form>
          )}

          {!onb?.needs_pin && (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={resumeOnServer ? () => retry() : launch}
                disabled={resumeOnServer ? !base || Boolean(busy) : !canLaunch}
                className={btnPrimary}
              >
                {buttonLabel}
              </button>
              {started && !isStaff && (
                <a href={SUPPORT_WA} target="_blank" rel="noopener noreferrer" className={btnSecondary}>تواصل مع شِفت</a>
              )}
              {!resumeOnServer && !sdkReady && !sdkFailed && !loadError && (
                <span className="flex items-center gap-1 text-[12px] text-gray-400"><Loader2 size={12} className="animate-spin" /> جارٍ تجهيز نافذة فيسبوك…</span>
              )}
            </div>
          )}

          {sdkFailed && !resumeOnServer && (
            <div className="mt-3 rounded-lg bg-amber-50 p-3 text-[13px] text-amber-900">
              <p>تعذّر تحميل فيسبوك. أوقف مانع الإعلانات لهذا الموقع أو جرّب متصفحًا آخر.</p>
              <button type="button" onClick={retryLoadSdk} className="mt-2 font-medium underline">حاول التحميل مرة أخرى</button>
            </div>
          )}

          {/* P5, only once SHIFT has switched coexistence on: the shop's current number, kept on
              the owner's phone. The button above stays the way for a new SIM. */}
          {config?.coexistence && !resumeOnServer && !onb?.needs_pin && (
            <div className="mt-4 rounded-lg border border-gray-200 p-3">
              <p className="text-[13px] font-medium text-gray-900">رقم المحل الحالي وعليه واتساب؟</p>
              <p className="mt-1 text-[12px] text-gray-600">
                اربطه دون أن تتركه: يبقى تطبيق واتساب للأعمال على هاتفك ومعه محادثاتك، ويرد كرم بوت على الزبائن معك.
              </p>
              <ul className="mt-2 list-disc space-y-1 pr-4 text-[12px] text-gray-600">
                <li>{COEX_NOTICE.inactivity}</li>
                <li>{COEX_NOTICE.owner_hold}</li>
                <li>{COEX_NOTICE.throughput}</li>
              </ul>
              <button type="button" onClick={() => launch('coexistence')} disabled={!canLaunch} className={`${btnSecondary} mt-3`}>
                رقم المحل الحالي وعليه واتساب
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
