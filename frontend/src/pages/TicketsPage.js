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
import Shroomi from '../components/Shroomi';

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
  const [guestChildCount, setGuestChildCount] = useState(1);
  const [guestChildName, setGuestChildName] = useState('');

  // Guest checkout state — used when the user proceeds without an account.
  const [guestMode, setGuestMode] = useState(null); // null = path-selector shown, 'form' = guest form shown
  const [guestParentName, setGuestParentName] = useState('');
  const [guestParentPhone, setGuestParentPhone] = useState('');
  const [guestParentEmail, setGuestParentEmail] = useState('');
  const [guestPaymentMethod, setGuestPaymentMethod] = useState('cash');
  const [guestCouponCode, setGuestCouponCode] = useState('');

  // Phase 6 — loyalty redemption state.
  // loyaltyBalance: numeric points available for this user (null = not
  // loaded yet). loyaltyPolicy: minimum policy fields returned with the
  // balance — we use `enabled`, `redeem_min_points`,
  // `redeem_max_jd_per_booking`, `points_per_jd_redeem`.
  // useLoyalty: parent toggled "apply points" on. pointsToUse: the
  // numeric amount the backend confirmed would be spent for this amount.
  // discountJd: matching JD discount. These two values come directly
  // from `/api/loyalty/redemption-preview`, which is the authoritative
  // source — the UI never computes the conversion itself.
  const [loyaltyBalance, setLoyaltyBalance] = useState(null);
  const [loyaltyPolicy, setLoyaltyPolicy] = useState(null);
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [loyaltyPointsInput, setLoyaltyPointsInput] = useState('');
  const [loyaltyUseMax, setLoyaltyUseMax] = useState(true);
  const [loyaltyPreview, setLoyaltyPreview] = useState(null); // { ok, pointsToUse, discountJd, reason, maxPointsAllowed }
  const [loyaltyPreviewLoading, setLoyaltyPreviewLoading] = useState(false);

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
      fetchLoyaltyBalance();
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

  // Phase 6 — loyalty redemption preview. Re-computes whenever the base
  // (post-coupon) amount or the parent's redemption choice changes. The
  // backend is the source of truth for `pointsToUse` / `discountJd`
  // so we never trust a locally computed conversion. Debounced by 300ms
  // to avoid spamming the endpoint while the input changes.
  //
  // NOTE: the amount is computed inside the effect (not hoisted above)
  // because the helper functions getBaseBookingTotal / getProductsTotal
  // are `const` arrow functions declared later in the component body.
  // Closures make them available at effect-run time, so computing here
  // is safe and avoids a TDZ error at render time.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (!useLoyalty) {
      setLoyaltyPreview(null);
      return;
    }
    if (paymentMethod !== 'card') {
      setLoyaltyPreview(null);
      return;
    }
    const amountAfterCoupon = (!selectedSlot || !selectedDuration)
      ? 0
      : Math.max(0, getBaseBookingTotal() + getProductsTotal() - Number(appliedCoupon?.discount_amount || 0));
    if (!amountAfterCoupon || amountAfterCoupon <= 0) {
      setLoyaltyPreview(null);
      return;
    }
    const inputPoints = Math.max(0, parseInt(loyaltyPointsInput, 10) || 0);
    const useMax = loyaltyUseMax || inputPoints <= 0;
    setLoyaltyPreviewLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await api.get('/loyalty/redemption-preview', {
          params: {
            amount_jd: amountAfterCoupon,
            points: useMax ? 0 : inputPoints,
            use_max: useMax ? 'true' : 'false'
          }
        });
        setLoyaltyPreview(res.data);
      } catch (error) {
        const data = error?.response?.data;
        setLoyaltyPreview({ ok: false, reason: data?.reason || 'preview_failed' });
      } finally {
        setLoyaltyPreviewLoading(false);
      }
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, useLoyalty, loyaltyUseMax, loyaltyPointsInput, paymentMethod, selectedSlot, selectedDuration, products, appliedCoupon, timeMode, date, selectedChildren, guestChildCount]);

  // When the parent switches away from card, clear any active redemption
  // so the sticky total doesn't show a discount that won't be honoured.
  useEffect(() => {
    if (paymentMethod !== 'card' && useLoyalty) {
      setUseLoyalty(false);
      setLoyaltyPreview(null);
    }
  }, [paymentMethod, useLoyalty]);

  // Reset the guest path-selector whenever the user picks a different slot.
  useEffect(() => {
    setGuestMode(null);
  }, [selectedSlot]);

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

  // Phase 6 — fetch the parent's loyalty balance + redemption policy.
  // Silent on failure: redemption is an optional convenience; any
  // network / permission error just means we don't show the UI.
  const fetchLoyaltyBalance = async () => {
    try {
      const response = await api.get('/loyalty/balance');
      const points = Number(response.data?.pointsAvailable || 0);
      setLoyaltyBalance(Number.isFinite(points) ? points : 0);
      setLoyaltyPolicy(response.data?.redemption || null);
    } catch (error) {
      setLoyaltyBalance(null);
      setLoyaltyPolicy(null);
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

    if (!selectedSlot || !selectedDuration) {
      toast.error('الرجاء اختيار الوقت والمدة');
      return;
    }

    // Check if enough capacity for all children
    if (selectedSlot.available_spots < getEffectiveChildCount()) {
      toast.error(`عذراً، المتاح ${selectedSlot.available_spots} مكان فقط.`);
      return;
    }

    setLoading(true);
    try {
      // Calculate amount using Happy Hour logic
      const amount = getFinalTotal();
      const lineItems = buildLineItems();
      await trackSnapAddCart({ amount, lineItems });
      
      if (paymentMethod === 'card') {
        // Build loyalty redemption payload. Only forward when the parent
        // opted-in and a preview returned OK so the gateway amount is
        // guaranteed to match the server's own recomputation.
        const loyaltyRedeemEnabled = useLoyalty && loyaltyPreview?.ok;
        // Online card provider checkout flow
        const response = await api.post('/payments/create-checkout', {
          type: 'hourly',
          reference_id: selectedSlot.id,
          child_ids: selectedChildren.length > 0 ? selectedChildren : undefined,
          child_count: selectedChildren.length === 0 ? guestChildCount : undefined,
          guest_child_name: selectedChildren.length === 0 ? guestChildName.trim() : undefined,
          duration_hours: selectedDuration,
          slot_start_time: selectedSlot.start_time, // Pass slot time for Happy Hour calculation
          custom_notes: customNotes.trim(),
          origin_url: window.location.origin,
          timeMode: timeMode, // Pass timeMode for server-side pricing
          lineItems,
          coupon_code: appliedCoupon?.code,
          ...(loyaltyRedeemEnabled
            ? {
                use_max_loyalty: !!loyaltyUseMax,
                loyalty_points: loyaltyUseMax
                  ? (loyaltyPreview?.pointsToUse || 0)
                  : Math.max(0, parseInt(loyaltyPointsInput, 10) || 0)
              }
            : {})
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
          child_ids: selectedChildren.length > 0 ? selectedChildren : undefined,
          child_count: selectedChildren.length === 0 ? guestChildCount : undefined,
          guest_child_name: selectedChildren.length === 0 ? guestChildName.trim() : undefined,
          duration_hours: selectedDuration,
          slot_start_time: selectedSlot.start_time, // Pass slot time for Happy Hour calculation
          custom_notes: customNotes.trim(),
          payment_method: paymentMethod,
          lineItems,
          coupon_code: appliedCoupon?.code
        });
        
        // Get child name(s) for confirmation
        const selectedChildNames = selectedChildren.length > 0
          ? children
              .filter(c => selectedChildren.includes(c.id))
              .map(c => c.name)
              .join('، ')
          : (guestChildName.trim() || `${guestChildCount} أطفال`);
        
        // Navigate to confirmation page with booking details
        const firstBooking = response.data.bookings?.[0];
        const confirmationData = {
          bookingId: firstBooking?.id,
          bookingCode: firstBooking?.booking_code,
          bookingType: 'hourly',
          childName: selectedChildNames,
          date: selectedSlot.date,
          time: selectedSlot.start_time,
          duration: selectedDuration,
          amount,
          paymentMethod,
          qrCode: firstBooking?.qr_code,
          qrToken: firstBooking?.qr_token,
          qrStatus: firstBooking?.qr_status || 'unused'
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

  // Guest checkout handler — no account required, cash/cliq only, no loyalty.
  const handleGuestBooking = async () => {
    if (!selectedSlot || !selectedDuration) {
      toast.error('الرجاء اختيار الوقت والمدة');
      return;
    }

    const trimmedName = guestParentName.trim();
    const trimmedPhone = guestParentPhone.trim();

    if (!trimmedName) {
      toast.error('الرجاء إدخال اسم ولي الأمر');
      return;
    }
    if (!trimmedPhone) {
      toast.error('الرجاء إدخال رقم الهاتف');
      return;
    }

    if (selectedSlot.available_spots < guestChildCount) {
      toast.error(`عذراً، المتاح ${selectedSlot.available_spots} مكان فقط.`);
      return;
    }

    setLoading(true);
    try {
      const lineItems = buildLineItems();

      const response = await api.post('/bookings/hourly/guest-offline', {
        slot_id: selectedSlot.id,
        duration_hours: selectedDuration,
        slot_start_time: selectedSlot.start_time,
        payment_method: guestPaymentMethod,
        parent_name: trimmedName,
        parent_phone: trimmedPhone,
        parent_email: guestParentEmail.trim() || undefined,
        child_count: guestChildCount,
        guest_child_name: guestChildName.trim() || undefined,
        custom_notes: customNotes.trim() || undefined,
        lineItems,
        coupon_code: guestCouponCode.trim() || undefined
      });

      const firstBooking = response.data.bookings?.[0];
      // Use the server-computed amount so coupon discounts are reflected.
      const confirmedAmount = firstBooking?.amount ?? (getBaseBookingTotal() + getProductsTotal());

      const confirmationData = {
        bookingId: firstBooking?.id,
        bookingCode: firstBooking?.booking_code,
        bookingType: 'hourly',
        childName: guestChildName.trim() || `${guestChildCount} أطفال`,
        date: selectedSlot.date,
        time: selectedSlot.start_time,
        duration: selectedDuration,
        amount: confirmedAmount,
        paymentMethod: guestPaymentMethod,
        qrCode: firstBooking?.qr_code,
        qrToken: firstBooking?.qr_token,
        qrStatus: firstBooking?.qr_status || 'unused',
        parentPhone: trimmedPhone,
        parentEmail: guestParentEmail.trim() || undefined,
        isGuestBooking: true
      };

      localStorage.setItem('pk_last_confirmation', JSON.stringify(confirmationData));
      navigate('/booking-confirmation', { state: confirmationData });
      setLoading(false);
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'فشل إنشاء الحجز');
      setLoading(false);
    }
  };

  const getEffectiveChildCount = () =>
    selectedChildren.length > 0 ? selectedChildren.length : guestChildCount;

  const getSelectedPrice = () => {
    if (!selectedDuration) return 0;
    const selected = pricing.find(p => p.hours === selectedDuration);
    const basePrice = selected ? selected.price : 0;
    return basePrice * getEffectiveChildCount();
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
      return parseFloat(getSlotTotalPrice(selectedSlot.start_time)) * getEffectiveChildCount();
    }
    return getSelectedPrice();
  };

  const getGrandTotal = () => getBaseBookingTotal() + getProductsTotal();
  const getDiscountAmount = () => Number(appliedCoupon?.discount_amount || 0);
  // Amount BEFORE loyalty redemption is applied. This is what we send to
  // `/loyalty/redemption-preview` so the backend can validate the points
  // spend against the actual payable.
  const getAmountAfterCoupon = () => Math.max(0, getGrandTotal() - getDiscountAmount());
  const getLoyaltyDiscount = () => {
    // Only counted when the parent has explicitly toggled loyalty on,
    // the card path is chosen (server refuses offline anyway), and the
    // preview says it's valid.
    if (!useLoyalty) return 0;
    if (paymentMethod !== 'card') return 0;
    if (!loyaltyPreview?.ok) return 0;
    return Number(loyaltyPreview.discountJd || 0);
  };
  const getFinalTotal = () => Math.max(0, getAmountAfterCoupon() - getLoyaltyDiscount());

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
    <div className="min-h-screen py-6 md:py-12 booking-mobile-page tickets-themed-page pk-booking-page" dir="rtl">
      <div className="page-shell booking-mobile-shell tickets-themed-wrap px-4 sm:px-6 lg:px-8">
        {/* Premium Booking Hero — replaces the legacy mega-mascot block.
            Cleaner hierarchy, soft gradient deco, RTL-friendly, and a
            single contextual Shroomi (clipboard-write) that frames him
            as the parent's booking journey guide. */}
        <div className="pk-booking-hero mb-6">
          <div className="pk-booking-hero__deco-yellow" aria-hidden="true"></div>
          <div className="pk-booking-hero__deco-blue" aria-hidden="true"></div>

          <div className="pk-booking-hero__shroomi shroomi-halo shroomi-halo--blue hidden md:block" aria-hidden="true">
            <Shroomi pose="clipboard-write" size={150} className="shroomi-float" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <span className="pk-hero-eyebrow">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              حجز سريع — 4 خطوات بسيطة
            </span>
            <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mt-3 mb-2">
              احجز وقت اللعب
            </h1>
            <p className="text-muted-foreground text-sm md:text-base max-w-md leading-relaxed">
              اختر التاريخ، الفترة، المدة، ثم الوقت المناسب — وشروومي يرافقك خطوة بخطوة.
            </p>

            {/* Premium step pills (replaces booking-step-pills). Same data,
                same a11y semantics — only visual polish. */}
            <div className="pk-stepper" role="list" aria-label="مراحل الحجز">
              {stepPills.map((step) => {
                const status = step.complete ? 'is-complete' : (activeStep === step.id ? 'is-active' : '');
                return (
                  <span key={step.id} role="listitem" className={`pk-stepper__item ${status}`}>
                    <span className="pk-stepper__num">
                      {step.complete ? <Check className="h-3.5 w-3.5" /> : step.id}
                    </span>
                    <span>{step.label.replace(/^\d\s*/, '')}</span>
                  </span>
                );
              })}
            </div>
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
          <Card className="booking-card relative overflow-visible">
            {/* Friendly thumbs-up Shroomi marks the "ready to book" zone. */}
            <div className="hidden sm:block absolute -top-8 left-4 z-10 shroomi-halo shroomi-halo--green" aria-hidden="true">
              <Shroomi pose="thumbs-up-big" size={88} className="shroomi-bob" />
            </div>
            <CardHeader className="booking-card-header">
              <CardTitle className="booking-card-title">أكمل حجزك</CardTitle>
            </CardHeader>
            <CardContent className="py-6">
              <div className="grid grid-cols-1 gap-5">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                  <div>
                    <Label className="block text-sm font-medium mb-2">اختر الأطفال</Label>
                    {children.length === 0 ? (
                      <div className="space-y-3">
                        <p className="text-sm text-muted-foreground">لا يوجد أطفال مسجلون — يمكنك الحجز مباشرة</p>
                        <div className="flex items-center gap-3">
                          <Label className="text-sm shrink-0">عدد الأطفال:</Label>
                          <div className="flex items-center gap-2">
                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 rounded-full p-0" onClick={() => setGuestChildCount(c => Math.max(1, c - 1))}>-</Button>
                            <span className="min-w-8 text-center font-bold text-lg">{guestChildCount}</span>
                            <Button type="button" variant="outline" size="sm" className="h-8 w-8 rounded-full p-0" onClick={() => setGuestChildCount(c => Math.min(20, c + 1))}>+</Button>
                          </div>
                        </div>
                        <Input
                          value={guestChildName}
                          onChange={(e) => setGuestChildName(e.target.value)}
                          placeholder="اسم الطفل (اختياري)"
                          className="rounded-xl"
                        />
                        <p className="text-xs text-muted-foreground">
                          تسجيل الطفل اختياري — يتيح لك رؤية تاريخ زياراته
                        </p>
                        <Button variant="outline" size="sm" onClick={() => navigate('/profile')} className="rounded-full text-xs">
                          سجّل طفلك للمزيد من المزايا ←
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
                        {selectedChildren.length === 0 && (
                          <p className="text-xs text-muted-foreground mt-1">
                            يمكنك المتابعة بدون اختيار طفل (سيُسجَّل حجز لطفل واحد)
                          </p>
                        )}
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

                {/* Phase 6 — loyalty redemption. Only shown when:
                    * the parent is authenticated and has a balance loaded,
                    * redemption is enabled by admin policy,
                    * the parent has reached the minimum points threshold,
                    * the selected payment method is card (offline methods
                      block redemption on the server, so we don't tempt
                      the UI into showing an unachievable discount). */}
                {isAuthenticated
                  && paymentMethod === 'card'
                  && loyaltyPolicy?.enabled
                  && Number(loyaltyBalance || 0) >= Number(loyaltyPolicy?.redeem_min_points || 0)
                  && Number(loyaltyPolicy?.redeem_min_points || 0) > 0
                  && (
                  <div className="pk-loyalty-card" data-testid="loyalty-redemption-card">
                    {/* Reward-themed Shroomi reinforces this is the "spend
                        points" zone. Decorative only — UI logic unchanged. */}
                    <div className="pk-loyalty-card__shroomi" aria-hidden="true">
                      <Shroomi pose="party-coins" size={80} className="shroomi-bob" />
                    </div>
                    <div className="flex items-center justify-between gap-3 mb-2 pl-16">
                      <div className="flex items-center gap-2">
                        <Star className="h-4 w-4 text-amber-600" />
                        <span className="font-bold text-sm text-amber-900">استخدام نقاط الولاء</span>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant={useLoyalty ? 'default' : 'outline'}
                        className="rounded-full"
                        onClick={() => setUseLoyalty((prev) => !prev)}
                        data-testid="loyalty-toggle-btn"
                      >
                        {useLoyalty ? 'مفعل' : 'استخدم'}
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>
                        رصيدك الحالي: <span className="font-semibold text-foreground">{Number(loyaltyBalance || 0)} نقطة</span>
                      </div>
                      <div>
                        معدل التحويل: كل {Number(loyaltyPolicy?.points_per_jd_redeem || 10)} نقطة = 1 دينار
                      </div>
                      <div>
                        الحد الأدنى للاسترداد: {Number(loyaltyPolicy?.redeem_min_points || 0)} نقطة
                      </div>
                      <div>
                        الحد الأقصى المسموح لهذا الحجز: {Number(loyaltyPolicy?.redeem_max_jd_per_booking || 0).toFixed(1)} دينار
                      </div>
                    </div>

                    {useLoyalty && (
                      <div className="mt-3 space-y-2">
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant={loyaltyUseMax ? 'default' : 'outline'}
                            className="rounded-full"
                            onClick={() => { setLoyaltyUseMax(true); setLoyaltyPointsInput(''); }}
                            data-testid="loyalty-use-max-btn"
                          >
                            استخدم الحد الأقصى
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant={!loyaltyUseMax ? 'default' : 'outline'}
                            className="rounded-full"
                            onClick={() => setLoyaltyUseMax(false)}
                            data-testid="loyalty-custom-amount-btn"
                          >
                            مبلغ مخصص
                          </Button>
                        </div>
                        {!loyaltyUseMax && (
                          <Input
                            type="number"
                            min={0}
                            step="1"
                            value={loyaltyPointsInput}
                            onChange={(e) => setLoyaltyPointsInput(e.target.value)}
                            placeholder={`عدد النقاط (حد أدنى ${Number(loyaltyPolicy?.redeem_min_points || 0)})`}
                            className="rounded-xl"
                            data-testid="loyalty-points-input"
                          />
                        )}
                        <div className="text-sm mt-1 min-h-[1.25rem]" data-testid="loyalty-preview-line">
                          {loyaltyPreviewLoading ? (
                            <span className="text-muted-foreground">جاري الاحتساب...</span>
                          ) : loyaltyPreview?.ok ? (
                            <span className="text-green-700">
                              سيتم خصم {loyaltyPreview.pointsToUse} نقطة مقابل {Number(loyaltyPreview.discountJd || 0).toFixed(2)} دينار
                            </span>
                          ) : loyaltyPreview?.reason ? (
                            <span className="text-red-600">
                              {loyaltyPreview.reason === 'below_min_points' && 'أقل من الحد الأدنى للاسترداد'}
                              {loyaltyPreview.reason === 'exceeds_limit' && `تتجاوز الحد الأقصى للحجز${loyaltyPreview.maxPointsAllowed ? ` (${loyaltyPreview.maxPointsAllowed} نقطة كحد أقصى)` : ''}`}
                              {loyaltyPreview.reason === 'zero_requested' && 'أدخل عدد النقاط'}
                              {loyaltyPreview.reason === 'amount_zero' && 'لا يوجد مبلغ لاحتساب الخصم عليه'}
                              {loyaltyPreview.reason === 'no_headroom' && 'لا يوجد نقاط قابلة للاستخدام'}
                              {loyaltyPreview.reason === 'redemption_disabled' && 'الاسترداد غير مفعل حالياً'}
                              {loyaltyPreview.reason === 'loyalty_disabled' && 'نظام النقاط غير مفعل'}
                              {loyaltyPreview.reason === 'rounds_to_zero' && 'عدد النقاط غير كافٍ لخصم مرئي'}
                              {!['below_min_points','exceeds_limit','zero_requested','amount_zero','no_headroom','redemption_disabled','loyalty_disabled','rounds_to_zero'].includes(loyaltyPreview.reason) && 'تعذّر احتساب الخصم'}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {paymentMethod && (
                  <div className="booking-summary">
                    <p className="text-sm text-muted-foreground mb-1">ملخص الحجز</p>
                    <p className="font-bold">
                      {selectedSlot 
                        ? `${selectedDuration} ساعة × ${getEffectiveChildCount()} طفل = ${(parseFloat(getSlotTotalPrice(selectedSlot.start_time)) * getEffectiveChildCount()).toFixed(1)} دينار`
                        : `${selectedDuration} ساعة × ${getEffectiveChildCount()} طفل = ${getSelectedPrice()} دينار`
                      }
                    </p>
                    <p className="text-sm text-muted-foreground">إضافات: {getProductsTotal().toFixed(1)} دينار</p>
                    <p className="text-sm text-green-700">الخصم: -{getDiscountAmount().toFixed(1)} دينار</p>
                    {getLoyaltyDiscount() > 0 && (
                      <p className="text-sm text-green-700" data-testid="loyalty-discount-summary">
                        خصم باستخدام النقاط: -{getLoyaltyDiscount().toFixed(2)} دينار
                      </p>
                    )}
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
                      disabled={!selectedSlot || loading}
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
          selectedSlot ? (
            /* Slot selected — show two-path checkout selector or guest form */
            <Card className="booking-card" data-testid="guest-checkout-card">
              <CardHeader className="booking-card-header">
                <CardTitle className="booking-card-title">
                  <span className={`step-badge ${guestMode === 'form' ? 'step-badge-complete' : ''}`}>5</span>
                  كيف تريد المتابعة؟
                </CardTitle>
              </CardHeader>
              <CardContent className="py-6">
                {guestMode === null ? (
                  /* Path selector */
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <button
                      onClick={() => setGuestMode('form')}
                      className="option-btn cartoon-option p-5 text-right"
                      data-testid="guest-path-btn"
                    >
                      <div className="font-heading text-xl font-bold mb-1">إكمال كضيف 🎈</div>
                      <div className="text-sm text-muted-foreground">بدون حساب — أسرع وأبسط</div>
                      <div className="text-xs text-amber-700 mt-2 font-medium">نقداً أو CliQ فقط · لا تُكسب نقاط ولاء</div>
                    </button>
                    <button
                      onClick={() => navigate('/login', { state: { from: '/tickets' } })}
                      className="option-btn cartoon-option morning-option p-5 text-right"
                      data-testid="login-path-btn"
                    >
                      <div className="font-heading text-xl font-bold mb-1">تسجيل الدخول / إنشاء حساب</div>
                      <div className="text-sm text-muted-foreground">للدفع بالبطاقة ونقاط الولاء</div>
                      <div className="text-xs text-blue-700 mt-2 font-medium">احفظ تاريخ زيارات طفلك</div>
                    </button>
                  </div>
                ) : (
                  /* Guest checkout form */
                  <div className="space-y-5" dir="rtl">
                    <button
                      type="button"
                      onClick={() => setGuestMode(null)}
                      className="text-sm text-muted-foreground hover:text-foreground flex items-center gap-1"
                    >
                      ← تغيير طريقة المتابعة
                    </button>

                    <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm text-amber-800">
                      💡 الحجز كضيف يدعم <strong>نقداً وCliQ فقط</strong>. لا تُكسب أو تُخصم نقاط ولاء.
                    </div>

                    {/* Guest contact fields */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <Label className="block text-sm font-medium mb-2">
                          اسم ولي الأمر <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          value={guestParentName}
                          onChange={(e) => setGuestParentName(e.target.value)}
                          placeholder="مثال: أحمد محمد"
                          className="rounded-xl"
                          data-testid="guest-parent-name"
                        />
                      </div>
                      <div>
                        <Label className="block text-sm font-medium mb-2">
                          رقم الهاتف <span className="text-red-500">*</span>
                        </Label>
                        <Input
                          value={guestParentPhone}
                          onChange={(e) => setGuestParentPhone(e.target.value)}
                          placeholder="مثال: 0791234567"
                          className="rounded-xl"
                          type="tel"
                          dir="ltr"
                          data-testid="guest-parent-phone"
                        />
                      </div>
                      <div>
                        <Label className="block text-sm font-medium mb-2">اسم الطفل (اختياري)</Label>
                        <Input
                          value={guestChildName}
                          onChange={(e) => setGuestChildName(e.target.value)}
                          placeholder="اسم الطفل"
                          className="rounded-xl"
                        />
                      </div>
                      <div>
                        <Label className="block text-sm font-medium mb-2">عدد الأطفال</Label>
                        <div className="flex items-center gap-2">
                          <Button type="button" variant="outline" size="sm" className="h-8 w-8 rounded-full p-0" onClick={() => setGuestChildCount(c => Math.max(1, c - 1))}>-</Button>
                          <span className="min-w-8 text-center font-bold text-lg">{guestChildCount}</span>
                          <Button type="button" variant="outline" size="sm" className="h-8 w-8 rounded-full p-0" onClick={() => setGuestChildCount(c => Math.min(20, c + 1))}>+</Button>
                        </div>
                      </div>
                      <div>
                        <Label className="block text-sm font-medium mb-2">البريد الإلكتروني (اختياري)</Label>
                        <Input
                          value={guestParentEmail}
                          onChange={(e) => setGuestParentEmail(e.target.value)}
                          placeholder="example@email.com"
                          className="rounded-xl"
                          type="email"
                          dir="ltr"
                        />
                      </div>
                    </div>

                    {/* Payment method — cash/cliq only for guests */}
                    <div>
                      <Label className="block text-base font-bold mb-2">طريقة الدفع</Label>
                      <div className="grid grid-cols-2 gap-3">
                        {[
                          { id: 'cash', label: 'نقداً', sub: 'عند الاستقبال' },
                          { id: 'cliq', label: 'CliQ', sub: 'تحويل بنكي' }
                        ].map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => setGuestPaymentMethod(m.id)}
                            className={`option-btn p-4 text-right ${guestPaymentMethod === m.id ? 'selected' : ''}`}
                            data-testid={`guest-payment-${m.id}`}
                          >
                            <div className="font-bold">{m.label}</div>
                            <div className="text-xs mt-0.5">{m.sub}</div>
                          </button>
                        ))}
                      </div>
                      {guestPaymentMethod === 'cliq' && (
                        <div className="mt-3 rounded-xl border border-purple-200 bg-purple-50 p-4 text-sm">
                          <p className="font-bold text-purple-800 mb-1">معلومات التحويل CliQ</p>
                          <p className="text-purple-700">الاسم: <strong>Peekaboo1</strong> · البنك: بنك الإسكان</p>
                          <p className="text-xs text-purple-600 mt-1">بعد التحويل، أرسل صورة الإيصال على واتساب لتأكيد الحجز.</p>
                        </div>
                      )}
                    </div>

                    {/* Optional coupon code — validated server-side on submit */}
                    <div>
                      <Label className="block text-sm font-medium mb-2">كوبون الخصم (اختياري)</Label>
                      <Input
                        value={guestCouponCode}
                        onChange={(e) => setGuestCouponCode(e.target.value.toUpperCase())}
                        placeholder="مثال: PEEK10"
                        className="rounded-xl"
                      />
                      <p className="text-xs text-muted-foreground mt-1">سيتم التحقق من الكوبون عند إتمام الحجز</p>
                    </div>

                    {/* Notes */}
                    <div>
                      <Label htmlFor="guest-custom-notes" className="block text-sm font-medium mb-2">ملاحظات (اختياري)</Label>
                      <Textarea
                        id="guest-custom-notes"
                        value={customNotes}
                        onChange={(e) => setCustomNotes(e.target.value)}
                        placeholder="أي ملاحظات أو طلبات خاصة..."
                        className="rounded-xl resize-none"
                        rows={2}
                      />
                    </div>

                    {/* Booking summary */}
                    <div className="booking-summary">
                      <p className="text-sm text-muted-foreground mb-1">ملخص الحجز</p>
                      <p className="font-bold">
                        {selectedSlot
                          ? `${selectedDuration} ساعة × ${guestChildCount} طفل = ${(parseFloat(getSlotTotalPrice(selectedSlot.start_time)) * guestChildCount).toFixed(1)} دينار`
                          : `${selectedDuration} ساعة × ${guestChildCount} طفل`
                        }
                      </p>
                      {getProductsTotal() > 0 && (
                        <p className="text-sm text-muted-foreground">إضافات: {getProductsTotal().toFixed(1)} دينار</p>
                      )}
                      <p className="font-semibold">الإجمالي: {(getBaseBookingTotal() + getProductsTotal()).toFixed(1)} دينار</p>
                    </div>

                    {/* Sticky CTA */}
                    <div className="booking-sticky-wrap mt-6">
                      <div className="booking-sticky-summary-bar">
                        <div className="booking-sticky-summary__meta">
                          <span>🗓 {format(date, 'dd/MM')}</span>
                          <span>⏰ {periodLabel}</span>
                          <span>⏱ {selectedDuration} س</span>
                          <span>💰 {(getBaseBookingTotal() + getProductsTotal()).toFixed(1)} د</span>
                        </div>
                      </div>
                      <div className="booking-sticky-summary">
                        <Button
                          onClick={handleGuestBooking}
                          disabled={!selectedSlot || loading}
                          className={`w-full px-8 rounded-full h-12 text-base ${timeMode === 'morning' ? 'bg-yellow-500 hover:bg-yellow-600 text-white' : 'btn-playful'}`}
                          data-testid="guest-book-btn"
                        >
                          {loading ? (
                            <>
                              <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                              جاري المعالجة...
                            </>
                          ) : (
                            <span>احجز كضيف — {(getBaseBookingTotal() + getProductsTotal()).toFixed(1)} د</span>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            /* No slot selected yet — show the generic login/register invite */
            <Card className="booking-card booking-auth-card pk-auth-invite border-0 shadow-none">
              <CardContent className="py-6 text-center">
                <div className="pk-auth-invite__shroomi" aria-hidden="true">
                  <Shroomi pose="wave" size={92} className="shroomi-pop-in" />
                </div>
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
          )
        )}
      </div>
    </div>
  );
}
