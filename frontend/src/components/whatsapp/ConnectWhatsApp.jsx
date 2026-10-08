import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/api';
import { loadFacebookSdk, launchEmbeddedSignup, isFacebookOrigin } from '../../utils/facebookSdk';

/**
 * «اربط واتساب» — Embedded Signup v4.
 *
 * The browser's whole job is to collect the signup result and the 30-second code and
 * hand both to the backend. No Graph call and no token ever happens here.
 *
 * SHIFT's side for now: it calls the admin mirror (/admin/accounts/:businessId/embedded-signup),
 * where the account comes from the URL. The owner's own routes (/whatsapp/embedded-signup)
 * require a business_owner and stay closed until G1 has passed, so this panel would stop working
 * on them. The body never names a business: the backend refuses one with a 400.
 */

const STEP_LABEL = {
  code_received: 'جارٍ البدء…',
  token_exchanged: 'تمّ التفويض — جارٍ ربط حساب واتساب',
  subscribed: 'تمّ الربط — جارٍ تسجيل الرقم',
  registered: 'تمّ تسجيل الرقم',
  done: 'متصل',
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
// The admin mirror is read by SHIFT staff, so the staff wording.
const AUDIENCE = 'staff';

export default function ConnectWhatsApp({ businessId }) {
  const [state, setState] = useState('idle'); // idle | connecting | connected | failed
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);

  // The FINISH payload arrives on the message event, the code on the FB.login callback,
  // and the backend needs both. Whichever lands first waits here.
  const signupData = useRef(null);

  // Every account-scoped call names the account in the URL, never in the body.
  const base = `/admin/accounts/${encodeURIComponent(businessId || '')}/embedded-signup`;

  useEffect(() => {
    api.get('/admin/embedded-signup/config')
      .then((res) => setConfig(res.data))
      .catch(() => setError('تعذّر تحميل إعدادات واتساب.'));
  }, []);

  useEffect(() => {
    if (!businessId) return undefined;
    api.get(`${base}/status`)
      .then((res) => {
        if (res.data.onboarding) {
          setStatus(res.data.onboarding);
          if (res.data.onboarding.connected) setState('connected');
        }
      })
      .catch(() => {});
    return undefined;
  }, [businessId, base]);

  // Meta's events for the flow. Registered per account, and only trusted from facebook.com.
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

      const data = payload.data || {};

      // Meta's current docs report user-facing errors as CANCEL carrying error_message,
      // while older ones used an ERROR event. Both are handled so neither is missed.
      if (payload.event === 'FINISH' && !data.error_message) {
        signupData.current = {
          waba_id: data.waba_id,
          phone_number_id: data.phone_number_id,
          meta_business_id: data.business_id,
        };
        return;
      }

      const message = data.error_message
        || (data.current_step ? `أُلغي الربط عند خطوة ${data.current_step}` : 'أُلغي الربط');
      setError(message);
      setState('failed');
      if (!businessId) return;
      api.post(`${base}/events`, {
        event: data.error_message ? 'ERROR' : 'CANCEL',
        current_step: data.current_step,
        error_message: data.error_message,
        error_code: data.error_code,
        session_id: data.session_id,
      }).catch(() => {});
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [businessId, base]);

  const connect = useCallback(async () => {
    if (!config || !businessId) return;
    setError(null);
    setState('connecting');
    signupData.current = null;

    try {
      const FB = await loadFacebookSdk({ appId: config.app_id, graphVersion: config.graph_version });
      const code = await launchEmbeddedSignup(FB, { configId: config.config_id });

      // FINISH normally lands before the callback; if it has not, the code is still the
      // thing that expires, so it goes up with whatever we have.
      const res = await api.post(`${base}/exchange`, {
        code,
        ...(signupData.current || {}),
      });
      setStatus(res.data.onboarding);
      setState('connected');
    } catch (err) {
      const body = err.response?.data;
      setStatus(body?.onboarding || null);
      setError(body?.message || err.message || 'تعذّر الربط.');
      setState('failed');
    }
  }, [config, businessId, base]);

  const retry = useCallback(async () => {
    // A signup that got past the token step resumes server-side; anything earlier
    // needs a fresh run, because the code is long gone. The server resumes this account's
    // own signup, so no id is sent.
    if (!status?.step || status.step === 'code_received') return connect();
    setError(null);
    setState('connecting');
    try {
      const res = await api.post(`${base}/retry`);
      setStatus(res.data.onboarding);
      setState('connected');
    } catch (err) {
      const body = err.response?.data;
      if (body?.onboarding) setStatus(body.onboarding);
      setError(body?.message || 'تعذّرت إعادة المحاولة.');
      setState('failed');
    }
    return undefined;
  }, [status, connect, base]);

  const paymentState = status?.payment?.state || status?.next_action?.state || null;
  const paymentNotice = paymentState ? PAYMENT_NOTICES[paymentState]?.[AUDIENCE] : null;

  return (
    <div className="rounded-lg border border-gray-200 p-4" dir="rtl">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">ربط واتساب</h3>
          <p className="text-sm text-gray-500">
            اربط حساب WhatsApp Business لهذا المحل عبر Meta. يبقى الرقم ملكًا لصاحب المحل.
          </p>
        </div>

        {state === 'connected' ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">متصل</span>
        ) : (
          <button
            type="button"
            onClick={state === 'failed' ? retry : connect}
            disabled={state === 'connecting' || !config || !businessId}
            className="rounded-md bg-green-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {state === 'connecting' ? 'جارٍ الربط…' : state === 'failed' ? 'حاول مجددًا' : 'اربط واتساب'}
          </button>
        )}
      </div>

      {state === 'connecting' && status?.step && (
        <p className="mt-3 text-sm text-gray-600">{STEP_LABEL[status.step] || 'جارٍ العمل…'}</p>
      )}

      {error && (
        <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {status?.step && status.step !== 'code_received' && (
            <p className="mt-1 text-red-600">
              الحساب مربوط جزئيًا — «حاول مجددًا» يكمل من: {STEP_LABEL[status.step]}
            </p>
          )}
        </div>
      )}

      {/* The last step is the customer's own, and it is the one that silently blocks
          sending, so it sits in the open rather than in a footnote. */}
      {paymentNotice && (
        <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">{paymentNotice.short}</p>
          <p className="mt-1">{paymentNotice.long}</p>
          <a
            href={status?.next_action?.url || WHATSAPP_MANAGER_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-medium underline"
          >
            افتح WhatsApp Manager
          </a>
        </div>
      )}
    </div>
  );
}
