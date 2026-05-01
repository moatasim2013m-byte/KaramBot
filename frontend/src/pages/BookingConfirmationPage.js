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
    <div className="parent-dashboard-bg py-8 md:py-12" dir="rtl">
      <div className="max-w-lg mx-auto px-4">
        {/* Celebratory Success Header */}
        <div className="confirm-hero mb-6">
          <div className="confirm-success-ring">
            <CheckCircle className="h-14 w-14 text-[var(--pk-green)]" strokeWidth={2.5} />
          </div>
          <h1 className="font-heading text-3xl md:text-4xl font-bold text-foreground mb-2">
            تم تأكيد الحجز 🎉
          </h1>
          <p className="text-base md:text-lg text-muted-foreground">
            {isCash && 'استعد للاستمتاع — الدفع عند الاستقبال'}
            {isCliq && 'خطوة أخيرة عبر CliQ لتفعيل حجزك'}
            {!isCash && !isCliq && 'شكراً لحجزك في بيكابو!'}
          </p>
        </div>

        {/* Reference Code - Premium Gradient Card */}
        <div className="confirm-reference mb-6" data-testid="confirmation-reference-card">
          <p className="text-xs md:text-sm font-semibold opacity-90 mb-1 tracking-wider uppercase">
            رقم الحجز المرجعي
          </p>
          <p className="confirm-reference__code" data-testid="confirmation-reference-code">
            {referenceCode}
          </p>
          <button
            type="button"
            onClick={() => copyToClipboard(referenceCode)}
            className="confirm-reference__copy-btn"
            aria-label="نسخ رقم الحجز"
          >
            <Copy className="h-3.5 w-3.5" />
            {copied ? 'تم النسخ' : 'نسخ الرقم'}
          </button>
        </div>

        {/* Booking Summary */}
        <div className="mb-6">
          <h2 className="confirm-section-title">
            <span className="inline-block w-1.5 h-5 rounded-full bg-[var(--pk-blue)]" />
            تفاصيل الحجز
          </h2>
          <div className="space-y-2.5">
            {confirmation.bookingType && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-blue">
                    <Tag className="h-4 w-4" />
                  </span>
                  نوع الحجز
                </div>
                <span className="value">{getBookingTypeLabel(confirmation.bookingType)}</span>
              </div>
            )}

            {confirmation.childName && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-purple">
                    <Baby className="h-4 w-4" />
                  </span>
                  اسم الطفل
                </div>
                <span className="value">{confirmation.childName}</span>
              </div>
            )}

            {confirmation.date && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-green">
                    <Calendar className="h-4 w-4" />
                  </span>
                  التاريخ
                </div>
                <span className="value">{confirmation.date}</span>
              </div>
            )}

            {confirmation.time && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-yellow">
                    <Clock className="h-4 w-4" />
                  </span>
                  الوقت
                </div>
                <span className="value">{confirmation.time}</span>
              </div>
            )}

            {confirmation.duration && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-yellow">
                    <Clock className="h-4 w-4" />
                  </span>
                  المدة
                </div>
                <span className="value">{confirmation.duration} ساعة</span>
              </div>
            )}

            {confirmation.amount && (
              <div className="confirm-detail-row">
                <div className="label">
                  <span className="confirm-detail-icon c-red">
                    <Banknote className="h-4 w-4" />
                  </span>
                  المبلغ
                </div>
                <span className="value text-lg text-[var(--pk-red)]">{confirmation.amount} د.أ</span>
              </div>
            )}

            <div className="confirm-detail-row">
              <div className="label">
                <span className="confirm-detail-icon c-orange">
                  <Banknote className="h-4 w-4" />
                </span>
                طريقة الدفع
              </div>
              <span className="value">{getPaymentMethodLabel(confirmation.paymentMethod)}</span>
            </div>

            {/* Payment Status */}
            <div className="confirm-detail-row">
              <div className="label">
                <span className="confirm-detail-icon c-yellow">
                  <Tag className="h-4 w-4" />
                </span>
                حالة الدفع
              </div>
              <span
                className={`px-3 py-1 rounded-full text-xs font-bold ${
                  isCash
                    ? 'bg-[var(--pk-yellow)]/30 text-[#8a7000] border border-[var(--pk-yellow)]/60'
                    : 'bg-[var(--pk-purple)]/15 text-[var(--pk-purple)] border border-[var(--pk-purple)]/30'
                }`}
              >
                {isCash && 'بانتظار الدفع عند الاستقبال'}
                {isCliq && 'بانتظار التحويل'}
              </span>
            </div>
          </div>
        </div>

        {/* QR Code Block — hourly bookings only */}
        {showActiveQr && (
          <div
            className="rounded-3xl border-2 border-[var(--pk-blue)]/25 bg-white overflow-hidden mb-6 shadow-[0_10px_28px_rgba(102,169,233,0.18)]"
            data-testid="confirmation-qr-card"
          >
            <div className="p-6 text-center">
              <div className="inline-flex items-center gap-2 mb-3 px-3 py-1.5 rounded-full bg-gradient-to-r from-[var(--pk-blue)]/15 to-[var(--pk-green)]/15 text-[var(--pk-blue)] text-sm font-bold border border-[var(--pk-blue)]/25">
                <QrCode className="h-4 w-4" />
                رمز QR للجلسة
              </div>
              <div className="bg-white p-3 rounded-2xl inline-block border-2 border-[var(--pk-blue)]/15 shadow-sm">
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
              <p className="mt-1 text-sm text-muted-foreground">
                رمز الحجز:{' '}
                <span className="font-mono font-bold tracking-wider text-foreground">
                  {referenceCode}
                </span>
              </p>
              {(isCash || isCliq) && (
                <p className="mt-3 text-xs text-[#8a6b00] bg-[var(--pk-yellow)]/20 border border-[var(--pk-yellow)]/40 rounded-lg p-2.5">
                  سيتم تفعيل الجلسة بعد إتمام الدفع عند الوصول
                </p>
              )}
            </div>
          </div>
        )}

        {qrAwaitingConfirmation && !showActiveQr && (
          <div className="rounded-3xl border border-dashed border-[var(--pk-blue)]/35 bg-[var(--pk-blue)]/5 overflow-hidden mb-6">
            <div className="p-5 text-center text-sm text-muted-foreground">
              سيتم إصدار رمز QR للحجز فور تأكيد الدفع.
            </div>
          </div>
        )}

        {/* Next Steps Guide */}
        <div className="mb-6">
          <h2 className="confirm-section-title">
            <span className="inline-block w-1.5 h-5 rounded-full bg-[var(--pk-green)]" />
            الخطوات القادمة
          </h2>
          <div className="space-y-2.5">
            {isCliq && (
              <div className="next-step-item">
                <div className="next-step-item__num">1</div>
                <p className="next-step-item__text">
                  حوّل المبلغ عبر CliQ إلى <span className="font-bold">Peekaboo1</span> (بنك الإسكان).
                </p>
              </div>
            )}
            {isCliq && (
              <div className="next-step-item">
                <div className="next-step-item__num">2</div>
                <p className="next-step-item__text">
                  أرسل صورة إيصال التحويل على واتساب لتأكيد حجزك.
                </p>
              </div>
            )}
            <div className="next-step-item">
              <div className="next-step-item__num">{isCliq ? 3 : 1}</div>
              <p className="next-step-item__text">
                {isHourly
                  ? 'عند الوصول، أبرز رمز QR عند الاستقبال لتفعيل الجلسة.'
                  : 'عند الوصول، قدّم رقم الحجز عند الاستقبال.'}
              </p>
            </div>
            {isCash && (
              <div className="next-step-item">
                <div className="next-step-item__num">2</div>
                <p className="next-step-item__text">
                  ادفع المبلغ ({confirmation.amount || ''} د.أ) نقداً في الاستقبال.
                </p>
              </div>
            )}
            <div className="next-step-item">
              <div className="next-step-item__num">{isCliq ? 4 : isCash ? 3 : 2}</div>
              <p className="next-step-item__text">
                استمتع معنا! لأي استفسار، تواصل معنا على واتساب{' '}
                <span className="ltr-text font-bold text-[var(--pk-green)]" dir="ltr">
                  0777775652
                </span>
                .
              </p>
            </div>
          </div>
        </div>

        {/* CliQ Transfer Details */}
        {isCliq && (
          <div className="rounded-3xl border-2 border-[var(--pk-purple)]/25 bg-gradient-to-br from-[var(--pk-purple)]/10 via-white to-[var(--pk-purple)]/5 overflow-hidden mb-6 shadow-sm">
            <div className="p-6">
              <h3 className="font-heading text-lg font-bold text-[var(--pk-purple)] mb-4 flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                تفاصيل التحويل CliQ
              </h3>

              <div className="space-y-2.5 mb-4">
                <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-[var(--pk-purple)]/15">
                  <span className="text-muted-foreground text-sm">الاسم</span>
                  <div className="flex items-center gap-2">
                    <span className="font-heading font-bold text-foreground">Peekaboo1</span>
                    <button
                      onClick={() => copyToClipboard('Peekaboo1')}
                      className="p-1.5 hover:bg-[var(--pk-purple)]/10 rounded-lg transition-colors"
                      title="نسخ"
                      aria-label="نسخ الاسم"
                    >
                      <Copy className={`h-4 w-4 ${copied ? 'text-[var(--pk-green)]' : 'text-[var(--pk-purple)]'}`} />
                    </button>
                  </div>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-[var(--pk-purple)]/15">
                  <span className="text-muted-foreground text-sm">البنك</span>
                  <span className="font-heading font-bold text-foreground">بنك الإسكان</span>
                </div>

                <div className="flex items-center justify-between bg-white rounded-xl p-3 border border-[var(--pk-purple)]/15">
                  <span className="text-muted-foreground text-sm">المبلغ</span>
                  <span className="font-heading font-bold text-lg text-[var(--pk-red)]">
                    {confirmation.amount} د.أ
                  </span>
                </div>
              </div>

              <div className="bg-[var(--pk-yellow)]/25 border border-[var(--pk-yellow)]/50 rounded-xl p-3 mb-4 text-center">
                <p className="text-sm text-[#8a6b00] font-semibold">
                  ⚠️ بعد التحويل، أرسل صورة الإيصال على واتساب لتأكيد الحجز
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <a
                  href={`https://wa.me/962777775652?text=مرحباً، أريد تأكيد حجزي رقم: ${referenceCode}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex-1"
                >
                  <Button className="w-full rounded-full bg-[var(--pk-green)] hover:bg-[#88b83b] text-white gap-2 h-12 shadow-md">
                    <MessageCircle className="h-5 w-5" />
                    واتساب
                  </Button>
                </a>
                <a href="tel:0777775652" className="flex-1">
                  <Button
                    variant="outline"
                    className="w-full rounded-full gap-2 border-[var(--pk-purple)]/40 text-[var(--pk-purple)] hover:bg-[var(--pk-purple)]/10 h-12"
                  >
                    <Phone className="h-5 w-5" />
                    اتصل
                  </Button>
                </a>
              </div>
            </div>
          </div>
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
          <Link to="/profile" className="block">
            <Button className="w-full rounded-full h-12 confirm-cta-primary text-lg font-bold">
              <User className="h-5 w-5 ml-2" />
              عرض ملفي وحجوزاتي
            </Button>
          </Link>

          <Button
            onClick={() => navigate('/')}
            variant="outline"
            className="w-full rounded-full h-12 text-base border-2 border-[var(--pk-blue)]/30 text-[var(--text-primary)] hover:bg-[var(--pk-blue)]/5"
          >
            <Home className="h-5 w-5 ml-2" />
            العودة للرئيسية
          </Button>
          
          {confirmation.isGuestBooking ? (
            <Link to="/register" className="block">
              <Button 
                variant="outline"
                className="w-full rounded-full h-12 text-lg border-2"
              >
                <User className="h-5 w-5 ml-2" />
                سجّل حساباً — واكسب نقاط الولاء في زياراتك القادمة
              </Button>
            </Link>
          ) : (
            <Link to="/profile" className="block">
              <Button 
                variant="outline"
                className="w-full rounded-full h-12 text-lg border-2"
              >
                <User className="h-5 w-5 ml-2" />
                عرض ملفي
              </Button>
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
