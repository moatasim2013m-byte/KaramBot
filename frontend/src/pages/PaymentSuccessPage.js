import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { useAuth } from '../context/AuthContext';

const MAX_AUTO_ATTEMPTS = 6;
const RETRY_DELAY_MS = 1200;
const STORAGE_KEY = 'pk_last_confirmation';

const STATUS = {
  LOADING: 'loading',
  PROCESSING: 'processing',
  SUCCESS: 'success',
  FAILURE: 'failure',
  RETRY_READY: 'retry_ready'
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const pickFirst = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const buildConfirmationData = (result) => {
  const bookingType = result.resourceType || 'hourly';
  const firstHourlyBooking = result.bookings?.[0];
  const booking = result.booking || firstHourlyBooking || result.subscription || {};
  const bookingId = pickFirst(booking.id, booking._id, result.subscription?.id, result.subscription?._id);
  const bookingCode = pickFirst(
    result.booking?.booking_code,
    result.booking?.bookingCode,
    firstHourlyBooking?.booking_code,
    firstHourlyBooking?.bookingCode,
    result.subscription?.booking_code,
    result.subscription?.bookingCode,
    bookingId ? `PK-${String(bookingId).slice(-6).toUpperCase()}` : ''
  );

  return {
    bookingId,
    bookingCode,
    bookingType,
    paymentMethod: 'card',
    amount: pickFirst(
      firstHourlyBooking?.amount,
      result.booking?.amount,
      result.subscription?.amount,
      firstHourlyBooking?.final_amount,
      result.booking?.final_amount,
      result.subscription?.final_amount
    )
  };
};

const persistConfirmation = (confirmationData) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(confirmationData));
  } catch (_error) {
    // Safari private mode / blocked storage should not break finalization flow.
  }
};

const toNumberOrUndefined = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const trackSnapSubscribe = ({ result, user, orderId }) => {
  if (typeof window === 'undefined' || typeof window.snaptr !== 'function') return;
  if (result?.resourceType !== 'subscription') return;

  const amount = toNumberOrUndefined(
    pickFirst(
      result?.subscription?.amount,
      result?.subscription?.final_amount,
      result?.subscription?.plan_price,
      result?.subscription?.plan?.price
    )
  );

  const numberItems = toNumberOrUndefined(
    pickFirst(
      result?.subscription?.remaining_visits,
      result?.subscription?.visits,
      result?.subscription?.plan?.visits,
      1
    )
  );

  window.snaptr('track', 'SUBSCRIBE', {
    price: amount,
    currency: 'JOD',
    transaction_id: orderId,
    number_items: numberItems,
    uuid_c1: pickFirst(user?.id, user?._id),
    user_email: user?.email,
    user_phone_number: user?.phone
  });
};

export default function PaymentSuccessPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { api, user, isAuthenticated, loading: authLoading } = useAuth();
  const orderId = useMemo(() => searchParams.get('orderId') || searchParams.get('session_id') || '', [searchParams]);

  const [status, setStatus] = useState(STATUS.LOADING);
  const [errorMessage, setErrorMessage] = useState('');
  const [attemptCount, setAttemptCount] = useState(0);
  const isMountedRef = useRef(true);

  const navigateToConfirmation = useCallback((result) => {
    const confirmationData = buildConfirmationData(result);
    persistConfirmation(confirmationData);
    setStatus(STATUS.SUCCESS);
    navigate('/booking-confirmation', { replace: true, state: confirmationData });
  }, [navigate]);

  const attemptFinalize = useCallback(async ({ manual = false } = {}) => {
    if (!orderId) {
      setStatus(STATUS.FAILURE);
      setErrorMessage('لا يمكن إكمال التأكيد لأن رقم العملية غير متوفر.');
      return;
    }

    setErrorMessage('');
    setStatus(STATUS.PROCESSING);

    const totalAttempts = manual ? 1 : MAX_AUTO_ATTEMPTS;

    for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
      if (!isMountedRef.current) return;
      setAttemptCount((prev) => prev + 1);

      try {
        const response = await api.post(`/payments/finalize/${encodeURIComponent(orderId)}`);
        if (!isMountedRef.current) return;
        const result = response.data || {};
        trackSnapSubscribe({ result, user, orderId });
        navigateToConfirmation(result);
        return;
      } catch (error) {
        if (!isMountedRef.current) return;

        const responseStatus = error?.response?.status;
        const backendMessage = error?.response?.data?.error;

        if (responseStatus === 202 || responseStatus === 409) {
          if (attempt < totalAttempts - 1) {
            await sleep(RETRY_DELAY_MS);
            continue;
          }

          setStatus(STATUS.RETRY_READY);
          setErrorMessage('ما زلنا نؤكد الدفع من البنك. يمكنك إعادة المحاولة خلال لحظات.');
          return;
        }

        setStatus(STATUS.FAILURE);
        setErrorMessage(backendMessage || 'تعذر تأكيد الحجز بعد الدفع. الرجاء المحاولة مرة أخرى أو التواصل معنا مع رقم الطلب.');
        return;
      }
    }
  }, [api, navigateToConfirmation, orderId, user]);

  useEffect(() => {
    isMountedRef.current = true;

    if (authLoading) {
      setStatus(STATUS.LOADING);
      return () => {
        isMountedRef.current = false;
      };
    }

    if (!isAuthenticated) {
      navigate('/login', { replace: true });
      return () => {
        isMountedRef.current = false;
      };
    }

    attemptFinalize();

    return () => {
      isMountedRef.current = false;
    };
  }, [attemptFinalize, authLoading, isAuthenticated, navigate]);

  const handleRetry = async () => {
    toast.info('جاري إعادة التحقق من حالة الدفع...');
    await attemptFinalize({ manual: true });
  };

  const isBusy = status === STATUS.LOADING || status === STATUS.PROCESSING;
  const isErrorState = status === STATUS.FAILURE || status === STATUS.RETRY_READY;

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-hero-gradient py-12 px-4" dir="rtl">
      <Card className="w-full max-w-xl border-2 rounded-3xl shadow-xl">
        <CardContent className="py-12 text-center space-y-5">
          <div className={`w-20 h-20 rounded-full flex items-center justify-center mx-auto ${isErrorState ? 'bg-red-100' : 'bg-green-100'}`}>
            {isBusy && <Loader2 className="h-12 w-12 text-green-600 animate-spin" />}
            {status === STATUS.SUCCESS && <CheckCircle2 className="h-12 w-12 text-green-600" />}
            {isErrorState && <AlertCircle className="h-12 w-12 text-red-600" />}
          </div>

          <div className="space-y-1">
            <h1 className={`font-heading text-3xl font-bold ${isErrorState ? 'text-red-700' : 'text-green-700'}`}>
              {isErrorState ? 'تعذر إنهاء التأكيد تلقائياً' : 'تم استلام عملية الدفع'}
            </h1>
            <p className={`text-base ${isErrorState ? 'text-red-700' : 'text-green-700'}`}>
              {status === STATUS.LOADING && 'جاري تجهيز التحقق من حالة العملية...'}
              {status === STATUS.PROCESSING && 'جاري تأكيد الحجز مع الخادم...'}
              {status === STATUS.RETRY_READY && 'الدفع ناجح، وما زال الحجز قيد الإنهاء. أعد المحاولة بعد ثوانٍ.'}
              {status === STATUS.FAILURE && 'حدث خطأ أثناء المطابقة النهائية مع الخادم.'}
            </p>
          </div>

          <div className="bg-white/80 border border-green-200 rounded-xl py-3 px-4">
            <p className="text-sm text-muted-foreground">رقم الطلب</p>
            <p className="font-semibold text-base break-all">{orderId || '—'}</p>
            <p className="text-xs text-muted-foreground mt-2">عدد محاولات التحقق: {attemptCount}</p>
          </div>

          {errorMessage ? <p className="text-red-600 text-sm">{errorMessage}</p> : <p className="text-sm text-muted-foreground">يرجى إبقاء الصفحة مفتوحة حتى يكتمل التأكيد النهائي.</p>}

          {isErrorState && (
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Button onClick={handleRetry} className="rounded-full btn-playful" disabled={isBusy}>
                <RefreshCw className="h-4 w-4 ml-2" />
                إعادة المحاولة
              </Button>
              <Button type="button" variant="outline" onClick={() => navigate('/book')} className="rounded-full">
                الرجوع للحجوزات
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
