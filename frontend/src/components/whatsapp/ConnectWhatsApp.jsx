import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../../utils/api';
import { loadFacebookSdk, launchEmbeddedSignup, isFacebookOrigin } from '../../utils/facebookSdk';

/**
 * "Connect WhatsApp" — Embedded Signup v4.
 *
 * The browser's whole job is to collect the signup result and the 30-second code and
 * hand both to the backend. No Graph call and no token ever happens here.
 *
 * Admin-only while the flow is being proven (the backend enforces it too).
 */

const STEP_LABEL = {
  code_received: 'Starting…',
  token_exchanged: 'Authorised — subscribing to your account',
  subscribed: 'Subscribed — registering your number',
  registered: 'Number registered',
  done: 'Connected',
};

export default function ConnectWhatsApp({ businessId }) {
  const [state, setState] = useState('idle'); // idle | connecting | connected | failed
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [config, setConfig] = useState(null);

  // The FINISH payload arrives on the message event, the code on the FB.login callback,
  // and the backend needs both. Whichever lands first waits here.
  const signupData = useRef(null);

  useEffect(() => {
    api.get('/whatsapp/embedded-signup/config')
      .then((res) => setConfig(res.data))
      .catch(() => setError('Could not load the WhatsApp settings.'));
  }, []);

  useEffect(() => {
    if (!businessId) return undefined;
    api.get('/whatsapp/embedded-signup/status', { params: { business_id: businessId } })
      .then((res) => {
        if (res.data.onboarding) {
          setStatus(res.data.onboarding);
          if (res.data.onboarding.connected) setState('connected');
        }
      })
      .catch(() => {});
    return undefined;
  }, [businessId]);

  // Meta's events for the flow. Registered once, and only trusted from facebook.com.
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
        || (data.current_step ? `Cancelled at ${data.current_step}` : 'Signup cancelled');
      setError(message);
      setState('failed');
      api.post('/whatsapp/embedded-signup/events', {
        event: data.error_message ? 'ERROR' : 'CANCEL',
        current_step: data.current_step,
        error_message: data.error_message,
        session_id: data.session_id,
        phone_number_id: signupData.current?.phone_number_id,
      }).catch(() => {});
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  const connect = useCallback(async () => {
    if (!config) return;
    setError(null);
    setState('connecting');
    signupData.current = null;

    try {
      const FB = await loadFacebookSdk({ appId: config.app_id, graphVersion: config.graph_version });
      const code = await launchEmbeddedSignup(FB, { configId: config.config_id });

      // FINISH normally lands before the callback; if it has not, the code is still the
      // thing that expires, so it goes up with whatever we have.
      const res = await api.post('/whatsapp/embedded-signup/exchange', {
        code,
        business_id: businessId,
        ...(signupData.current || {}),
      });
      setStatus(res.data.onboarding);
      setState('connected');
    } catch (err) {
      const body = err.response?.data;
      setStatus(body?.onboarding || null);
      setError(body?.message || err.message || 'Connection failed.');
      setState('failed');
    }
  }, [config, businessId]);

  const retry = useCallback(async () => {
    // A signup that got past the token step resumes server-side; anything earlier
    // needs a fresh run, because the code is long gone.
    if (!status?.id || status.step === 'code_received') return connect();
    setError(null);
    setState('connecting');
    try {
      const res = await api.post(`/whatsapp/embedded-signup/${status.id}/retry`);
      setStatus(res.data.onboarding);
      setState('connected');
    } catch (err) {
      setError(err.response?.data?.message || 'Retry failed.');
      setState('failed');
    }
    return undefined;
  }, [status, connect]);

  return (
    <div className="rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold">WhatsApp Business</h3>
          <p className="text-sm text-gray-500">
            Connect your own WhatsApp Business account. You stay the owner of the number.
          </p>
        </div>

        {state === 'connected' ? (
          <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">Connected</span>
        ) : (
          <button
            type="button"
            onClick={state === 'failed' ? retry : connect}
            disabled={state === 'connecting' || !config}
            className="rounded-md bg-green-600 px-4 py-2 text-white disabled:opacity-50"
          >
            {state === 'connecting' ? 'Connecting…' : state === 'failed' ? 'Try again' : 'Connect WhatsApp'}
          </button>
        )}
      </div>

      {state === 'connecting' && status?.step && (
        <p className="mt-3 text-sm text-gray-600">{STEP_LABEL[status.step] || 'Working…'}</p>
      )}

      {error && (
        <div className="mt-3 rounded bg-red-50 p-3 text-sm text-red-700">
          <p>{error}</p>
          {status?.step && status.step !== 'code_received' && (
            <p className="mt-1 text-red-600">
              Your account is already linked — “Try again” picks up from {STEP_LABEL[status.step]}.
            </p>
          )}
        </div>
      )}

      {/* The last step is the customer's own, and it is the one that silently blocks
          sending, so it sits in the open rather than in a footnote. */}
      {status?.next_action?.code === 'add_payment_method' && (
        <div className="mt-3 rounded bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Add a payment method before 30 September</p>
          <p className="mt-1">{status.next_action.en}</p>
          <a
            href={status.next_action.url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block font-medium underline"
          >
            Open WhatsApp Manager
          </a>
        </div>
      )}
    </div>
  );
}
