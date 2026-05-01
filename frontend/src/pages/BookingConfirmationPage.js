import { useEffect, useLayoutEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { toast } from 'sonner';
import {
  CheckCircle, Home, User, Copy, Phone, MessageCircle, Building2, Clock,
  Calendar, Banknote, Baby, Tag, QrCode, Sparkles, MapPin, ShieldCheck, Check
} from 'lucide-react';

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
  const [refCopied, setRefCopied] = useState(false);

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

  const copyReference = (text) => {
    navigator.clipboard.writeText(text);
    setRefCopied(true);
    toast.success('تم نسخ رقم الحجز!');
    setTimeout(() => setRefCopied(false), 2000);
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
      <div className="min-h-screen bg-gradient-to-b from-[#F4F8FE] via-[#F9FBFF] to-[#FFF8F0] py-12" dir="rtl">
        <div className="max-w-md mx-auto px-4">
          <Card className="rounded-3xl shadow-xl border-0 overflow-hidden">
            <CardContent className="p-8 text-center">
              <div className="text-6xl mb-4">🤷</div>
              <h2 className="font-heading heading-bubble text-xl font-bold text-gray-700 mb-4">
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
  const isHourly = confirmation.bookingType === 'hourly';
  // QR is only meaningful while the booking is active and unused.
  // Backend marks paid bookings as status='confirmed' + qr_status='unused'.
  const qrStatus = confirmation.qrStatus || 'unused';
  const showActiveQr = isHourly && confirmation.qrCode && qrStatus === 'unused';
  const qrAwaitingConfirmation = isHourly && !confirmation.qrCode;
  const referenceCode = getReferenceCode();

  return (
    <div className="relative min-h-screen bg-gradient-to-b from-[#F4F8FE] via-[#F9FBFF] to-[#FFF8F0] py-8 md:py-12 overflow-hidden" dir="rtl">
      {/* Subtle decorative blobs */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-14 -right-14 w-56 h-56 rounded-full bg-[#7AC74F]/15 blur-3xl" />
        <div className="absolute top-40 -left-20 w-64 h-64 rounded-full bg-[#FFD166]/20 blur-3xl" />
        <div className="absolute bottom-20 right-10 w-40 h-40 rounded-full bg-[#4A90D9]/12 blur-3xl" />
      </div>

      <div className="relative max-w-lg mx-auto px-4">
        {/* Success Header — celebratory */}
        <div className="text-center mb-6">
          <div className="relative inline-flex items-center justify-center mb-4">
            {/* Soft halo */}
            <span aria-hidden="true" className="absolute inset-0 -m-3 rounded-full bg-[#7AC74F]/25 blur-xl" />
            <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[#7AC74F]/15 animate-pulse" />
            <div className="relative w-24 h-24 rounded-full bg-gradient-to-br from-[#A6E080] to-[#7AC74F] flex items-center justify-center shadow-[0_10px_24px_rgba(122,199,79,0.35)]">
              <CheckCircle className="h-14 w-14 text-white" strokeWidth={2.25} />
            </div>
            {/* Celebratory sparkles */}
            <span className="absolute -top-1 -right-2 text-2xl animate-bounce" style={{ animationDelay: '0.1s' }}>✨</span>
            <span className="absolute -bottom-1 -left-2 text-2xl animate-bounce" style={{ animationDelay: '0.3s' }}>🎉</span>
          </div>
          <h1 className="font-heading heading-bubble text-3xl md:text-4xl font-extrabold text-[#2D2D2D] mb-2 leading-tight">
            تم <span className="heading-bubble__accent">تأكيد الحجز</span> 🎊
          </h1>
          <p className="text-base md:text-lg text-[#2D2D2D]/70">
            {isCash && 'ندفع عند الاستقبال — وشكراً لثقتك!'}
            {isCliq && 'أرسل الحوالة عبر CliQ لإتمام الحجز'}
          </p>
        </div>

        {/* Reference Code Card — prominent with copy */}
        <Card className="rounded-3xl shadow-[0_12px_30px_rgba(74,144,217,0.18)] border-0 overflow-hidden mb-5">
          <CardContent className="p-0">
            <div className="relative bg-gradient-to-r from-[var(--pk-blue)] via-[#5AA2DF] to-[var(--pk-green)] text-white p-5 md:p-6">
              <div aria-hidden="true" className="pointer-events-none absolute -top-8 -left-8 w-32 h-32 rounded-full bg-white/15 blur-2xl" />
              <div aria-hidden="true" className="pointer-events-none absolute -bottom-8 -right-8 w-32 h-32 rounded-full bg-white/10 blur-2xl" />
              <div className="relative flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs md:text-sm opacity-90 mb-1.5 inline-flex items-center gap-1.5">
                    <ShieldCheck className="h-4 w-4" />
                    رقم الحجز المرجعي
                  </p>
                  <p className="font-heading text-2xl md:text-3xl font-extrabold tracking-wider font-mono ltr-text select-all">
                    {referenceCode}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyReference(referenceCode)}
                  className="shrink-0 inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-white/25 hover:bg-white/35 active:bg-white/40 border border-white/40 text-sm font-bold backdrop-blur-sm transition"
                  aria-label="نسخ رقم الحجز"
                >
                  {refCopied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  <span>{refCopied ? 'تم النسخ' : 'نسخ'}</span>
                </button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Booking Summary Card */}
        <Card className="rounded-3xl shadow-[0_8px_22px_rgba(45,45,45,0.06)] border border-[#E6EAF2] overflow-hidden mb-5">
          <CardContent className="p-5 md:p-6">
            <h2 className="font-heading font-extrabold text-[#2D2D2D] text-lg mb-4 inline-flex items-center gap-2">
              <Tag className="h-5 w-5 text-[var(--pk-blue)]" />
              تفاصيل الحجز
            </h2>
            {/* Booking Details */}
            <div className="space-y-0">
              {confirmation.bookingType && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#4A90D9]/12 flex items-center justify-center">
                      <Tag className="h-4 w-4 text-[#2A6FC7]" />
                    </div>
                    <span className="text-sm">نوع الحجز</span>
                  </div>
                  <span className="font-bold text-[#2D2D2D]">{getBookingTypeLabel(confirmation.bookingType)}</span>
                </div>
              )}

              {confirmation.childName && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#FFD166]/25 flex items-center justify-center">
                      <Baby className="h-4 w-4 text-[#8A5A00]" />
                    </div>
                    <span className="text-sm">اسم الطفل</span>
                  </div>
                  <span className="font-bold text-[#2D2D2D]">{confirmation.childName}</span>
                </div>
              )}

              {confirmation.date && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#7AC74F]/18 flex items-center justify-center">
                      <Calendar className="h-4 w-4 text-[#3F7A1E]" />
                    </div>
                    <span className="text-sm">التاريخ</span>
                  </div>
                  <span className="font-bold text-[#2D2D2D]">{confirmation.date}</span>
                </div>
              )}

              {confirmation.time && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#7AC74F]/18 flex items-center justify-center">
                      <Clock className="h-4 w-4 text-[#3F7A1E]" />
                    </div>
                    <span className="text-sm">الوقت</span>
                  </div>
                  <span className="font-bold text-[#2D2D2D]">{confirmation.time}</span>
                </div>
              )}

              {confirmation.duration && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#7AC74F]/18 flex items-center justify-center">
                      <Clock className="h-4 w-4 text-[#3F7A1E]" />
                    </div>
                    <span className="text-sm">المدة</span>
                  </div>
                  <span className="font-bold text-[#2D2D2D]">{confirmation.duration} ساعة</span>
                </div>
              )}

              {confirmation.amount && (
                <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                  <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                    <div className="w-8 h-8 rounded-lg bg-[#E63946]/10 flex items-center justify-center">
                      <Banknote className="h-4 w-4 text-[#C62433]" />
                    </div>
                    <span className="text-sm">المبلغ</span>
                  </div>
                  <span className="font-heading font-extrabold text-lg text-[var(--pk-red)]">{confirmation.amount} <span className="text-sm font-bold text-[#2D2D2D]/60">دينار</span></span>
                </div>
              )}

              <div className="flex items-center justify-between py-3 border-b border-[#EEF1F6]">
                <div className="flex items-center gap-2.5 text-[#2D2D2D]/65">
                  <div className="w-8 h-8 rounded-lg bg-[#E8872E]/12 flex items-center justify-center">
                    <Banknote className="h-4 w-4 text-[#C66A1B]" />
                  </div>
                  <span className="text-sm">طريقة الدفع</span>
                </div>
                <span className="font-bold text-[#2D2D2D]">{getPaymentMethodLabel(confirmation.paymentMethod)}</span>
              </div>

              {/* Payment Status */}
              <div className="flex items-center justify-between py-3">
                <span className="text-sm text-[#2D2D2D]/65">حالة الدفع</span>
                <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold border ${
                  isCash
                    ? 'bg-[#FEF6D9] text-[#8A5A00] border-[#F2E533]/60'
                    : 'bg-[#F3E8FF] text-[#6B21A8] border-purple-200'
                }`}>
                  <Clock className="h-3.5 w-3.5" />
                  {isCash && 'بانتظار الدفع عند الاستقبال'}
                  {isCliq && 'بانتظار تأكيد التحويل'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* QR Code Block — hourly bookings only */}
        {showActiveQr && (
          <Card className="rounded-3xl shadow-[0_10px_24px_rgba(74,144,217,0.15)] border-2 border-[var(--pk-blue)]/25 bg-white overflow-hidden mb-5" data-testid="confirmation-qr-card">
            <CardContent className="p-6 text-center">
              <div className="inline-flex items-center gap-2 mb-4 px-3.5 py-1.5 rounded-full bg-[var(--pk-blue)]/12 text-[var(--pk-blue)] text-sm font-bold">
                <QrCode className="h-4 w-4" />
                رمز QR للجلسة
              </div>
              <div className="bg-gradient-to-br from-[#F7FAFE] to-white p-3 rounded-2xl inline-block border border-[#E6EAF2] shadow-sm">
                <img
                  src={confirmation.qrCode}
                  alt="رمز QR للحجز"
                  className="w-56 h-56 object-contain"
                  data-testid="confirmation-qr-image"
                />
              </div>
              <p className="mt-4 text-base font-bold text-[#2D2D2D]">
                يرجى إبراز رمز QR عند الوصول لتفعيل الجلسة
              </p>
              <p className="mt-1 text-sm text-[#2D2D2D]/60">
                رمز الحجز: <span className="font-mono font-bold tracking-wider ltr-text">{referenceCode}</span>
              </p>
              {(isCash || isCliq) && (
                <p className="mt-3 text-xs text-[#8A5A00] bg-[#FEF6D9] border border-[#F2E533]/60 rounded-xl px-3 py-2 inline-flex items-center gap-1.5">
                  <Sparkles className="h-3.5 w-3.5" />
                  سيتم تفعيل الجلسة بعد إتمام الدفع عند الوصول
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {qrAwaitingConfirmation && !showActiveQr && (
          <Card className="rounded-3xl border border-dashed border-[#E6EAF2] bg-[#F9FBFF] overflow-hidden mb-5">
            <CardContent className="p-5 text-center text-sm text-[#2D2D2D]/65 inline-flex items-center justify-center gap-2">
              <QrCode className="h-4 w-4" />
              سيتم إصدار رمز QR للحجز فور تأكيد الدفع.
            </CardContent>
          </Card>
        )}

        {/* CliQ Transfer Details */}
        {isCliq && (
          <Card className="rounded-3xl shadow-[0_10px_24px_rgba(168,85,247,0.15)] border-2 border-purple-200 bg-gradient-to-br from-[#F9F2FF] to-[#F3E8FF] overflow-hidden mb-5">
            <CardContent className="p-5 md:p-6">
              <h3 className="font-heading heading-bubble text-xl font-extrabold text-purple-800 mb-4 flex items-center gap-2">
                <Building2 className="h-6 w-6" />
                تفاصيل التحويل CliQ
              </h3>

              <div className="space-y-3 mb-4">
                <div className="flex items-center justify-between bg-white rounded-xl p-3.5 border border-purple-100">
                  <span className="text-purple-700 text-sm">الاسم</span>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-purple-900 ltr-text">Peekaboo1</span>
                    <button
                      onClick={() => copyToClipboard('Peekaboo1')}
                      className="p-1.5 hover:bg-purple-100 rounded-lg transition-colors"
                      title="نسخ"
                      aria-label="نسخ اسم المستلم"
                    >
                      {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4 text-purple-600" />}
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3.5 border border-purple-100">
                  <span className="text-purple-700 text-sm">البنك</span>
                  <span className="font-bold text-purple-900">بنك الإسكان</span>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3.5 border border-purple-100">
                  <span className="text-purple-700 text-sm">المبلغ</span>
                  <span className="font-heading font-extrabold text-lg text-purple-900">{confirmation.amount} <span className="text-sm text-purple-700 font-bold">دينار</span></span>
                </div>
              </div>

              {/* Important Note */}
              <div className="bg-[#FEF6D9] border border-[#F2E533]/60 rounded-xl p-3 mb-4 text-center">
                <p className="text-sm text-[#8A5A00] font-medium">
                  ⚠️ بعد التحويل، أرسل صورة الإيصال على واتساب لتأكيد الحجز
                </p>
              </div>

              {/* Contact Buttons */}
              <div className="grid grid-cols-2 gap-3">
                <a
                  href={`https://wa.me/962777775652?text=مرحباً، أريد تأكيد حجزي رقم: ${referenceCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button className="w-full rounded-full bg-[#25D366] hover:bg-[#1EB855] text-white gap-2 h-11">
                    <MessageCircle className="h-5 w-5" />
                    واتساب
                  </Button>
                </a>
                <a href="tel:0777775652" className="flex-1">
                  <Button variant="outline" className="w-full rounded-full gap-2 border-purple-300 text-purple-700 hover:bg-purple-100 h-11">
                    <Phone className="h-5 w-5" />
                    0777775652
                  </Button>
                </a>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Next Steps Card — reassuring guide for parents */}
        <Card className="rounded-3xl shadow-[0_8px_22px_rgba(45,45,45,0.05)] border border-[#E6EAF2] bg-white overflow-hidden mb-5">
          <CardContent className="p-5 md:p-6">
            <h3 className="font-heading heading-bubble text-lg md:text-xl font-extrabold text-[#2D2D2D] mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-[#E8872E]" />
              ماذا بعد؟
            </h3>
            <ol className="space-y-3.5">
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#FFD166] to-[#E8872E] text-white font-heading font-extrabold flex items-center justify-center text-sm shadow-sm">1</span>
                <div className="pt-0.5">
                  <p className="font-bold text-[#2D2D2D] text-sm md:text-base">
                    {isCliq ? 'أرسل حوالة CliQ ثم أرسل الإيصال' : 'احفظ رقم الحجز'}
                  </p>
                  <p className="text-xs md:text-sm text-[#2D2D2D]/65 mt-0.5 leading-relaxed">
                    {isCliq
                      ? 'حوّل المبلغ لحساب Peekaboo1 في بنك الإسكان ثم أرسل صورة الإيصال على واتساب.'
                      : 'ستحتاج إليه عند الوصول. يمكنك نسخه من البطاقة أعلاه.'}
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#4A90D9] to-[#2A6FC7] text-white font-heading font-extrabold flex items-center justify-center text-sm shadow-sm">2</span>
                <div className="pt-0.5">
                  <p className="font-bold text-[#2D2D2D] text-sm md:text-base inline-flex items-center gap-1.5">
                    <MapPin className="h-4 w-4 text-[#2A6FC7]" />
                    توجّه إلى بيكابو في الموعد
                  </p>
                  <p className="text-xs md:text-sm text-[#2D2D2D]/65 mt-0.5 leading-relaxed">
                    يفضَّل الوصول قبل 10 دقائق من بداية الجلسة.
                  </p>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="shrink-0 w-8 h-8 rounded-full bg-gradient-to-br from-[#7AC74F] to-[#3F7A1E] text-white font-heading font-extrabold flex items-center justify-center text-sm shadow-sm">3</span>
                <div className="pt-0.5">
                  <p className="font-bold text-[#2D2D2D] text-sm md:text-base inline-flex items-center gap-1.5">
                    {isHourly ? <><QrCode className="h-4 w-4 text-[#3F7A1E]" /> اعرض رمز QR عند الاستقبال</> : 'اقضِ وقتاً مميزاً مع طفلك'}
                  </p>
                  <p className="text-xs md:text-sm text-[#2D2D2D]/65 mt-0.5 leading-relaxed">
                    {isHourly
                      ? 'فريق بيكابو سيفعّل الجلسة ويرحّب بكم — استمتعوا!'
                      : 'فريقنا جاهز لاستقبالكم — استمتعوا بوقتكم في بيكابو!'}
                  </p>
                </div>
              </li>
            </ol>
          </CardContent>
        </Card>

        {/* Universal Support CTA (WhatsApp) — helpful for any booking */}
        {!isCliq && (
          <div className="rounded-3xl bg-white border border-[#E6EAF2] p-4 md:p-5 mb-5 flex items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3 min-w-0">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-[#25D366]/15 flex items-center justify-center">
                <MessageCircle className="h-5 w-5 text-[#1EB855]" />
              </div>
              <div className="min-w-0">
                <p className="font-bold text-[#2D2D2D] text-sm">تحتاج مساعدة؟</p>
                <p className="text-xs text-[#2D2D2D]/65">تواصل معنا على واتساب</p>
              </div>
            </div>
            <a
              href={`https://wa.me/962777775652?text=مرحباً، لدي استفسار بخصوص حجزي رقم: ${referenceCode}`}
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0"
            >
              <Button className="rounded-full bg-[#25D366] hover:bg-[#1EB855] text-white gap-2 h-10">
                <MessageCircle className="h-4 w-4" />
                تواصل معنا
              </Button>
            </a>
          </div>
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
