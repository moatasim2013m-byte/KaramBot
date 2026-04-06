import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { useAuth } from '../context/AuthContext';

export default function CapitalBankCheckoutPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const { api, isAuthenticated, loading } = useAuth();
  const orderId = useMemo(() => sessionId || '', [sessionId]);

  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      navigate('/login', { replace: true });
    }
  }, [isAuthenticated, loading, navigate]);

  useEffect(() => {
    if (loading || !isAuthenticated) {
      return;
    }

    let isUnmounted = false;

    const initiatePayment = async () => {
      if (!orderId) {
        setErrorMessage('تعذر بدء عملية الدفع. الرجاء العودة والمحاولة مرة أخرى.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setErrorMessage('');

      const payload = {
        orderId,
        originUrl: window.location.origin
      };

      try {
        const response = await api.post('/payments/capital-bank/initiate', payload, {
          withCredentials: true,
          headers: {
            'Content-Type': 'application/json'
          }
        });

        if (isUnmounted) return;

        const result = response?.data || {};
        const secureAcceptance = result?.secureAcceptance;
        const secureAcceptanceFields = secureAcceptance?.fields || {};
        const hasRequiredSecureAcceptanceFields = (
          Boolean(secureAcceptanceFields.signature)
          && Boolean(secureAcceptanceFields.signed_field_names)
          && Boolean(secureAcceptanceFields.reference_number)
        );

        if (result?.success && secureAcceptance?.url && hasRequiredSecureAcceptanceFields) {
          const form = document.createElement('form');
          form.method = 'POST';
          form.action = secureAcceptance.url;

          Object.entries(secureAcceptanceFields).forEach(([name, value]) => {
            const input = document.createElement('input');
            input.type = 'hidden';
            input.name = name;
            input.value = `${value ?? ''}`;
            form.appendChild(input);
          });

          document.body.appendChild(form);
          form.submit();
          return;
        }

        setErrorMessage('تعذر التحويل إلى صفحة الدفع حالياً. الرجاء المحاولة مرة أخرى.');
      } catch (error) {
        if (isUnmounted) return;
        setErrorMessage('حدث خطأ أثناء بدء الدفع بالبطاقة. الرجاء العودة والمحاولة لاحقاً.');
      } finally {
        if (!isUnmounted) {
          setIsLoading(false);
        }
      }
    };

    initiatePayment();

    return () => {
      isUnmounted = true;
    };
  }, [api, isAuthenticated, loading, navigate, orderId]);

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }

    navigate('/tickets', { replace: true });
  };

  if (loading || !isAuthenticated) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-hero-gradient py-12 px-4" dir="rtl">
      <Card className="w-full max-w-xl border-2 rounded-3xl shadow-xl">
        <CardHeader className="text-right">
          <CardTitle className="text-2xl">الدفع عبر البطاقة</CardTitle>
          <CardDescription>سيتم تحويلك إلى صفحة الدفع الآمنة التابعة للبنك لإتمام العملية.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-4 py-4 text-center">
              <div className="flex items-center justify-center gap-2 text-pink-700">
                <Loader2 className="w-5 h-5 animate-spin" />
                <span className="font-medium">جاري تحويلك إلى صفحة الدفع الآمن...</span>
              </div>
              <p className="text-right text-sm text-slate-600">
                للحماية القصوى، لن يتم إدخال بيانات البطاقة داخل منصة Peekaboo، وسيتم إكمال الدفع مباشرة عبر بوابة البنك (Secure Acceptance).
              </p>
            </div>
          ) : (
            <div className="space-y-4 py-4">
              <p className="text-right text-sm text-red-600">
                {errorMessage || 'تعذر بدء عملية الدفع بالبطاقة حالياً.'}
              </p>
              <button
                type="button"
                onClick={handleBack}
                className="w-full rounded-xl p-3 bg-pink-600 text-white font-semibold"
              >
                العودة
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
