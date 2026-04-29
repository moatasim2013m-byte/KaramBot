import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import { Calendar } from '../components/ui/calendar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import { format, addDays, startOfDay } from 'date-fns';
import { Loader2, Sparkles, CalendarDays, Clock, PartyPopper, Wand2, MessageSquareText, CalendarX2, Copy as CopyIcon, Check } from 'lucide-react';
import { PaymentMethodSelector } from '../components/PaymentMethodSelector';
import Shroomi from '../components/Shroomi';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

const resolveMediaUrl = (url) => {
  if (!url) return '';
  if (/^(data:|blob:)/i.test(url)) return url;

  let normalizedUrl = String(url).trim();

  if (/^https?:\/\//i.test(normalizedUrl)) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.pathname.startsWith('/api/uploads/') || parsed.pathname.startsWith('/uploads/')) {
        normalizedUrl = `${parsed.pathname}${parsed.search}`;
      } else {
        return normalizedUrl;
      }
    } catch {
      return normalizedUrl;
    }
  }

  if (normalizedUrl.startsWith('/uploads/')) {
    normalizedUrl = `/api${normalizedUrl}`;
  }

  return `${BACKEND_ORIGIN}${normalizedUrl.startsWith('/') ? '' : '/'}${normalizedUrl}`;
};


export default function BirthdayPage() {
  const { isAuthenticated, api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'حفلات أعياد الميلاد | بيكابو';
  }, []);

  const getBirthdayMinLeadDays = () => (new Date().getHours() < 18 ? 1 : 2);
  const [date, setDate] = useState(addDays(startOfDay(new Date()), getBirthdayMinLeadDays()));
  const [slots, setSlots] = useState([]);
  const [themes, setThemes] = useState([]);
  const [children, setChildren] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedTheme, setSelectedTheme] = useState(null);
  const [selectedChild, setSelectedChild] = useState('');
  const [guestCount, setGuestCount] = useState(10);
  const [specialNotes, setSpecialNotes] = useState('');
  const [customRequest, setCustomRequest] = useState('');
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGeneratedThemeUrl, setAiGeneratedThemeUrl] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [activeTab, setActiveTab] = useState('standard');
  const [products, setProducts] = useState([]);
  const [selectedProductQty, setSelectedProductQty] = useState({});
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [inviteResult, setInviteResult] = useState(null);

  useEffect(() => {
    fetchThemes();
    fetchProducts();
    if (isAuthenticated) {
      fetchChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  useEffect(() => {
    fetchSlots();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date]);


  const fetchProducts = async () => {
    try {
      const response = await api.get('/products?active=true');
      setProducts(response.data.products || []);
    } catch (error) {
      console.error('Failed to fetch products:', error);
    }
  };

  const updateProductQty = (productId, qty) => {
    setSelectedProductQty((prev) => {
      const next = { ...prev };
      if (qty <= 0) delete next[productId];
      else next[productId] = qty;
      return next;
    });
  };

  const buildLineItems = () => products
    .filter((product) => (selectedProductQty[product.id] || 0) > 0)
    .map((product) => ({ productId: product.id, quantity: selectedProductQty[product.id] }));

  const getProductsTotal = () => products.reduce((sum, product) => (
    sum + ((selectedProductQty[product.id] || 0) * (Number(product.priceJD) || 0))
  ), 0);

  const fetchChildren = async () => {
    try {
      const response = await api.get('/profile/children');
      setChildren(response.data.children || []);
    } catch (error) {
      console.error('Failed to fetch children:', error);
    }
  };

  const fetchThemes = async () => {
    try {
      const response = await api.get('/themes');
      setThemes(response.data.themes || []);
    } catch (error) {
      console.error('Failed to fetch themes:', error);
    }
  };

  const fetchSlots = async () => {
    setLoadingSlots(true);
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const response = await api.get(`/slots/available?date=${dateStr}&slot_type=birthday`);
      setSlots(response.data.slots || []);
    } catch (error) {
      console.error('Failed to fetch slots:', error);
    } finally {
      setLoadingSlots(false);
    }
  };

  // Filter birthday slots - must end by 23:00 (2 hour parties)
  const getFilteredBirthdaySlots = () => {
    return slots.filter(slot => {
      const [hours, minutes] = slot.start_time.split(':').map(Number);
      const startMinutes = hours * 60 + minutes;
      const endMinutes = startMinutes + 120; // 2 hour party
      // Must end by 23:00 (1380 minutes)
      return endMinutes <= 1380;
    });
  };

  // Calculate end time for birthday party (always 2 hours)
  const getPartyEndTime = (startTime) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + 120;
    const endHours = Math.floor(totalMinutes / 60);
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  const handleStandardBooking = async () => {
    if (!isAuthenticated) {
      toast.error('الرجاء تسجيل الدخول للحجز');
      navigate('/login');
      return;
    }

    if (!selectedSlot || !selectedTheme || !selectedChild) {
      toast.error('الرجاء اختيار الموعد والثيم والطفل');
      return;
    }

    setLoading(true);
    try {
      if (!selectedTheme.id) {
        toast.error('يرجى اختيار ثيم جاهز لإتمام الحجز حالياً');
        setLoading(false);
        return;
      }

      const amount = (Number(selectedTheme.price) || 0) + getProductsTotal();
      const lineItems = buildLineItems();

      if (paymentMethod === 'card') {
        // Online card provider checkout flow
        const response = await api.post('/payments/create-checkout', {
          type: 'birthday',
          reference_id: selectedSlot.id,
          theme_id: selectedTheme.id,
          child_id: selectedChild,
          origin_url: window.location.origin,
          guest_count: guestCount,
          special_notes: specialNotes,
          lineItems
        });
        if (response.data?.payment_method === 'manual') {
          throw new Error('الدفع بالبطاقة غير متاح حالياً. الرجاء اختيار الدفع نقداً أو CliQ.');
        }

        const checkoutUrl = response.data?.url;
        if (!checkoutUrl) {
          throw new Error('تعذر بدء الدفع الإلكتروني. حاول مرة أخرى.');
        }
        if (checkoutUrl.startsWith('/')) {
          navigate(checkoutUrl);
        } else {
          window.location.assign(checkoutUrl);
        }
      } else {
        // Cash or CliQ - create booking directly
        const response = await api.post('/bookings/birthday/offline', {
          slot_id: selectedSlot.id,
          child_id: selectedChild,
          theme_id: selectedTheme.id,
          guest_count: guestCount,
          special_notes: specialNotes,
          payment_method: paymentMethod,
          amount,
          lineItems
        });

        // Get child name for confirmation
        const childObj = children.find(c => c.id === selectedChild);

        // Navigate to confirmation page with booking details
        const confirmationData = {
          bookingId: response.data.booking?.id,
          bookingCode: response.data.booking?.booking_code,
          bookingType: 'birthday',
          childName: childObj?.name,
          date: selectedSlot.date,
          time: selectedSlot.start_time,
          duration: 2,
          amount,
          paymentMethod
        };

        // Store in localStorage for refresh persistence
        localStorage.setItem('pk_last_confirmation', JSON.stringify(confirmationData));

        navigate('/booking-confirmation', { state: confirmationData });
        setLoading(false);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'فشل إنشاء الحجز');
      setLoading(false);
    }
  };

  const handleCustomRequest = async () => {
    if (!isAuthenticated) {
      toast.error('Please login to submit request');
      navigate('/login');
      return;
    }

    if (!selectedSlot || !selectedChild || !customRequest) {
      toast.error('Please fill in all required fields');
      return;
    }

    setLoading(true);
    try {
      await api.post('/bookings/birthday/custom', {
        slot_id: selectedSlot.id,
        child_id: selectedChild,
        custom_request: customRequest,
        guest_count: guestCount,
        special_notes: specialNotes
      });

      toast.success('Custom party request submitted! Our team will contact you soon.');
      navigate('/profile');
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to submit request');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateAiTheme = async () => {
    const trimmedPrompt = aiPrompt.trim();
    if (trimmedPrompt.length < 10 || trimmedPrompt.length > 300) {
      toast.error('يرجى كتابة وصف بين 10 و 300 حرف');
      return;
    }

    setAiGenerating(true);
    try {
      const response = await api.post('/themes/ai-generate', {
        prompt: trimmedPrompt,
        aspectRatio: '1:1'
      });

      const imageUrl = response.data?.imageUrl;
      if (!imageUrl) {
        throw new Error('Missing imageUrl');
      }

      setAiGeneratedThemeUrl(imageUrl);
      toast.success('تم إنشاء الثيم بنجاح');
    } catch (error) {
      const statusCode = error.response?.status;
      const apiMessage = error.response?.data?.error;

      if (statusCode === 503) {
        toast.error(apiMessage || 'خدمة إنشاء الثيم غير مفعّلة حالياً');
      } else if (statusCode === 429) {
        toast.error(apiMessage || 'محاولات كثيرة جداً، الرجاء المحاولة بعد قليل');
      } else if (apiMessage) {
        toast.error(apiMessage);
      } else {
        toast.error('حدث خطأ أثناء إنشاء الثيم');
      }
    } finally {
      setAiGenerating(false);
    }
  };

  const copyToClipboard = async (text, successMessage) => {
    if (!text) return;

    try {
      await navigator.clipboard.writeText(text);
      toast.success(successMessage);
    } catch (error) {
      toast.error('تعذر النسخ، حاول مرة أخرى');
    }
  };

  const handleGenerateInviteCopy = async () => {
    if (!isAuthenticated) {
      toast.error('الرجاء تسجيل الدخول أولاً');
      navigate('/login');
      return;
    }

    const selectedChildObj = children.find((child) => child.id === selectedChild);

    setInviteGenerating(true);
    try {
      const response = await api.post('/ai/invite', {
        childName: selectedChildObj?.name || '',
        age: selectedChildObj?.age || null,
        theme: selectedTheme?.name_ar || selectedTheme?.name || '',
        extraDetails: specialNotes || ''
      });

      setInviteResult(response.data);
      toast.success('تم إنشاء النصوص بنجاح');
    } catch (error) {
      const apiMessage = error.response?.data?.error;
      toast.error(apiMessage || 'تعذر إنشاء النصوص حالياً');
    } finally {
      setInviteGenerating(false);
    }
  };

  const handleUseAiTheme = () => {
    if (!aiGeneratedThemeUrl) {
      return;
    }

    setSelectedTheme({
      id: null,
      name: 'AI Generated Theme',
      name_ar: 'ثيم مولد بالذكاء الاصطناعي',
      image_url: aiGeneratedThemeUrl,
      price: 0,
      isAiGenerated: true
    });
    toast.success('تم اختيار الثيم المولد بالذكاء الاصطناعي');
  };

  const minDate = addDays(startOfDay(new Date()), getBirthdayMinLeadDays());
  const maxDate = addDays(startOfDay(new Date()), 90);
  const canBookTomorrow = getBirthdayMinLeadDays() === 1;

  const filteredSlots = getFilteredBirthdaySlots();

  const SlotsSkeleton = () => (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
        <div key={i} className="h-16 rounded-2xl bg-slate-100 animate-pulse" />
      ))}
    </div>
  );

  return (
    <div className="pk-booking-page min-h-screen py-8 md:py-12" dir="rtl">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ======================================================
            HERO — single coherent premium hero.
            Shroomi #1 of 3: party-big mascot anchored to bottom
            corner. Hidden on small screens to never overlap title.
            ====================================================== */}
        <div className="pk-booking-hero mb-8 md:mb-10">
          <div className="pk-booking-hero__deco-yellow" aria-hidden="true"></div>
          <div
            className="pk-booking-hero__deco-blue"
            aria-hidden="true"
            style={{ background: 'rgba(245,107,156,.4)' }}
          ></div>

          {/* In RTL, place the mascot on the LEFT (the empty side) so it
              never overlaps the right-aligned heading text. */}
          <div
            className="pk-booking-hero__shroomi shroomi-halo shroomi-halo--red hidden md:block"
            aria-hidden="true"
            style={{ right: 'auto', left: 24, bottom: -10 }}
          >
            <Shroomi pose="party-big" size={150} className="shroomi-float" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <span
              className="pk-hero-eyebrow"
              style={{
                color: '#9d174d',
                background: 'rgba(245,107,156,.14)',
                borderColor: 'rgba(245,107,156,.32)',
              }}
            >
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              احتفال لا يُنسى — كيك، بالونات، وفرحة
            </span>
            <h1
              className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 mt-3 mb-2 tracking-tight"
              data-testid="birthday-title"
            >
              حفلات أعياد الميلاد
            </h1>
            <p className="text-slate-600 text-sm md:text-base max-w-md leading-relaxed">
              اختر التاريخ والثيم، وسنحضّر لطفلك تجربة احتفال متكاملة — بإشراف فريق بيكابو.
            </p>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6 md:space-y-8">
          {/* Premium tabs — clean white pill, dark active pill */}
          <TabsList className="grid w-full max-w-sm mx-auto grid-cols-2 rounded-full p-1 h-12 bg-white border border-slate-200 shadow-sm">
            <TabsTrigger
              value="standard"
              className="rounded-full text-sm font-semibold data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-md"
              data-testid="tab-standard"
            >
              الثيمات الجاهزة
            </TabsTrigger>
            <TabsTrigger
              value="custom"
              className="rounded-full text-sm font-semibold data-[state=active]:bg-slate-900 data-[state=active]:text-white data-[state=active]:shadow-md"
              data-testid="tab-custom"
            >
              طلب مخصص
            </TabsTrigger>
          </TabsList>

          {/* ======================================================
              STEP 1 + STEP 2 — Date + Slots side by side
              ====================================================== */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
            {/* STEP 1: DATE */}
            <div className="pk-pcard">
              <div className="pk-pcard__topbar pk-topbar--blue"></div>
              <div className="p-5 sm:p-6">
                <div className="pk-section-head">
                  <span className="pk-section-head__num">
                    <CalendarDays className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="pk-section-head__title">اختر التاريخ</div>
                    <div className="pk-section-head__sub">
                      {canBookTomorrow
                        ? 'يمكن الحجز لليوم التالي قبل 6:00 مساءً'
                        : 'انتهى وقت حجز اليوم التالي'}
                    </div>
                  </div>
                </div>
                <div className="flex justify-center mt-3">
                  <Calendar
                    mode="single"
                    selected={date}
                    onSelect={(d) => d && setDate(d)}
                    disabled={(d) => d < minDate || d > maxDate}
                    className="rounded-xl"
                    data-testid="birthday-calendar"
                  />
                </div>
              </div>
            </div>

            {/* STEP 2: SLOTS */}
            <div className="pk-pcard lg:col-span-2">
              <div
                className={`pk-pcard__topbar ${selectedSlot ? 'pk-topbar--green' : 'pk-topbar--pink'}`}
              ></div>
              <div className="p-5 sm:p-6">
                <div className="pk-section-head">
                  <span
                    className={`pk-section-head__num ${selectedSlot ? 'pk-section-head__num--done' : ''}`}
                  >
                    {selectedSlot ? <Check className="h-4 w-4" /> : <Clock className="h-4 w-4" />}
                  </span>
                  <div>
                    <div className="pk-section-head__title">أوقات الحفلات</div>
                    <div className="pk-section-head__sub">
                      {format(date, 'EEEE d MMM')} • كل حفلة ساعتان
                    </div>
                  </div>
                </div>

                <div className="mt-4">
                  {loadingSlots ? (
                    <SlotsSkeleton />
                  ) : filteredSlots.length === 0 ? (
                    <div className="text-center py-10 text-slate-500">
                      <CalendarX2 className="h-10 w-10 mx-auto mb-3 opacity-60" />
                      <p className="text-sm font-medium">لا توجد أوقات متاحة</p>
                      <p className="text-xs mt-1 text-slate-400">جرّب تاريخ آخر</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                      {filteredSlots.map((slot) => {
                        const endTime = getPartyEndTime(slot.start_time);
                        const isSelected = selectedSlot?.id === slot.id;
                        const isDisabled = !slot.is_available;
                        return (
                          <button
                            key={slot.id}
                            type="button"
                            onClick={() => slot.is_available && setSelectedSlot(slot)}
                            disabled={isDisabled}
                            className={[
                              'relative rounded-2xl border px-3 py-3 text-center transition-all',
                              isSelected
                                ? 'border-slate-900 bg-slate-900 text-white shadow-md'
                                : isDisabled
                                ? 'border-slate-200 bg-slate-50 text-slate-400 cursor-not-allowed opacity-70'
                                : 'border-slate-200 bg-white text-slate-800 hover:border-slate-300 hover:shadow-sm',
                            ].join(' ')}
                            data-testid={`party-slot-${slot.start_time}`}
                          >
                            <div dir="ltr" className="font-heading font-bold text-sm">
                              {slot.start_time} → {endTime}
                            </div>
                            {!slot.is_available && (
                              <div className="text-[11px] mt-1 font-medium">محجوز</div>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* ======================================================
              STANDARD THEMES TAB
              ====================================================== */}
          <TabsContent value="standard" className="space-y-6 mt-0">
            {/* THEMES GRID — pk-pcard wrapper holds the whole step.
                Shroomi #2 of 3: gift-magic small corner accent
                (only on >= sm screens, contained, no overlap). */}
            <div className="pk-pcard relative overflow-hidden">
              <div className="pk-pcard__topbar pk-topbar--orange"></div>
              <div
                className="pk-card-mascot pk-card-mascot--tr hidden sm:block"
                aria-hidden="true"
                style={{ width: 56, height: 56 }}
              >
                <Shroomi pose="gift-magic" size={56} className="shroomi-bob" />
              </div>
              <div className="p-5 sm:p-6">
                <div className="pk-section-head">
                  <span
                    className={`pk-section-head__num ${selectedTheme ? 'pk-section-head__num--done' : ''}`}
                  >
                    {selectedTheme ? <Check className="h-4 w-4" /> : <PartyPopper className="h-4 w-4" />}
                  </span>
                  <div>
                    <div className="pk-section-head__title">اختر الثيم</div>
                    <div className="pk-section-head__sub">باقات احتفال جاهزة بأسعار شفافة</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
                  {themes.map((theme, index) => {
                    const isSelected = selectedTheme?.id === theme.id;
                    const isPopular = index === 1;
                    return (
                      <button
                        key={theme.id}
                        type="button"
                        onClick={() => setSelectedTheme(theme)}
                        className={[
                          'group relative text-right rounded-2xl border bg-white p-3 transition-all',
                          isSelected
                            ? 'border-slate-900 ring-2 ring-slate-900/10 shadow-md'
                            : 'border-slate-200 hover:border-slate-300 hover:shadow-sm',
                        ].join(' ')}
                        data-testid={`theme-${theme.id}`}
                        aria-selected={isSelected}
                      >
                        {isPopular && (
                          <span className="absolute top-2 right-2 z-10 text-[10px] font-bold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-2 py-0.5">
                            الأكثر طلباً
                          </span>
                        )}
                        {isSelected && (
                          <span className="absolute top-2 left-2 z-10 inline-flex items-center justify-center w-6 h-6 rounded-full bg-slate-900 text-white shadow">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                        )}
                        {theme.image_url && (
                          <div className="aspect-[4/3] w-full overflow-hidden rounded-xl bg-slate-100 mb-3">
                            <img
                              src={resolveMediaUrl(theme.image_url)}
                              alt={theme.name_ar || theme.name}
                              className="w-full h-full object-cover transition-transform group-hover:scale-[1.03]"
                            />
                          </div>
                        )}
                        <h3 className="font-heading font-bold text-sm text-slate-900 truncate">
                          {theme.name_ar || theme.name}
                        </h3>
                        <div className="mt-1.5 inline-flex items-baseline gap-1">
                          <span className="text-base font-bold text-slate-900">{theme.price}</span>
                          <span className="text-xs text-slate-500 font-medium">دينار</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* AI INVITE COPY GENERATOR */}
            <div className="pk-pcard">
              <div className="pk-pcard__topbar pk-topbar--purple"></div>
              <div className="p-5 sm:p-6">
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-violet-50 text-violet-700 border border-violet-100 shrink-0">
                      <MessageSquareText className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="font-heading font-bold text-slate-900">
                        مولد نص الدعوة + كابشن إنستغرام
                      </p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        نصوص جاهزة بالعربية والإنجليزية مع هاشتاغات
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={handleGenerateInviteCopy}
                    disabled={inviteGenerating}
                    variant="outline"
                    className="rounded-full border-slate-300 hover:border-slate-400 shrink-0"
                    data-testid="generate-ai-invite-btn"
                  >
                    {inviteGenerating ? (
                      <>
                        <Loader2 className="ml-2 h-4 w-4 animate-spin" />
                        جاري الإنشاء...
                      </>
                    ) : (
                      'إنشاء النص'
                    )}
                  </Button>
                </div>

                {inviteResult && (
                  <div className="space-y-3 mt-5">
                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Label className="text-sm font-semibold text-slate-700">
                          الدعوة العربية
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-slate-600 hover:text-slate-900"
                          onClick={() =>
                            copyToClipboard(inviteResult.inviteArabic, 'تم نسخ الدعوة العربية')
                          }
                        >
                          <CopyIcon className="h-3.5 w-3.5 ml-1" />
                          نسخ
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-line text-slate-700">
                        {inviteResult.inviteArabic}
                      </p>
                    </div>

                    {inviteResult.inviteEnglish && (
                      <div
                        className="p-4 rounded-xl border border-slate-200 bg-slate-50/60"
                        dir="ltr"
                      >
                        <div className="flex items-center justify-between gap-2 mb-2">
                          <Label className="text-sm font-semibold text-slate-700">
                            English Invite
                          </Label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-8 text-slate-600 hover:text-slate-900"
                            onClick={() =>
                              copyToClipboard(inviteResult.inviteEnglish, 'Copied English invite')
                            }
                          >
                            <CopyIcon className="h-3.5 w-3.5 mr-1" />
                            Copy
                          </Button>
                        </div>
                        <p className="text-sm whitespace-pre-line text-slate-700">
                          {inviteResult.inviteEnglish}
                        </p>
                      </div>
                    )}

                    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50/60">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <Label className="text-sm font-semibold text-slate-700">
                          كابشن إنستغرام
                        </Label>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 text-slate-600 hover:text-slate-900"
                          onClick={() =>
                            copyToClipboard(
                              `${inviteResult.igCaptionArabic}\n\n${(inviteResult.hashtags || []).join(' ')}`,
                              'تم نسخ الكابشن والهاشتاغات'
                            )
                          }
                        >
                          <CopyIcon className="h-3.5 w-3.5 ml-1" />
                          نسخ
                        </Button>
                      </div>
                      <p className="text-sm whitespace-pre-line text-slate-700">
                        {inviteResult.igCaptionArabic}
                      </p>
                      {!!inviteResult.hashtags?.length && (
                        <p className="text-xs text-slate-500 mt-2">
                          {inviteResult.hashtags.join(' ')}
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* AI THEME GENERATOR */}
            <div className="pk-pcard">
              <div className="pk-pcard__topbar pk-topbar--yellow"></div>
              <div className="p-5 sm:p-6 space-y-4">
                <div className="flex items-start gap-3">
                  <span className="inline-flex items-center justify-center w-10 h-10 rounded-xl bg-amber-50 text-amber-700 border border-amber-100 shrink-0">
                    <Wand2 className="h-5 w-5" />
                  </span>
                  <div>
                    <p className="font-heading font-bold text-slate-900">
                      ما لقيت الثيم المناسب؟
                    </p>
                    <p className="text-xs text-slate-500 mt-0.5">
                      اكتب وصفك وسننشئ لك ثيم بالذكاء الاصطناعي
                    </p>
                  </div>
                </div>

                <Textarea
                  value={aiPrompt}
                  onChange={(e) => setAiPrompt(e.target.value)}
                  placeholder="مثال: بالونات زرقاء و صفراء مع سبايدرمان و كيك كبير و خلفية احتفالية"
                  className="rounded-xl min-h-[100px] border-slate-200 focus-visible:ring-slate-900"
                  dir="rtl"
                  data-testid="ai-theme-prompt"
                />
                <Button
                  onClick={handleGenerateAiTheme}
                  disabled={aiGenerating}
                  className="rounded-full h-11 bg-slate-900 hover:bg-slate-800 text-white"
                  data-testid="generate-ai-theme-btn"
                >
                  {aiGenerating ? (
                    <>
                      <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                      جاري إنشاء الثيم...
                    </>
                  ) : (
                    <>
                      <Sparkles className="ml-2 h-4 w-4" />
                      إنشاء بالذكاء الاصطناعي
                    </>
                  )}
                </Button>

                {aiGeneratedThemeUrl && (
                  <div className="space-y-3 pt-2">
                    <img
                      src={aiGeneratedThemeUrl}
                      alt="AI generated birthday theme"
                      className="w-full max-w-xs h-auto rounded-xl border border-slate-200"
                    />
                    <Button
                      onClick={handleUseAiTheme}
                      variant="outline"
                      className="rounded-full border-slate-300"
                      data-testid="use-ai-theme-btn"
                    >
                      استخدام هذا الثيم
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {/* ======================================================
                BOOKING SUMMARY / FORM (only when authenticated)
                Shroomi #3 of 3: thumbs-up-big small corner accent.
                Hidden on small screens to never crowd the form.
                ====================================================== */}
            {isAuthenticated && (
              <div className="pk-pcard relative overflow-hidden">
                <div
                  className="pk-card-mascot pk-card-mascot--tl hidden sm:block shroomi-halo shroomi-halo--green"
                  aria-hidden="true"
                  style={{ width: 64, height: 64 }}
                >
                  <Shroomi pose="thumbs-up-big" size={64} className="shroomi-bob" />
                </div>
                <div className="pk-pcard__topbar pk-topbar--green"></div>
                <div className="p-5 sm:p-6 space-y-6">
                  <div className="pk-section-head">
                    <span className="pk-section-head__num pk-section-head__num--done">4</span>
                    <div>
                      <div className="pk-section-head__title">أكمل حجزك</div>
                      <div className="pk-section-head__sub">معلومات أخيرة قبل التأكيد</div>
                    </div>
                  </div>

                  {/* Form fields grouped */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                    <div>
                      <Label className="text-sm font-semibold text-slate-700">
                        طفل عيد الميلاد
                      </Label>
                      <Select value={selectedChild} onValueChange={setSelectedChild}>
                        <SelectTrigger
                          className="rounded-xl mt-1.5 border-slate-200"
                          data-testid="birthday-child-select"
                        >
                          <SelectValue placeholder="اختر الطفل" />
                        </SelectTrigger>
                        <SelectContent>
                          {children.map((child) => (
                            <SelectItem key={child.id} value={child.id}>
                              {child.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    <div>
                      <Label className="text-sm font-semibold text-slate-700">عدد الضيوف</Label>
                      <Input
                        type="number"
                        min="5"
                        max="50"
                        value={guestCount}
                        onChange={(e) => setGuestCount(parseInt(e.target.value))}
                        className="rounded-xl mt-1.5 border-slate-200"
                        data-testid="guest-count"
                      />
                    </div>

                    <div>
                      <Label className="text-sm font-semibold text-slate-700">الثيم المختار</Label>
                      <div className="rounded-xl mt-1.5 px-3 py-2 bg-slate-50 border border-slate-200 text-sm min-h-[40px] flex items-center">
                        {selectedTheme ? (
                          <span className="font-semibold text-slate-900">
                            {selectedTheme.name_ar || selectedTheme.name} —{' '}
                            {Number(selectedTheme.price || 0).toFixed(1)} د
                          </span>
                        ) : (
                          <span className="text-slate-400">لم يتم اختيار ثيم</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {products.length > 0 && (
                    <div>
                      <Label className="text-sm font-semibold text-slate-700">إضافات</Label>
                      <div className="space-y-2 mt-2">
                        {products.map((product) => {
                          const qty = selectedProductQty[product.id] || 0;
                          return (
                            <div
                              key={product.id}
                              className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3"
                            >
                              <div>
                                <p className="font-medium text-slate-900">{product.nameAr}</p>
                                <p className="text-xs text-slate-500">{product.priceJD} د</p>
                              </div>
                              <div className="flex items-center gap-2">
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 p-0 rounded-full"
                                  onClick={() => updateProductQty(product.id, qty - 1)}
                                >
                                  -
                                </Button>
                                <span className="min-w-6 text-center font-semibold">{qty}</span>
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="h-8 w-8 p-0 rounded-full"
                                  onClick={() => updateProductQty(product.id, qty + 1)}
                                >
                                  +
                                </Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Mini summary breakdown */}
                  <div className="pk-summary-card">
                    <div className="pk-summary-row">
                      <span>الثيم</span>
                      <span className="font-semibold text-slate-900">
                        {selectedTheme
                          ? `${Number(selectedTheme.price || 0).toFixed(1)} د`
                          : '— د'}
                      </span>
                    </div>
                    <div className="pk-summary-row">
                      <span>الإضافات</span>
                      <span className="font-semibold text-slate-900">
                        {getProductsTotal().toFixed(1)} د
                      </span>
                    </div>
                    <div className="pk-summary-row pk-summary-row--final">
                      <span>الإجمالي</span>
                      <span>
                        {((Number(selectedTheme?.price) || 0) + getProductsTotal()).toFixed(1)} د
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200">
                    <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-4 border-t border-slate-200">
                    <Button
                      onClick={handleStandardBooking}
                      disabled={!selectedSlot || !selectedTheme || !selectedChild || loading}
                      className="w-full sm:w-auto px-8 rounded-full h-12 bg-slate-900 hover:bg-slate-800 text-white shadow-md disabled:opacity-60"
                      data-testid="book-party-btn"
                    >
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري المعالجة...
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <PartyPopper className="h-4 w-4" />
                          احجز عيد ميلاد
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </TabsContent>

          {/* ======================================================
              CUSTOM REQUEST TAB
              ====================================================== */}
          <TabsContent value="custom" className="space-y-6 mt-0">
            <div className="pk-pcard">
              <div className="pk-pcard__topbar pk-topbar--pink"></div>
              <div className="p-5 sm:p-6 space-y-5">
                <div className="pk-section-head">
                  <span className="pk-section-head__num">
                    <Sparkles className="h-4 w-4" />
                  </span>
                  <div>
                    <div className="pk-section-head__title">طلب ثيم مخصص</div>
                    <div className="pk-section-head__sub">
                      لديك فكرة فريدة؟ أخبرنا عنها وسنتواصل معك بالأسعار.
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <Label className="text-sm font-semibold text-slate-700">طفل عيد الميلاد</Label>
                    <Select value={selectedChild} onValueChange={setSelectedChild}>
                      <SelectTrigger className="rounded-xl mt-1.5 border-slate-200">
                        <SelectValue placeholder="اختر الطفل" />
                      </SelectTrigger>
                      <SelectContent>
                        {children.map((child) => (
                          <SelectItem key={child.id} value={child.id}>
                            {child.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold text-slate-700">
                      عدد الضيوف المتوقع
                    </Label>
                    <Input
                      type="number"
                      min="5"
                      max="100"
                      value={guestCount}
                      onChange={(e) => setGuestCount(parseInt(e.target.value))}
                      className="rounded-xl mt-1.5 border-slate-200"
                    />
                  </div>
                </div>

                <div>
                  <Label className="text-sm font-semibold text-slate-700">صِف الثيم المخصص *</Label>
                  <Textarea
                    value={customRequest}
                    onChange={(e) => setCustomRequest(e.target.value)}
                    placeholder="أخبرنا عن ثيم حفلة أحلامك..."
                    className="rounded-xl mt-1.5 min-h-[100px] border-slate-200 focus-visible:ring-slate-900"
                    data-testid="custom-request"
                  />
                </div>

                <div>
                  <Label className="text-sm font-semibold text-slate-700">ملاحظات (اختياري)</Label>
                  <Textarea
                    value={specialNotes}
                    onChange={(e) => setSpecialNotes(e.target.value)}
                    placeholder="أي متطلبات خاصة..."
                    className="rounded-xl mt-1.5 border-slate-200 focus-visible:ring-slate-900"
                    rows={2}
                  />
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2">
                  <p className="text-xs text-slate-500">
                    سيتواصل فريقنا معك بالأسعار خلال 24 ساعة.
                  </p>
                  <Button
                    onClick={handleCustomRequest}
                    disabled={!selectedSlot || !selectedChild || !customRequest || loading}
                    className="w-full sm:w-auto rounded-full h-11 px-6 bg-slate-900 hover:bg-slate-800 text-white disabled:opacity-60"
                    data-testid="submit-custom-btn"
                  >
                    {loading ? (
                      <span className="inline-flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري الإرسال...
                      </span>
                    ) : (
                      'إرسال الطلب'
                    )}
                  </Button>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* ======================================================
            AUTH INVITE — only when not authenticated.
            Shroomi #3 of 3 (alternate path): balloons mascot.
            When unauthenticated, the booking summary is hidden,
            so total Shroomi count remains exactly 3:
            hero (party-big) + themes (gift-magic) + auth (balloons).
            ====================================================== */}
        {!isAuthenticated && (
          <div className="pk-auth-invite mt-8">
            <div className="pk-auth-invite__shroomi" aria-hidden="true">
              <Shroomi pose="balloons" size={92} className="shroomi-pop-in" />
            </div>
            <p className="text-base font-semibold text-slate-800 mb-4">
              سجّل الدخول أو أنشئ حساب لحجز حفلة
            </p>
            <div className="flex gap-3 justify-center flex-wrap">
              <Button
                onClick={() => navigate('/login')}
                variant="outline"
                className="rounded-full border-slate-300 hover:border-slate-400"
              >
                تسجيل الدخول
              </Button>
              <Button
                onClick={() => navigate('/register')}
                className="rounded-full bg-slate-900 hover:bg-slate-800 text-white"
              >
                إنشاء حساب
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
