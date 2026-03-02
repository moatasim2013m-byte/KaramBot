import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { toast } from 'sonner';
import { CheckCircle, Home, User, Copy, Phone, MessageCircle, Building2, Clock, Calendar, Banknote, Baby, Tag } from 'lucide-react';

const STORAGE_KEY = 'pk_last_confirmation';

const hashValue = async (value) => {
  if (!value || !window.crypto?.subtle || !window.TextEncoder) {
    return null;
  }

  try {
    const normalizedValue = value.trim().toLowerCase();
    const encoded = new TextEncoder().encode(normalizedValue);
    const digestBuffer = await window.crypto.subtle.digest('SHA-256', encoded);
    return Array.from(new Uint8Array(digestBuffer))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  } catch (error) {
    console.error('Failed to hash value for Snap tracking:', error);
    return null;
  }
};

export default function BookingConfirmationPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState(null);
  const [copied, setCopied] = useState(false);

  useLayoutEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    requestAnimationFrame(() => window.scrollTo(0, 0));
  }, []);

  useEffect(() => {
    // Try to get confirmation from router state first
    let data = location.state;
    
    // If no router state, try localStorage
    if (!data) {
      try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
          data = JSON.parse(stored);
        }
      } catch (e) {
        console.error('Failed to read stored confirmation:', e);
      }
    } else {
      // Store in localStorage for refresh persistence
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      } catch (e) {
        console.error('Failed to persist confirmation:', e);
      }
    }
    
    setConfirmation(data);
  }, [location.state]);

  useEffect(() => {
    const trackLevelComplete = async () => {
      if (!confirmation || typeof window.snaptr !== 'function') {
        return;
      }

      const fallbackTrackingKey = `PK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
      const trackingKey = confirmation.bookingId || confirmation.bookingCode || fallbackTrackingKey;
      const sessionKey = `pk_snap_level_complete_${trackingKey}`;

      if (sessionStorage.getItem(sessionKey)) {
        return;
      }

      const email = confirmation.parentEmail || confirmation.email || confirmation.userEmail;
      const phoneNumber = confirmation.parentPhone || confirmation.phone || confirmation.userPhoneNumber;

      const [hashedEmail, hashedPhoneNumber] = await Promise.all([
        confirmation.userHashedEmail ? Promise.resolve(confirmation.userHashedEmail) : hashValue(email),
        confirmation.userHashedPhoneNumber ? Promise.resolve(confirmation.userHashedPhoneNumber) : hashValue(phoneNumber)
      ]);

      const eventPayload = {
        level: confirmation.bookingType || 'booking_confirmation',
        uuid_c1: trackingKey,
        user_email: email,
        user_phone_number: phoneNumber,
        user_hashed_email: hashedEmail,
        user_hashed_phone_number: hashedPhoneNumber
      };

      Object.keys(eventPayload).forEach((key) => {
        if (!eventPayload[key]) {
          delete eventPayload[key];
        }
      });

      window.snaptr('track', 'LEVEL_COMPLETE', eventPayload);
      sessionStorage.setItem(sessionKey, '1');
    };

    trackLevelComplete();
  }, [confirmation]);

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast.success('تم النسخ!');
    setTimeout(() => setCopied(false), 2000);
  };

  const getBookingTypeLabel = (type) => {
    switch (type) {
      case 'hourly': return 'جلسة بالساعة';
      case 'birthday': return 'حفلة عيد ميلاد';
      case 'subscription': return 'اشتراك';
      default: return 'حجز';
    }
  };

  const getPaymentMethodLabel = (method) => {
    switch (method) {
      case 'cash': return 'نقداً';
      case 'cliq': return 'CliQ تحويل بنكي';
      default: return method;
    }
  };

  const getReferenceCode = () => {
    if (confirmation?.bookingCode) {
      return confirmation.bookingCode;
    }
    if (confirmation?.bookingId) {
      return `PK-${confirmation.bookingId.slice(-6).toUpperCase()}`;
    }
    return `PK-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
  };

  // No confirmation data
  if (!confirmation) {
    return (
      <div className="min-h-screen bg-hero-gradient py-12" dir="rtl">
        <div className="max-w-md mx-auto px-4">
          <Card className="rounded-3xl shadow-xl border-0 overflow-hidden">
            <CardContent className="p-8 text-center">
              <div className="text-6xl mb-4">🤷</div>
              <h2 className="font-heading text-xl font-bold text-gray-700 mb-4">
                لا توجد تفاصيل حجز للعرض حالياً
              </h2>
              <Button 
                onClick={() => navigate('/')}
                className="w-full rounded-full btn-playful"
              >
                <Home className="h-5 w-5 ml-2" />
                العودة للرئيسية
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  const isCash = confirmation.paymentMethod === 'cash';
  const isCliq = confirmation.paymentMethod === 'cliq';

  return (
    <div className="min-h-screen bg-hero-gradient py-8 md:py-12" dir="rtl">
      <div className="max-w-lg mx-auto px-4">
        {/* Success Header */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-green-100 mb-4">
            <CheckCircle className="h-12 w-12 text-green-500" />
          </div>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-2">
            تم تأكيد الحجز ✅
          </h1>
          <p className="text-lg text-muted-foreground">
            {isCash && 'الدفع عند الاستقبال'}
            {isCliq && 'الدفع عبر CliQ (تحويل بنكي)'}
          </p>
        </div>

        {/* Booking Summary Card */}
        <Card className="rounded-3xl shadow-xl border-0 overflow-hidden mb-6">
          <CardContent className="p-6">
            {/* Reference Code */}
            <div className="bg-gradient-to-r from-[var(--pk-blue)] to-[var(--pk-green)] text-white rounded-2xl p-4 mb-6 text-center">
              <p className="text-sm opacity-90 mb-1">رقم الحجز المرجعي</p>
              <p className="font-heading text-2xl font-bold tracking-wider">{getReferenceCode()}</p>
            </div>

            {/* Booking Details */}
            <div className="space-y-4">
              {confirmation.bookingType && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Tag className="h-5 w-5" />
                    <span>نوع الحجز</span>
                  </div>
                  <span className="font-bold text-foreground">{getBookingTypeLabel(confirmation.bookingType)}</span>
                </div>
              )}

              {confirmation.childName && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Baby className="h-5 w-5" />
                    <span>اسم الطفل</span>
                  </div>
                  <span className="font-bold text-foreground">{confirmation.childName}</span>
                </div>
              )}

              {confirmation.date && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Calendar className="h-5 w-5" />
                    <span>التاريخ</span>
                  </div>
                  <span className="font-bold text-foreground">{confirmation.date}</span>
                </div>
              )}

              {confirmation.time && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Clock className="h-5 w-5" />
                    <span>الوقت</span>
                  </div>
                  <span className="font-bold text-foreground">{confirmation.time}</span>
                </div>
              )}

              {confirmation.duration && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Clock className="h-5 w-5" />
                    <span>المدة</span>
                  </div>
                  <span className="font-bold text-foreground">{confirmation.duration} ساعة</span>
                </div>
              )}

              {confirmation.amount && (
                <div className="flex items-center justify-between py-2 border-b border-gray-100">
                  <div className="flex items-center gap-2 text-gray-600">
                    <Banknote className="h-5 w-5" />
                    <span>المبلغ</span>
                  </div>
                  <span className="font-bold text-lg text-[var(--pk-red)]">{confirmation.amount} دينار</span>
                </div>
              )}

              <div className="flex items-center justify-between py-2 border-b border-gray-100">
                <div className="flex items-center gap-2 text-gray-600">
                  <Banknote className="h-5 w-5" />
                  <span>طريقة الدفع</span>
                </div>
                <span className="font-bold text-foreground">{getPaymentMethodLabel(confirmation.paymentMethod)}</span>
              </div>

              {/* Payment Status */}
              <div className="flex items-center justify-between py-2">
                <span className="text-gray-600">حالة الدفع</span>
                <span className={`px-3 py-1 rounded-full text-sm font-bold ${
                  isCash ? 'bg-yellow-100 text-yellow-700' : 'bg-purple-100 text-purple-700'
                }`}>
                  {isCash && 'بانتظار الدفع عند الاستقبال'}
                  {isCliq && 'بانتظار التحويل'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CliQ Transfer Details */}
        {isCliq && (
          <Card className="rounded-3xl shadow-xl border-2 border-purple-200 bg-purple-50 overflow-hidden mb-6">
            <CardContent className="p-6">
              <h3 className="font-heading text-xl font-bold text-purple-800 mb-4 flex items-center gap-2">
                <Building2 className="h-6 w-6" />
                تفاصيل التحويل CliQ
              </h3>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between bg-white rounded-xl p-3">
                  <span className="text-purple-700">الاسم:</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-purple-900">Peekaboo1</span>
                    <button 
                      onClick={() => copyToClipboard('Peekaboo1')}
                      className="p-1.5 hover:bg-purple-100 rounded-lg transition-colors"
                      title="نسخ"
                    >
                      <Copy className={`h-4 w-4 ${copied ? 'text-green-500' : 'text-purple-600'}`} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3">
                  <span className="text-purple-700">البنك:</span>
                  <span className="font-bold text-purple-900">بنك الإسكان</span>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3">
                  <span className="text-purple-700">المبلغ:</span>
                  <span className="font-bold text-lg text-purple-900">{confirmation.amount} دينار</span>
                </div>
              </div>

              {/* Important Note */}
              <div className="bg-yellow-50 border border-yellow-300 rounded-xl p-3 mb-4 text-center">
                <p className="text-sm text-yellow-800 font-medium">
                  ⚠️ بعد التحويل، أرسل صورة الإيصال على واتساب لتأكيد الحجز
                </p>
              </div>

              {/* Contact Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <a 
                  href={`https://wa.me/962777775652?text=مرحباً، أريد تأكيد حجزي رقم: ${getReferenceCode()}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button className="w-full rounded-full bg-green-500 hover:bg-green-600 text-white gap-2">
                    <MessageCircle className="h-5 w-5" />
                    واتساب
                  </Button>
                </a>
                <a href="tel:0777775652" className="flex-1">
                  <Button variant="outline" className="w-full rounded-full gap-2 border-purple-300 text-purple-700 hover:bg-purple-100">
                    <Phone className="h-5 w-5" />
                    0777775652
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {/* CTA Buttons */}
        <div className="space-y-3">
          <Button 
            onClick={() => navigate('/')}
            className="w-full rounded-full h-12 btn-playful text-lg"
          >
            <Home className="h-5 w-5 ml-2" />
            العودة للرئيسية
          </Button>
          
          <Link to="/profile" className="block">
            <Button 
              variant="outline"
              className="w-full rounded-full h-12 text-lg border-2"
            >
              <User className="h-5 w-5 ml-2" />
              عرض ملفي
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}
