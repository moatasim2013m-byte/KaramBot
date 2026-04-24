import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CreditCard, Loader2, ShieldCheck } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useAuth } from '../context/AuthContext';

// -----------------------------------------------------------------------------
// CyberSource Unified Checkout (Microform v2) — embedded card form
// -----------------------------------------------------------------------------
// Flow:
//   1. POST /payments/capital-bank/unified-checkout/session -> captureContext JWT
//   2. Load the CyberSource Flex Microform JS SDK dynamically
//   3. Initialize Flex with the JWT, render card-number + CVV fields
//   4. On submit, call microform.createToken(...) -> transient token JWT
//   5. POST /payments/capital-bank/unified-checkout/authorize -> authorize + capture
//   6. Redirect to /payment/success?orderId=...
// -----------------------------------------------------------------------------

const FALLBACK_TEST_SDK_URL = 'https://testflex.cybersource.com/microform/bundle/v2.0/flex-microform.min.js';
const FALLBACK_PROD_SDK_URL = 'https://flex.cybersource.com/microform/bundle/v2.0/flex-microform.min.js';

const base64UrlDecode = (value) => {
  if (!value || typeof value !== 'string') return '';
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const withPad = padded + '='.repeat(padLen);
  try {
    if (typeof window !== 'undefined' && typeof window.atob === 'function') {
      return window.atob(withPad);
    }
    return '';
  } catch (_err) {
    return '';
  }
};

// Decode the CyberSource capture context JWT (JWS) middle segment and return
// the SDK URL (clientLibrary) referenced in its ctx[0].data payload. Falls
// back to the test URL on any error.
const resolveSdkUrlFromJwt = (jwt) => {
  try {
    const parts = String(jwt || '').split('.');
    if (parts.length < 2) return FALLBACK_TEST_SDK_URL;
    const payloadJson = base64UrlDecode(parts[1]);
    if (!payloadJson) return FALLBACK_TEST_SDK_URL;
    const payload = JSON.parse(payloadJson);

    const ctxArray = Array.isArray(payload?.ctx) ? payload.ctx : [];
    for (const entry of ctxArray) {
      const lib = entry?.data?.clientLibrary;
      if (typeof lib === 'string' && lib.startsWith('https://')) {
        return lib;
      }
    }

    const issuer = String(payload?.iss || payload?.iat_src || '').toLowerCase();
    if (issuer.includes('testflex') || issuer.includes('apitest')) {
      return FALLBACK_TEST_SDK_URL;
    }
    if (issuer.includes('flex.cybersource') || issuer.includes('api.cybersource')) {
      return FALLBACK_PROD_SDK_URL;
    }
  } catch (_err) {
    // fall through
  }
  return FALLBACK_TEST_SDK_URL;
};

const resolveSdkIntegrityFromJwt = (jwt) => {
  try {
    const parts = String(jwt || '').split('.');
    if (parts.length < 2) return '';
    const payload = JSON.parse(base64UrlDecode(parts[1]) || '{}');
    const ctxArray = Array.isArray(payload?.ctx) ? payload.ctx : [];
    for (const entry of ctxArray) {
      const integrity = entry?.data?.clientLibraryIntegrity;
      if (typeof integrity === 'string' && integrity.length > 0) {
        return integrity;
      }
    }
  } catch (_err) {
    // ignore
  }
  return '';
};

// Dynamically inject a <script> tag for the Unified Checkout SDK. Resolves when
// the global window.Flex is available.
const loadCyberSourceSdk = (sdkUrl, integrity) => new Promise((resolve, reject) => {
  if (typeof window === 'undefined') {
    reject(new Error('window_unavailable'));
    return;
  }
  if (typeof window.Flex === 'function') {
    resolve();
    return;
  }

  const existing = document.querySelector('script[data-cybs-microform="true"]');
  if (existing) {
    existing.addEventListener('load', () => resolve(), { once: true });
    existing.addEventListener('error', () => reject(new Error('sdk_load_error')), { once: true });
    return;
  }

  const script = document.createElement('script');
  script.src = sdkUrl;
  script.async = true;
  script.crossOrigin = 'anonymous';
  script.dataset.cybsMicroform = 'true';
  if (integrity) {
    script.integrity = integrity;
  }
  script.addEventListener('load', () => {
    if (typeof window.Flex === 'function') {
      resolve();
    } else {
      reject(new Error('sdk_globals_missing'));
    }
  }, { once: true });
  script.addEventListener('error', () => reject(new Error('sdk_load_error')), { once: true });
  document.head.appendChild(script);
});

const MICROFORM_FIELD_STYLES = {
  input: {
    'font-size': '16px',
    'font-family': 'inherit',
    'line-height': '1.25rem',
    color: '#0f172a'
  },
  ':focus': {
    color: '#0f172a'
  },
  '::placeholder': {
    color: '#94a3b8'
  },
  ':invalid': {
    color: '#dc2626'
  },
  valid: {
    color: '#0f172a'
  }
};

const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const buildYears = () => {
  const current = new Date().getFullYear();
  return Array.from({ length: 11 }, (_, i) => String(current + i));
};

export default function CapitalBankCheckoutPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { api, isAuthenticated, loading } = useAuth();
  const orderId = useMemo(() => sessionId || '', [sessionId]);

  const [sessionLoading, setSessionLoading] = useState(true);
  const [sdkLoading, setSdkLoading] = useState(false);
  const [sdkReady, setSdkReady] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [captureContext, setCaptureContext] = useState('');
  const [expiryMonth, setExpiryMonth] = useState(MONTHS[new Date().getMonth()]);
  const [expiryYear, setExpiryYear] = useState(String(new Date().getFullYear()));

  const microformRef = useRef(null);
  const fieldsRef = useRef({ number: null, securityCode: null });
  const isUnmountedRef = useRef(false);

  const years = useMemo(() => buildYears(), []);

  // ---------------------------------------------------------------------------
  // Redirect unauthenticated users to login
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  // ---------------------------------------------------------------------------
  // Track unmount to guard async state updates
  // ---------------------------------------------------------------------------
  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Effect 1 — fetch capture context from backend on mount
  // ---------------------------------------------------------------------------
  const fetchCaptureContext = useCallback(async () => {
    if (!orderId) {
      setErrorMessage('تعذر بدء عملية الدفع. الرجاء العودة والمحاولة مرة أخرى.');
      setSessionLoading(false);
      return;
    }

    setSessionLoading(true);
    setErrorMessage('');
    setSdkReady(false);
    setCaptureContext('');

    try {
      const response = await api.post(
        '/payments/capital-bank/unified-checkout/session',
        { orderId, originUrl: window.location.origin },
        {
          withCredentials: true,
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (isUnmountedRef.current) return;

      const data = response?.data || {};
      if (data?.success && typeof data?.captureContext === 'string' && data.captureContext.length > 0) {
        setCaptureContext(data.captureContext);
      } else {
        setErrorMessage('تعذر بدء عملية الدفع. الرجاء المحاولة مرة أخرى.');
      }
    } catch (error) {
      if (isUnmountedRef.current) return;
      const serverMsg = error?.response?.data?.error;
      setErrorMessage(serverMsg || 'حدث خطأ في الاتصال. الرجاء المحاولة مرة أخرى.');
    } finally {
      if (!isUnmountedRef.current) {
        setSessionLoading(false);
      }
    }
  }, [api, orderId]);

  useEffect(() => {
    if (loading || !isAuthenticated) return;
    fetchCaptureContext();
  }, [loading, isAuthenticated, fetchCaptureContext]);

  // ---------------------------------------------------------------------------
  // Effect 2 — load SDK and initialize the microform fields once we have a
  // capture context JWT.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!captureContext) return undefined;

    let cancelled = false;
    setSdkLoading(true);
    setSdkReady(false);

    const sdkUrl = resolveSdkUrlFromJwt(captureContext);
    const integrity = resolveSdkIntegrityFromJwt(captureContext);

    (async () => {
      try {
        await loadCyberSourceSdk(sdkUrl, integrity);
        if (cancelled || isUnmountedRef.current) return;

        if (typeof window.Flex !== 'function') {
          throw new Error('sdk_globals_missing');
        }

        const flex = new window.Flex(captureContext);
        const microform = flex.microform({ styles: MICROFORM_FIELD_STYLES });

        const cardNumberField = microform.createField('number', {
          placeholder: 'رقم البطاقة'
        });
        const securityCodeField = microform.createField('securityCode', {
          placeholder: 'CVV'
        });

        cardNumberField.load('#card-number-container');
        securityCodeField.load('#security-code-container');

        microformRef.current = microform;
        fieldsRef.current = { number: cardNumberField, securityCode: securityCodeField };

        if (!cancelled && !isUnmountedRef.current) {
          setSdkReady(true);
        }
      } catch (err) {
        if (cancelled || isUnmountedRef.current) return;
        // Surface a user-friendly Arabic message but keep the technical detail
        // in console for ops/debugging.
        // eslint-disable-next-line no-console
        console.error('[Unified Checkout] SDK init failed', err);
        setErrorMessage('تعذر تحميل نموذج الدفع. الرجاء المحاولة مرة أخرى.');
      } finally {
        if (!cancelled && !isUnmountedRef.current) {
          setSdkLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (fieldsRef.current?.number && typeof fieldsRef.current.number.unload === 'function') {
          fieldsRef.current.number.unload();
        }
        if (fieldsRef.current?.securityCode && typeof fieldsRef.current.securityCode.unload === 'function') {
          fieldsRef.current.securityCode.unload();
        }
      } catch (_cleanupErr) {
        // ignore
      }
      fieldsRef.current = { number: null, securityCode: null };
      microformRef.current = null;
    };
  }, [captureContext]);

  // ---------------------------------------------------------------------------
  // Payment submission
  // ---------------------------------------------------------------------------
  const handlePayment = useCallback(() => {
    if (!microformRef.current || !sdkReady || processing) return;

    setErrorMessage('');
    setProcessing(true);

    const options = {
      expirationMonth: String(expiryMonth).padStart(2, '0'),
      expirationYear: String(expiryYear)
    };

    microformRef.current.createToken(options, async (err, token) => {
      if (isUnmountedRef.current) return;

      if (err) {
        // SDK validation errors typically include `message` and `details`
        const fieldDetails = Array.isArray(err?.details) && err.details.length > 0
          ? err.details.map((d) => d?.message).filter(Boolean).join(' — ')
          : '';
        const userMessage = fieldDetails
          || err?.message
          || 'تعذر التحقق من بيانات البطاقة. الرجاء التأكد والمحاولة مرة أخرى.';
        setErrorMessage(userMessage);
        setProcessing(false);
        return;
      }

      try {
        const response = await api.post(
          '/payments/capital-bank/unified-checkout/authorize',
          { orderId, transientToken: token },
          {
            withCredentials: true,
            headers: { 'Content-Type': 'application/json' }
          }
        );

        if (isUnmountedRef.current) return;

        const data = response?.data || {};
        if (data?.success && data?.status === 'paid') {
          setSubmittedOk(true);
          // Brief delay so the "جاري تأكيد الدفع..." message is visible.
          window.setTimeout(() => {
            if (!isUnmountedRef.current) {
              navigate(`/payment/success?orderId=${encodeURIComponent(orderId)}`, { replace: true });
            }
          }, 400);
          return;
        }

        const providerReason = data?.provider?.reasonCode;
        const detail = providerReason ? ` (${providerReason})` : '';
        setErrorMessage(`فشل الدفع — الرجاء المحاولة مرة أخرى.${detail}`);
        setProcessing(false);
      } catch (authorizeError) {
        if (isUnmountedRef.current) return;
        const resp = authorizeError?.response?.data || {};
        const provider = resp?.provider || {};
        const providerMsg = provider?.message;
        const reason = provider?.reasonCode;
        const pStatus = provider?.status;
        const httpStatus = provider?.httpStatus;
        const serverMsg = resp?.error;
        const detailParts = [];
        if (pStatus) detailParts.push(pStatus);
        if (reason) detailParts.push(reason);
        if (httpStatus && httpStatus !== 402) detailParts.push(`HTTP ${httpStatus}`);
        const detail = detailParts.length > 0 ? ` (${detailParts.join(' · ')})` : '';
        const base = providerMsg || serverMsg || 'فشل الدفع — الرجاء المحاولة مرة أخرى.';
        setErrorMessage(`${base}${detail}`);
        setProcessing(false);
      }
    });
  }, [api, expiryMonth, expiryYear, navigate, orderId, processing, sdkReady]);

  const handleCancel = useCallback(() => {
    if (processing) return;
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate('/tickets', { replace: true });
  }, [navigate, processing]);

  const handleRetry = useCallback(() => {
    setErrorMessage('');
    setSubmittedOk(false);
    setProcessing(false);
    fetchCaptureContext();
  }, [fetchCaptureContext]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  if (loading || !isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  const showInitialLoader = sessionLoading || (sdkLoading && !errorMessage);
  const hasBlockingError = Boolean(errorMessage) && !sdkReady && !processing;

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-hero-gradient py-12 px-4" dir="rtl">
      <style>{`
        .flex-microform-container {
          border: 1px solid #e2e8f0;
          border-radius: 0.5rem;
          padding: 0.75rem;
          min-height: 2.75rem;
          background: #ffffff;
          transition: border-color 0.2s ease;
          display: flex;
          align-items: center;
        }
        .flex-microform-container iframe {
          display: block;
          width: 100%;
          height: 1.5rem;
          border: 0;
        }
        .flex-microform-container:focus-within {
          border-color: #db2777;
          box-shadow: 0 0 0 3px rgba(219, 39, 119, 0.15);
        }
      `}</style>

      <Card className="w-full max-w-xl border-2 rounded-3xl shadow-xl">
        <CardHeader className="text-right">
          <CardTitle className="text-2xl flex items-center justify-end gap-2">
            <span>الدفع بالبطاقة</span>
            <CreditCard className="w-6 h-6 text-pink-600" />
          </CardTitle>
          <CardDescription className="flex items-center justify-end gap-1 text-slate-600">
            <ShieldCheck className="w-4 h-4 text-emerald-600" />
            <span>الدفع مؤمَّن عبر بوابة البنك (CyberSource)</span>
          </CardDescription>
        </CardHeader>

        <CardContent>
          {showInitialLoader && (
            <div className="space-y-4 py-6 text-center">
              <div className="flex items-center justify-center gap-2 text-pink-700">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-medium">
                  {sessionLoading ? 'جاري تجهيز صفحة الدفع...' : 'جاري تحميل نموذج الدفع...'}
                </span>
              </div>
              <p className="text-right text-sm text-slate-600">
                لن يتم حفظ بيانات البطاقة على خوادمنا — يتم إدخالها مباشرة في بوابة الدفع الآمنة.
              </p>
            </div>
          )}

          {hasBlockingError && (
            <div className="space-y-4 py-4">
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-right text-sm flex-1">{errorMessage}</p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleRetry}
                  className="flex-1 rounded-xl p-3 bg-pink-600 text-white font-semibold hover:bg-pink-700 transition"
                >
                  إعادة المحاولة
                </button>
                <button
                  type="button"
                  onClick={handleCancel}
                  className="flex-1 rounded-xl p-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 transition"
                >
                  العودة
                </button>
              </div>
            </div>
          )}

          {submittedOk && (
            <div className="py-8 text-center space-y-3">
              <div className="flex items-center justify-center gap-2 text-emerald-700">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-semibold">جاري تأكيد الدفع...</span>
              </div>
              <p className="text-sm text-slate-600">سيتم تحويلك إلى صفحة التأكيد خلال لحظات.</p>
            </div>
          )}

          {/* Payment form — always mounted once session is loaded so the SDK
              containers exist in the DOM before Flex tries to attach fields. */}
          <div
            className={`space-y-4 ${(showInitialLoader || hasBlockingError || submittedOk) ? 'hidden' : ''}`}
            aria-hidden={showInitialLoader || hasBlockingError || submittedOk}
          >
            <div className="space-y-1.5">
              <label htmlFor="card-number-container" className="block text-right text-sm font-semibold text-slate-700">
                رقم البطاقة
              </label>
              <div id="card-number-container" className="flex-microform-container" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="expiry-month" className="block text-right text-sm font-semibold text-slate-700">
                  شهر الانتهاء
                </label>
                <select
                  id="expiry-month"
                  value={expiryMonth}
                  onChange={(e) => setExpiryMonth(e.target.value)}
                  disabled={processing}
                  className="w-full rounded-lg border border-slate-200 p-2.5 bg-white text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:bg-slate-50"
                >
                  {MONTHS.map((month) => (
                    <option key={month} value={month}>{month}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label htmlFor="expiry-year" className="block text-right text-sm font-semibold text-slate-700">
                  سنة الانتهاء
                </label>
                <select
                  id="expiry-year"
                  value={expiryYear}
                  onChange={(e) => setExpiryYear(e.target.value)}
                  disabled={processing}
                  className="w-full rounded-lg border border-slate-200 p-2.5 bg-white text-slate-900 text-right focus:outline-none focus:ring-2 focus:ring-pink-500 focus:border-pink-500 disabled:bg-slate-50"
                >
                  {years.map((year) => (
                    <option key={year} value={year}>{year}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="security-code-container" className="block text-right text-sm font-semibold text-slate-700">
                رمز الأمان (CVV)
              </label>
              <div id="security-code-container" className="flex-microform-container" />
            </div>

            {errorMessage && !hasBlockingError && (
              <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-red-700">
                <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
                <p className="text-right text-sm flex-1">{errorMessage}</p>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={handlePayment}
                disabled={!sdkReady || processing}
                className="flex-1 rounded-xl p-3 bg-pink-600 text-white font-semibold hover:bg-pink-700 disabled:opacity-60 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
              >
                {processing ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>جاري المعالجة...</span>
                  </>
                ) : (
                  <span>ادفع الآن</span>
                )}
              </button>
              <button
                type="button"
                onClick={handleCancel}
                disabled={processing}
                className="flex-1 rounded-xl p-3 bg-slate-100 text-slate-700 font-semibold hover:bg-slate-200 disabled:opacity-60 disabled:cursor-not-allowed transition"
              >
                إلغاء
              </button>
            </div>

            <p className="text-right text-xs text-slate-500 pt-2">
              بالضغط على &quot;ادفع الآن&quot;، ستتم معالجة الدفع مباشرة عبر بوابة CyberSource الآمنة. لن تترك صفحة Peekaboo.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
