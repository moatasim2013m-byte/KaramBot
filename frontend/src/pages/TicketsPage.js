import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Calendar } from '../components/ui/calendar';
import { Textarea } from '../components/ui/textarea';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { toast } from 'sonner';
import { format, addDays } from 'date-fns';
import { Clock, Users, Loader2, AlertCircle, Star, Sun, Moon, Check, Cloud, Sparkles } from 'lucide-react';
import { PaymentMethodSelector } from '../components/PaymentMethodSelector';
import mascotImg from '../assets/mascot.png';

// Morning pricing constant
const MORNING_PRICE_PER_HOUR = 3.5;

const SNAP_CURRENCY = 'JOD';

const toSha256Hex = async (value) => {
  if (!value || !window?.crypto?.subtle) return '';
  const normalized = String(value).trim().toLowerCase();
  if (!normalized) return '';
  const buffer = await window.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(normalized)
  );
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

const getOrCreateSnapUuid = () => {
  const key = 'pk_snap_uuid_c1';
  const existing = localStorage.getItem(key);
  if (existing) return existing;

  const generated = window.crypto?.randomUUID
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  localStorage.setItem(key, generated);
  return generated;
};

// Check if morning period has expired for a given date
const isMorningExpiredForDate = (selectedDate) => {
  if (!selectedDate) return false;
  
  // Check if selected date is today (in Amman timezone)
  const now = new Date();
  const ammanFormatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Amman',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const todayInAmman = ammanFormatter.format(now); // YYYY-MM-DD format
  
  // Format selected date as YYYY-MM-DD for comparison
  const selectedDateStr = selectedDate.toISOString().split('T')[0];
  
  // If selected date is not today in Amman, morning is available
  if (selectedDateStr !== todayInAmman) return false;
  
  // Get current hour in Asia/Amman timezone
  const hourFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Amman',
    hour: 'numeric',
    hour12: false
  });
  const ammanHour = parseInt(hourFormatter.format(now), 10);
  
  // Morning ends at 14:00 (2 PM) Amman time
  return ammanHour >= 14;
};

export default function TicketsPage() {
  const { isAuthenticated, api, user } = useAuth();
  const navigate = useNavigate();
  
  // Step 1: Time mode (morning/afternoon)
  const [timeMode, setTimeMode] = useState(null); // 'morning' or 'afternoon'
  // Step 2: Date
  const [date, setDate] = useState(null);
  // Step 3: Duration
  const [selectedDuration, setSelectedDuration] = useState(null);
  // Step 4: Slots (lazy loaded)
  const [slots, setSlots] = useState([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [slotsError, setSlotsError] = useState(null);
  const slotsCache = useRef(new Map());
  const [children, setChildren] = useState([]);
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [selectedChildren, setSelectedChildren] = useState([]);
  const [customNotes, setCustomNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [pricing, setPricing] = useState([]);
  const [extraHourText, setExtraHourText] = useState('');
  const [products, setProducts] = useState([]);
  const [selectedProductQty, setSelectedProductQty] = useState({});
  const [couponCode, setCouponCode] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState(null);
  const [applyingCoupon, setApplyingCoupon] = useState(false);

  // Set page title
  useEffect(() => {
    document.title = 'احجز وقت اللعب | بيكابو';
  }, []);

  // When returning from external card pages (back/failed/cancel), browsers may
  // restore this page from bfcache with stale component state.
  // Ensure we never stay stuck in a loading state after coming back.
  useEffect(() => {
    const clearLoadingState = () => {
      if (document.visibilityState && document.visibilityState !== 'visible') {
        return;
      }
      setLoading(false);
    };

    clearLoadingState();
    window.addEventListener('pageshow', clearLoadingState);
    document.addEventListener('visibilitychange', clearLoadingState);

    return () => {
      window.removeEventListener('pageshow', clearLoadingState);
      document.removeEventListener('visibilitychange', clearLoadingState);
    };
  }, []);

  // Fetch children on mount
  useEffect(() => {
    fetchProducts();
    if (isAuthenticated) {
      fetchChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Fetch pricing when timeMode changes
  useEffect(() => {
    if (timeMode) {
      fetchPricing(timeMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMode]);

  // Lazy fetch slots ONLY when all 3 selections are made
  useEffect(() => {
    if (!timeMode || !date || !selectedDuration) {
      setSlots([]);
      setSelectedSlot(null);
      return;
    }
    
    const dateStr = format(date, 'yyyy-MM-dd');
    const cacheKey = `${dateStr}-${selectedDuration}-${timeMode}`;
    
    // Check cache first
    if (slotsCache.current.has(cacheKey)) {
      setSlots(slotsCache.current.get(cacheKey));
      return;
    }
    
    // Fetch slots with timeMode and duration
    fetchSlots(dateStr, cacheKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeMode, date, selectedDuration]);

  // Reset selections when timeMode changes
  const handleTimeModeChange = (mode) => {
    if (mode !== timeMode) {
      setTimeMode(mode);
      setSelectedDuration(null);
      setSelectedSlot(null);
      setSlots([]);
      setPricing([]);
    }
  };

  const fetchPricing = async () => {
    try {
      const response = await api.get(`/payments/hourly-pricing?timeMode=${timeMode}`);
      setPricing(response.data.pricing || []);
      setExtraHourText(response.data.extra_hour_text || '');
    } catch (error) {
      console.error('Failed to fetch pricing:', error);
      // Fallback pricing
      if (timeMode === 'morning') {
        setPricing([
          { hours: 1, price: 3.5, label_ar: 'ساعة واحدة' },
          { hours: 2, price: 7, label_ar: 'ساعتان' },
          { hours: 3, price: 10.5, label_ar: '3 ساعات' }
        ]);
        setExtraHourText('كل ساعة = 3.5 دينار فقط (عرض الصباح)');
      }
    }
  };


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
      if (qty <= 0) {
        delete next[productId];
      } else {
        next[productId] = qty;
      }
      return next;
    });
  };

  const buildLineItems = () => products
    .filter((product) => (selectedProductQty[product.id] || 0) > 0)
    .map((product) => ({
      productId: product.id,
      quantity: selectedProductQty[product.id]
    }));

  const getProductsTotal = () => products.reduce((sum, product) => (
    sum + ((selectedProductQty[product.id] || 0) * (Number(product.priceJD) || 0))
  ), 0);

  const trackSnapAddCart = async ({ amount, lineItems }) => {
    if (typeof window.snaptr !== 'function') return;

    const fullName = (user?.name || '').trim();
    const [firstName, ...restNames] = fullName.split(/\s+/).filter(Boolean);
    const lastName = restNames.join(' ');

    const selectedChildRecords = children.filter((child) => selectedChildren.includes(child.id));
    const childAges = selectedChildRecords
      .map((child) => Number(child.age))
      .filter((age) => Number.isFinite(age) && age > 0);

    const productCount = lineItems.reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
    const itemIds = [
      `hourly-${selectedSlot?.id || 'unknown'}`,
      ...lineItems.map((item) => item.productId)
    ];

    const payload = {
      price: Number(amount.toFixed(2)),
      currency: SNAP_CURRENCY,
      item_ids: itemIds,
      item_category: 'hourly_booking',
      number_items: Math.max(selectedChildren.length, 1) + productCount,
      uuid_c1: getOrCreateSnapUuid(),
      transaction_id: `hourly-${selectedSlot?.id || 'slot'}-${Date.now()}`,
      success: 1,
      user_email: user?.email || '',
      user_phone_number: user?.phone || '',
      user_hashed_email: await toSha256Hex(user?.email),
      user_hashed_phone_number: await toSha256Hex(user?.phone),
      firstname: firstName || '',
      lastname: lastName || '',
      age: childAges.length ? Math.round(childAges.reduce((sum, age) => sum + age, 0) / childAges.length).toString() : ''
    };

    window.snaptr('track', 'ADD_CART', payload);
  };

  const fetchChildren = async () => {
    try {
      const response = await api.get('/profile/children');
      setChildren(response.data.children || []);
    } catch (error) {
      console.error('Failed to fetch children:', error);
    }
  };

  const fetchSlots = async (dateStr, cacheKey) => {
    setSlotsLoading(true);
    setSlotsError(null);
    setSelectedSlot(null);
    try {
      const response = await api.get(
        `/slots/available?date=${dateStr}&slot_type=hourly&timeMode=${timeMode}&duration=${selectedDuration}`
      );
      const fetchedSlots = response.data.slots || [];
      // Cache the result
      slotsCache.current.set(cacheKey, fetchedSlots);
      setSlots(fetchedSlots);
    } catch (error) {
      console.error('Failed to fetch slots:', error);
      setSlotsError('فشل تحميل الأوقات المتاحة');
      toast.error('فشل تحميل الأوقات المتاحة');
    } finally {
      setSlotsLoading(false);
    }
  };

  // Filter slots based on selected duration AND time mode
  const getFilteredSlots = () => {
    return slots.filter(slot => {
      const [hours, minutes] = slot.start_time.split(':').map(Number);
      const startMinutes = hours * 60 + minutes;
      const endMinutes = startMinutes + (selectedDuration * 60);
      
      // Must not pass midnight (00:00)
      if (endMinutes > 1440) return false;
      
      // Filter by time mode
      if (timeMode === 'morning') {
        // Morning (Happy Hour): 10:00 to 13:59
        return hours >= 10 && hours < 14;
      } else {
        // Afternoon: 14:00 onwards
        return hours >= 14;
      }
    });
  };

  // Calculate end time for a slot based on duration
  const getEndTime = (startTime, duration) => {
    const [hours, minutes] = startTime.split(':').map(Number);
    const totalMinutes = hours * 60 + minutes + (duration * 60);
    const endHours = Math.floor(totalMinutes / 60);
    const endMinutes = totalMinutes % 60;
    return `${String(endHours).padStart(2, '0')}:${String(endMinutes).padStart(2, '0')}`;
  };

  const handleBooking = async () => {
    if (!isAuthenticated) {
      toast.error('الرجاء تسجيل الدخول للحجز');
      navigate('/login');
      return;
    }

    if (!selectedSlot || selectedChildren.length === 0 || !selectedDuration) {
      toast.error('الرجاء اختيار الوقت والطفل والمدة');
      return;
    }

    // Check if enough capacity for all children
    if (selectedSlot.available_spots < selectedChildren.length) {
      toast.error(`عذراً، المتاح ${selectedSlot.available_spots} مكان فقط. اخترت ${selectedChildren.length} أطفال.`);
      return;
    }

    setLoading(true);
    try {
      // Calculate amount using Happy Hour logic
      const amount = getFinalTotal();
      const lineItems = buildLineItems();
      await trackSnapAddCart({ amount, lineItems });
      
      if (paymentMethod === 'card') {
        // Online card provider checkout flow
        const response = await api.post('/payments/create-checkout', {
          type: 'hourly',
          reference_id: selectedSlot.id,
          child_ids: selectedChildren,
          duration_hours: selectedDuration,
          slot_start_time: selectedSlot.start_time, // Pass slot time for Happy Hour calculation
          custom_notes: customNotes.trim(),
          origin_url: window.location.origin,
          timeMode: timeMode, // Pass timeMode for server-side pricing
          lineItems,
          coupon_code: appliedCoupon?.code
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
        const response = await api.post('/bookings/hourly/offline', {
          slot_id: selectedSlot.id,
          child_ids: selectedChildren,
          duration_hours: selectedDuration,
          slot_start_time: selectedSlot.start_time, // Pass slot time for Happy Hour calculation
          custom_notes: customNotes.trim(),
          payment_method: paymentMethod,
          lineItems,
          coupon_code: appliedCoupon?.code
        });
        
        // Get child name(s) for confirmation
        const selectedChildNames = children
          .filter(c => selectedChildren.includes(c.id))
          .map(c => c.name)
          .join('، ');
        
        // Navigate to confirmation page with booking details
        const confirmationData = {
          bookingId: response.data.bookings?.[0]?.id,
          bookingCode: response.data.bookings?.[0]?.booking_code,
          bookingType: 'hourly',
          childName: selectedChildNames,
          date: selectedSlot.date,
          time: selectedSlot.start_time,
          duration: selectedDuration,
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

  const getSelectedPrice = () => {
    if (!selectedDuration) return 0;
    const selected = pricing.find(p => p.hours === selectedDuration);
    const basePrice = selected ? selected.price : 0;
    return basePrice * Math.max(1, selectedChildren.length);
  };

  // Helper function for Happy Hour pricing (10:00-14:00)
  const getSlotPrice = (startTime) => {
    if (!startTime) return null;
    
    // Parse the time string (format: "HH:mm")
    const [hours] = startTime.split(':').map(Number);
    
    // Happy Hour: 10:00 to 13:59 (before 14:00)
    const isHappyHour = hours >= 10 && hours < 14;
    
    if (isHappyHour) {
      return 3.5; // Happy Hour price per hour
    }
    
    // Normal price from pricing data
    const selected = pricing.find(p => p.hours === selectedDuration);
    return selected ? selected.price / selected.hours : null;
  };


  const getBaseBookingTotal = () => {
    if (selectedSlot) {
      return parseFloat(getSlotTotalPrice(selectedSlot.start_time)) * Math.max(1, selectedChildren.length);
    }
    return getSelectedPrice();
  };

  const getGrandTotal = () => getBaseBookingTotal() + getProductsTotal();
  const getDiscountAmount = () => Number(appliedCoupon?.discount_amount || 0);
  const getFinalTotal = () => Math.max(0, getGrandTotal() - getDiscountAmount());

  const getSlotTotalPrice = (startTime) => {
    const pricePerHour = getSlotPrice(startTime);
    if (!pricePerHour) return null;
    return (pricePerHour * selectedDuration).toFixed(1);
  };

  const toggleChildSelection = (childId) => {
    setSelectedChildren(prev => 
      prev.includes(childId) 
        ? prev.filter(id => id !== childId)
        : [...prev, childId]
    );
  };

  const handleApplyCoupon = async () => {
    if (!couponCode.trim()) {
      toast.error('الرجاء إدخال كود الخصم');
      return;
    }

    setApplyingCoupon(true);
    try {
      const response = await api.post('/coupons/validate', {
        code: couponCode.trim(),
        amount: getGrandTotal(),
        type: 'hourly'
      });
      setAppliedCoupon({
        code: response.data.coupon.code,
        discount_amount: response.data.discount_amount
      });
      toast.success(`تم تطبيق الكوبون (${response.data.discount_amount.toFixed(1)} دينار خصم)`);
    } catch (error) {
      setAppliedCoupon(null);
      toast.error(error.response?.data?.error || 'فشل تطبيق الكوبون');
    } finally {
      setApplyingCoupon(false);
    }
  };

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const maxDate = addDays(new Date(), 30);

  // Check if morning is expired for selected date
  const morningExpired = isMorningExpiredForDate(date);

  // Skeleton loader for slots
  const SlotsSkeleton = () => (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3" aria-hidden="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="calendar-skeleton p-4">
          <div className="h-5 bg-muted/70 rounded w-24 mx-auto mb-2"></div>
          <div className="h-4 bg-muted/70 rounded w-16 mx-auto"></div>
        </div>
      ))}
    </div>
  );

  const activeStep = !date ? 1 : !timeMode ? 2 : !selectedDuration ? 3 : 4;
  const stepPills = [
    { id: 1, label: '1 التاريخ', complete: Boolean(date) },
    { id: 2, label: '2 الفترة', complete: Boolean(timeMode) },
    { id: 3, label: '3 المدة', complete: Boolean(selectedDuration) },
    { id: 4, label: '4 الوقت', complete: Boolean(selectedSlot) }
  ];

  const periodLabel = timeMode === 'morning' ? 'صباحي' : timeMode === 'afternoon' ? 'مسائي' : '---';

  return (
    <div className="min-h-screen py-6 md:py-12 booking-mobile-page tickets-themed-page" dir="rtl">
      <div className="page-shell booking-mobile-shell tickets-themed-wrap px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="text-center mb-8">
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3">
            احجز وقت اللعب
          </h1>
          <div className="booking-hero-intro" aria-label="مقدمة الحجز">
            <span className="booking-hero-badge">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
              تصميم مرح وتجربة أسهل
            </span>
            <div className="shroomi-promo shroomi-promo--booking shroomi-promo--mega">
              <img src={mascotImg} alt="Shroomi with ticket" className="shroomi-promo__img shroomi-promo__img--ticket shroomi-promo__img--ticket-mega" />
              <span className="shroomi-promo__text shroomi-promo__text--mega">احجز جلستك!</span>
              <span className="shroomi-promo__subtext">خلّي المرح يبدأ الآن 🎉</span>
            </div>
          </div>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
            اختر التاريخ، الفترة، المدة، ثم الوقت المناسب
          </p>
          
          <div className="booking-step-pills mt-6" role="list" aria-label="مراحل الحجز">
            {stepPills.map((step) => (
              <span
                key={step.id}
                role="listitem"
                className={`booking-step-pill ${step.complete ? 'is-complete' : ''} ${activeStep === step.id && !step.complete ? 'is-active' : ''}`}
              >
                {step.complete ? <Check className="h-4 w-4" /> : null}
                {step.label}
              </span>
            ))}
          </div>
        </div>

        {/* STEP 1: Date Selection */}
        <Card className="booking-card booking-card-calendar mb-6">
          <CardHeader className="booking-card-header">
            <CardTitle className="booking-card-title">
              <span className={`step-badge ${date ? 'step-badge-complete' : ''}`}>1</span>
              اختر التاريخ
            </CardTitle>
          </CardHeader>
          <CardContent className="flex justify-center py-6">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(d) => {
                if (d) {
                  setDate(d);
                  if (timeMode === 'morning' && isMorningExpiredForDate(d)) {
                    setTimeMode(null);
                    setPricing([]);
                  }
                  setSelectedSlot(null);
                  setSelectedDuration(null);
                  setSlots([]);
                }
              }}
              disabled={(d) => d < todayStart || d > maxDate}
              className="rounded-xl booking-calendar"
            />
          </CardContent>
        </Card>

        {/* STEP 2: Time Mode Selection */}
        {date && (
          <Card className="booking-card mb-6">
            <CardHeader className="booking-card-header">
              <CardTitle className="booking-card-title">
                <span className={`step-badge ${timeMode ? 'step-badge-complete' : ''}`}>2</span>
                اختر الفترة
              </CardTitle>
            </CardHeader>
            <CardContent className="py-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <button
                  onClick={() => !morningExpired && handleTimeModeChange('morning')}
                  disabled={morningExpired}
                  className={`option-btn cartoon-option period-card morning-option ${timeMode === 'morning' ? 'selected-yellow' : ''} ${morningExpired ? 'opacity-50 cursor-not-allowed disabled-period' : ''}`}
                >
                  <span className="cartoon-blob morning-blob" aria-hidden="true"></span>
                  <div className="flex items-center justify-between gap-3 pt-2 px-2">
                    <span className="period-icon-circle period-icon-circle-morning"><Sun className={`h-7 w-7 shrink-0 ${morningExpired ? 'text-gray-400' : 'text-blue-500'}`} /></span>
                    <div className="flex-1 min-w-0 text-right">
                      <div className={`font-heading text-xl font-bold ${morningExpired ? 'text-gray-400' : ''}`}>صباحي</div>
                      <div className="text-sm text-muted-foreground">10 ص - 2 م</div>
                      {morningExpired && (
                        <div className="text-xs text-red-500 mt-1 flex items-center gap-1 justify-end"><Cloud className="h-3.5 w-3.5" /> غير متاح اليوم</div>
                      )}
                    </div>
                    {timeMode === 'morning' && !morningExpired && <span className="period-check"><Check className="h-4 w-4" /></span>}
                  </div>
                </button>
                
                <button
                  onClick={() => handleTimeModeChange('afternoon')}
                  className={`option-btn cartoon-option period-card afternoon-option ${timeMode === 'afternoon' ? 'selected-afternoon' : ''}`}
                >
                  <span className="cartoon-blob afternoon-blob" aria-hidden="true"></span>
                  <div className="flex items-center justify-between gap-3 px-2">
                    <span className="period-icon-circle period-icon-circle-afternoon"><Moon className="h-7 w-7 shrink-0 text-slate-600" /></span>
                    <div className="flex-1 min-w-0 text-right">
                      <div className="font-heading text-xl font-bold">مسائي</div>
                      <div className="text-sm text-muted-foreground">2 م - 12 ص</div>
                    </div>
                    {timeMode === 'afternoon' && <span className="period-check"><Check className="h-4 w-4" /></span>}
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 3: Duration Selection */}
        {date && timeMode && (
          <Card className="booking-card mb-6">
            <CardHeader className="booking-card-header">
              <CardTitle className="booking-card-title">
                <span className={`step-badge ${selectedDuration ? 'step-badge-complete' : ''}`}>3</span>
                اختر مدة اللعب
              </CardTitle>
              {extraHourText && <CardDescription className="text-sm mt-1 mr-10">{extraHourText}</CardDescription>}
            </CardHeader>
            <CardContent className="py-6">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                {pricing.map((option) => (
                  <button
                    key={option.hours}
                    onClick={() => {
                      setSelectedDuration(option.hours);
                      setSelectedSlot(null);
                    }}
                    className={`option-btn duration-pill ${selectedDuration === option.hours ? (timeMode === 'morning' ? 'selected-yellow' : 'selected-afternoon') : ''}`}
                  >
                    {option.best_value && (
                      <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-orange-400 to-orange-600 text-white text-xs">
                        <Star className="h-3 w-3 ml-1" />
                        أفضل قيمة
                      </Badge>
                    )}
                    <div className="pt-1">
                      <div className="font-heading text-2xl font-bold mb-1">{option.label_ar}</div>
                      <div className={`text-xl font-bold ${timeMode === 'morning' ? 'text-yellow-600' : 'text-slate-600'}`}>
                        {option.price} دينار
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* STEP 4: Time Slots */}
        {timeMode && date && selectedDuration && (
          <Card className="booking-card mb-6">
            <CardHeader className="booking-card-header">
              <CardTitle className="booking-card-title">
                <span className={`step-badge ${selectedSlot ? 'step-badge-complete' : ''}`}>4</span>
                <Clock className="h-5 w-5 text-primary" />
                الأوقات المتاحة
              </CardTitle>
              <CardDescription className="mr-10 text-sm">
                {format(date, 'MMMM d')} • {timeMode === 'morning' ? '10 ص - 2 م' : '2 م - 12 ص'}
              </CardDescription>
            </CardHeader>
            <CardContent className="py-6">
              {slotsLoading ? (
                <div className="soft-loading-state">
                  <p className="text-center text-muted-foreground mb-4">جاري تحميل الأوقات...</p>
                  <SlotsSkeleton />
                </div>
              ) : slotsError ? (
                <div className="soft-loading-state text-center py-8 text-destructive">
                  <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p>{slotsError}</p>
                </div>
              ) : slots.filter(s => s.is_available).length === 0 ? (
                <div className="soft-loading-state text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-10 w-10 mx-auto mb-3 opacity-50" />
                  <p>لا توجد أوقات متاحة لهذه الفترة</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {slots.filter(s => s.is_available).map((slot) => {
                    const endTime = getEndTime(slot.start_time, selectedDuration);
                    
                    return (
                      <button
                        key={slot.id}
                        onClick={() => setSelectedSlot(slot)}
                        className={`slot-btn slot-pill ${selectedSlot?.id === slot.id ? (timeMode === 'morning' ? 'selected-yellow' : 'selected-afternoon') : ''}`}
                      >
                        <div dir="ltr" className="font-heading font-semibold">
                          {slot.start_time} → {endTime}
                        </div>
                        <div className="flex items-center justify-center gap-1 text-xs text-muted-foreground mt-1">
                          <Users className="h-3 w-3" />
                          {slot.available_spots} متاح
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Booking Summary */}
        {isAuthenticated && selectedSlot && (
          <Card className="booking-card">
            <CardHeader className="booking-card-header">
              <CardTitle className="booking-card-title">أكمل حجزك</CardTitle>
            </CardHeader>
            <CardContent className="py-6">
              <div className="grid grid-cols-1 gap-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <Label className="block text-sm font-medium mb-2">اختر الأطفال</Label>
                    {children.length === 0 ? (
                      <div className="text-muted-foreground">
                        <p className="mb-2 text-sm">لم يتم إضافة أطفال بعد</p>
                        <Button variant="outline" size="sm" onClick={() => navigate('/profile')} className="rounded-full">
                          إضافة طفل
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {children.map((child) => (
                          <label 
                            key={child.id} 
                            className={`flex items-center gap-3 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                              selectedChildren.includes(child.id) ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50'
                            }`}
                          >
                            <input
                              type="checkbox"
                              checked={selectedChildren.includes(child.id)}
                              onChange={() => toggleChildSelection(child.id)}
                              className="w-5 h-5 rounded accent-primary"
                            />
                            <span className="font-medium">{child.name}</span>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <Label className="block text-sm font-medium mb-2">الوقت المختار</Label>
                    <div className="p-3 rounded-xl bg-muted text-sm">
                      <span className="font-semibold">{format(date, 'MMM d')} في {selectedSlot.start_time}</span>
                      <div className="text-muted-foreground mt-1">
                        {timeMode === 'morning' ? '☀️ صباحية' : '🌙 مسائية'}
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="block text-sm font-medium mb-2">المدة والسعر</Label>
                    <div className={`p-3 rounded-xl border-2 ${timeMode === 'morning' ? 'bg-yellow-50 border-yellow-400' : 'bg-primary/10 border-primary'}`}>
                      <div className={`font-bold text-lg ${timeMode === 'morning' ? 'text-yellow-700' : 'text-primary'}`}>
                        {selectedDuration} ساعة - {getSelectedPrice()} د
                      </div>
                      {timeMode === 'morning' && <div className="text-xs text-yellow-600 mt-1">عرض الصباح</div>}
                    </div>
                  </div>
                </div>

                {products.length > 0 && (
                  <div>
                    <Label className="block text-sm font-medium mb-2">إضافات</Label>
                    <div className="space-y-2">
                      {products.map((product) => {
                        const qty = selectedProductQty[product.id] || 0;
                        return (
                          <div key={product.id} className="flex items-center justify-between rounded-xl border p-3">
                            <div>
                              <p className="font-medium">{product.nameAr}</p>
                              <p className="text-xs text-muted-foreground">{product.priceJD} د</p>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => updateProductQty(product.id, qty - 1)}>-</Button>
                              <span className="min-w-6 text-center">{qty}</span>
                              <Button type="button" variant="outline" size="sm" onClick={() => updateProductQty(product.id, qty + 1)}>+</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div>
                  <Label htmlFor="custom-notes" className="block text-sm font-medium mb-2">ملاحظات (اختياري)</Label>
                  <Textarea
                    id="custom-notes"
                    value={customNotes}
                    onChange={(e) => setCustomNotes(e.target.value)}
                    placeholder="أي ملاحظات أو طلبات خاصة..."
                    className="rounded-xl resize-none"
                    rows={2}
                  />
                </div>

                <div className="pt-4 border-t">
                  <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                </div>

                <div>
                  <Label className="block text-sm font-medium mb-2">كوبون الخصم</Label>
                  <div className="flex gap-2">
                    <Input
                      value={couponCode}
                      onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                      placeholder="مثال: PEEK10"
                      className="rounded-xl"
                    />
                    <Button type="button" variant="outline" onClick={handleApplyCoupon} disabled={applyingCoupon}>
                      {applyingCoupon ? '...' : 'تطبيق'}
                    </Button>
                  </div>
                  {appliedCoupon && (
                    <p className="text-sm text-green-600 mt-2">تم تطبيق الكوبون: {appliedCoupon.code}</p>
                  )}
                </div>

                {paymentMethod && (
                  <div className="booking-summary">
                    <p className="text-sm text-muted-foreground mb-1">ملخص الحجز</p>
                    <p className="font-bold">
                      {selectedSlot 
                        ? `${selectedDuration} ساعة × ${selectedChildren.length || 1} طفل = ${(parseFloat(getSlotTotalPrice(selectedSlot.start_time)) * Math.max(1, selectedChildren.length)).toFixed(1)} دينار`
                        : `${selectedDuration} ساعة × ${selectedChildren.length || 1} طفل = ${getSelectedPrice()} دينار`
                      }
                    </p>
                    <p className="text-sm text-muted-foreground">إضافات: {getProductsTotal().toFixed(1)} دينار</p>
                    <p className="text-sm text-green-700">الخصم: -{getDiscountAmount().toFixed(1)} دينار</p>
                    <p className="font-semibold">الإجمالي: {getFinalTotal().toFixed(1)} دينار</p>
                  </div>
                )}

                {/* Sticky CTA Container */}
                <div className="booking-sticky-wrap mt-6">
                  <div className="booking-sticky-summary-bar">
                    <div className="booking-sticky-summary__meta">
                      <span>🗓 {format(date, 'dd/MM')}</span>
                      <span>⏰ {periodLabel}</span>
                      <span>⏱ {selectedDuration} س</span>
                      <span>💰 {getFinalTotal().toFixed(1)} د</span>
                    </div>
                  </div>
                  <div className="booking-sticky-summary">
                    <Button
                      onClick={handleBooking}
                      disabled={!selectedSlot || selectedChildren.length === 0 || loading}
                      className={`w-full px-8 rounded-full h-12 text-base ${timeMode === 'morning' ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'btn-playful'}`}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                          جاري المعالجة...
                        </>
                      ) : (
                        <span>احجز - {getFinalTotal().toFixed(1)} د</span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {!isAuthenticated && (
          <Card className="booking-card booking-auth-card">
            <CardContent className="py-8 text-center">
              <p className="text-2xl font-bold mb-2">جاهزين للعب؟ 🎈</p>
              <p className="text-muted-foreground mb-5">انضموا لعائلة بيكابو وسنجهز لكم جلسة لعب ممتعة وآمنة.</p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Button onClick={() => navigate('/login')} variant="outline" className="rounded-full border-2 border-[#00BBF9] text-[#008ab9] font-bold">
                  تسجيل الدخول
                </Button>
                <Button onClick={() => navigate('/register')} className="rounded-full btn-playful bg-[#FF595E] hover:bg-[#f1464b] font-bold">
                  إنشاء حساب
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
