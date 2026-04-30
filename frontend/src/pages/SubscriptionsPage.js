import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Label } from '../components/ui/label';
import { toast } from 'sonner';
import { PaymentMethodSelector } from '../components/PaymentMethodSelector';
import Shroomi from '../components/Shroomi';
import {
  Loader2,
  Sparkles,
  Crown,
  Gift,
  Check,
  Star,
  CalendarDays,
  ShieldCheck,
} from 'lucide-react';

const stripWeekdayRangeFromPlanName = (name = '') =>
  name
    .replace(/\s*\((?:الأحد\s*[–-]\s*الخميس|الأحد-الخميس)\)\s*/g, ' ')
    .replace(/\s*\((?:Sun\s*[–-]\s*Thu|Sunday\s*to\s*Thursday)\)\s*/gi, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();


export default function SubscriptionsPage() {
  const { isAuthenticated, api } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();

  useEffect(() => {
    document.title = 'باقات الاشتراك | بيكابو';
  }, []);

  const [plans, setPlans] = useState([]);
  const [children, setChildren] = useState([]);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [selectedChild, setSelectedChild] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('card');
  const [loading, setLoading] = useState(false);
  const [loadingPlans, setLoadingPlans] = useState(true);

  useEffect(() => {
    fetchPlans();
    if (isAuthenticated) {
      fetchChildren();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  const fetchPlans = async () => {
    try {
      const response = await api.get('/subscriptions/plans');
      setPlans(response.data.plans || []);
    } catch (error) {
      console.error('Failed to fetch plans:', error);
    } finally {
      setLoadingPlans(false);
    }
  };

  const fetchChildren = async () => {
    try {
      const response = await api.get('/profile/children');
      setChildren(response.data.children || []);
    } catch (error) {
      console.error('Failed to fetch children:', error);
    }
  };

  const handlePurchase = async () => {
    if (!isAuthenticated) {
      toast.error('الرجاء تسجيل الدخول للشراء');
      navigate('/login');
      return;
    }

    if (!selectedPlan || !selectedChild) {
      toast.error('الرجاء اختيار باقة وطفل');
      return;
    }

    setLoading(true);
    try {
      const amount = selectedPlan.price;

      if (paymentMethod === 'card') {
        // Online card provider checkout flow
        const response = await api.post('/payments/create-checkout', {
          type: 'subscription',
          reference_id: selectedPlan.id,
          child_id: selectedChild,
          origin_url: window.location.origin
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
        // Cash or CliQ - create subscription directly
        const response = await api.post('/subscriptions/purchase/offline', {
          plan_id: selectedPlan.id,
          child_id: selectedChild,
          payment_method: paymentMethod
        });

        // Get child name for confirmation
        const childObj = children.find(c => c.id === selectedChild);

        // Navigate to confirmation page with booking details
        const confirmationData = {
          bookingId: response.data.subscription?.id,
          bookingCode: `PK-SUB-${response.data.subscription?.id?.slice(-6).toUpperCase() || 'XXXXXX'}`,
          bookingType: 'subscription',
          childName: childObj?.name,
          amount,
          paymentMethod
        };

        // Store in localStorage for refresh persistence
        localStorage.setItem('pk_last_confirmation', JSON.stringify(confirmationData));

        navigate('/booking-confirmation', { state: confirmationData });
        setLoading(false);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || error.message || 'فشل بدء عملية الشراء');
      setLoading(false);
    }
  };

  const planFeatures = {
    basic: ['مثالية للزيارات المنتظمة', 'صلاحية 30 يوم', 'دخول كامل للملعب'],
    standard: ['قيمة رائعة للزوار الدائمين', 'صلاحية 30 يوم', 'دخول كامل للملعب', 'أولوية الحجز'],
    premium: ['الأفضل للزوار المتكررين', 'صلاحية 30 يوم', 'دخول كامل للملعب', 'أولوية الحجز', 'معاملة VIP']
  };

  const getPlanTier = (index) => {
    if (index === 0) return 'basic';
    if (index === 1) return 'standard';
    return 'premium';
  };

  // Unified per-tier visual config — single source of truth for the new
  // premium card system (icon, topbar accent color, soft icon-bg color).
  const tierConfig = {
    basic: {
      Icon: Gift,
      topbar: 'pk-topbar--blue',
      iconWrap: 'bg-blue-50 text-blue-600 border-blue-100',
    },
    standard: {
      Icon: Sparkles,
      topbar: 'pk-topbar--orange',
      iconWrap: 'bg-amber-50 text-amber-600 border-amber-100',
    },
    premium: {
      Icon: Crown,
      topbar: 'pk-topbar--purple',
      iconWrap: 'bg-violet-50 text-violet-600 border-violet-100',
    },
  };

  return (
    <div className="pk-booking-page min-h-screen py-8 md:py-12" dir="rtl">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* ======================================================
            HERO — single coherent premium hero.
            Shroomi #1 of 3: gift-magic mascot anchored to the
            LEFT in RTL (the empty side) so it never overlaps
            the right-aligned heading.
            ====================================================== */}
        <div className="pk-booking-hero mb-8 md:mb-10">
          <div className="pk-booking-hero__deco-yellow" aria-hidden="true"></div>
          <div className="pk-booking-hero__deco-blue" aria-hidden="true"></div>

          <div
            className="pk-booking-hero__shroomi shroomi-halo shroomi-halo--yellow hidden md:block"
            aria-hidden="true"
            style={{ right: 'auto', left: 24, bottom: -10 }}
          >
            <Shroomi pose="gift-magic" size={150} className="shroomi-float" />
          </div>

          <div className="relative z-10 max-w-2xl">
            <span
              className="pk-hero-eyebrow"
              style={{
                color: '#92400e',
                background: 'rgba(242,229,51,.22)',
                borderColor: 'rgba(242,138,46,.4)',
              }}
            >
              <Star className="h-3.5 w-3.5" aria-hidden="true" />
              وفّر أكثر مع باقات الزيارات المتكررة
            </span>
            <h1
              className="font-heading heading-bubble text-3xl sm:text-4xl md:text-5xl font-bold text-slate-900 mt-3 mb-2 tracking-tight"
              data-testid="subscriptions-title"
            >
              باقات الاشتراك
            </h1>
            <p className="text-slate-600 text-sm md:text-base max-w-md leading-relaxed">
              اختر الباقة الأنسب لطفلك — صلاحية 30 يومًا، دخول كامل للملعب، وقيمة مضاعفة لكل زيارة.
            </p>

            <div className="mt-5 flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <CalendarDays className="h-3.5 w-3.5 text-slate-500" />
                30 يومًا
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <ShieldCheck className="h-3.5 w-3.5 text-slate-500" />
                الأحد – الخميس
              </span>
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 bg-white border border-slate-200 rounded-full px-3 py-1.5">
                <Sparkles className="h-3.5 w-3.5 text-slate-500" />
                دخول كامل للملعب
              </span>
            </div>
          </div>
        </div>

        {loadingPlans ? (
          <div className="flex justify-center py-12">
            <span className="pk-spinner" aria-label="جاري التحميل" />
          </div>
        ) : (
          <>
            {/* ======================================================
                PLANS GRID — premium comparison cards.
                Shroomi #2 of 3: tag-discount corner accent on the
                POPULAR plan only (single contextual mascot, hidden
                on small screens). Keeps total mascot count at 3.
                ====================================================== */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 mb-8 md:mb-10">
              {plans.map((plan, index) => {
                const tier = getPlanTier(index);
                const isPopular = index === 1;
                const isSelected = selectedPlan?.id === plan.id;
                const cfg = tierConfig[tier] || tierConfig.basic;
                const Icon = cfg.Icon;

                return (
                  <button
                    key={plan.id}
                    type="button"
                    onClick={() => setSelectedPlan(plan)}
                    className={[
                      'pk-pcard relative text-right flex flex-col cursor-pointer transition-all',
                      isSelected
                        ? 'ring-2 ring-slate-900 shadow-lg'
                        : 'hover:shadow-md hover:-translate-y-0.5',
                      isPopular ? 'md:-mt-4 md:mb-4' : '',
                    ].join(' ')}
                    data-testid={`plan-${plan.id}`}
                    aria-selected={isSelected}
                  >
                    <div className={`pk-pcard__topbar ${cfg.topbar}`}></div>

                    {/* Popular badge */}
                    {isPopular && (
                      <span className="absolute -top-3 right-1/2 translate-x-1/2 z-10 inline-flex items-center gap-1 text-[11px] font-bold text-white bg-slate-900 rounded-full px-3 py-1 shadow-md">
                        <Star className="h-3 w-3" />
                        الأكثر توفيراً
                      </span>
                    )}

                    {/* Selected check */}
                    {isSelected && (
                      <span className="absolute top-3 left-3 z-10 inline-flex items-center justify-center w-7 h-7 rounded-full bg-slate-900 text-white shadow">
                        <Check className="h-4 w-4" />
                      </span>
                    )}

                    {/* Shroomi #2 — popular plan corner accent only */}
                    {isPopular && (
                      <div
                        className="pk-card-mascot pk-card-mascot--tr shroomi-halo shroomi-halo--yellow hidden sm:block"
                        aria-hidden="true"
                        style={{ width: 60, height: 60 }}
                      >
                        <Shroomi pose="tag-discount" size={60} className="shroomi-bob" />
                      </div>
                    )}

                    <div className={`p-5 sm:p-6 flex flex-col flex-1 ${isPopular ? 'pt-7' : ''}`}>
                      {/* Tier icon + name */}
                      <div className="flex flex-col items-center text-center">
                        <span
                          className={`inline-flex h-12 w-12 items-center justify-center rounded-xl border ${cfg.iconWrap} mb-3`}
                        >
                          <Icon className="h-6 w-6" />
                        </span>
                        <h3 className="font-heading text-lg font-bold text-slate-900">
                          {stripWeekdayRangeFromPlanName(plan.name_ar || t(plan.name) || plan.name)}
                        </h3>
                        <p className="text-xs text-slate-500 mt-1 line-clamp-2">
                          {plan.description_ar || t(plan.description) || plan.description}
                        </p>
                      </div>

                      {/* Price */}
                      <div className="text-center mt-5">
                        <div className="inline-flex items-baseline gap-1">
                          <span className="font-heading text-4xl font-bold text-slate-900">
                            {plan.price}
                          </span>
                          <span className="text-sm text-slate-500 font-medium">دينار</span>
                        </div>
                      </div>

                      {/* Visits block — single subtle slate panel (no rainbow gradient) */}
                      <div className="mt-4 rounded-2xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
                        <span className="font-heading text-2xl font-bold text-slate-900">
                          {plan.visits}
                        </span>
                        <span className="text-slate-600 mr-1.5 text-sm font-medium">زيارة</span>
                      </div>

                      {/* Validity pill */}
                      <div className="mt-3 inline-flex self-center items-center gap-1.5 text-[11px] font-semibold text-slate-700 bg-white border border-slate-200 rounded-full px-3 py-1">
                        <CalendarDays className="h-3 w-3 text-slate-500" />
                        صالحة من الأحد إلى الخميس
                      </div>

                      {/* Features list */}
                      <ul className="space-y-2 text-right mt-4 mb-5" dir="rtl">
                        {planFeatures[tier]?.slice(0, 3).map((feature, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-100 shrink-0">
                              <Check className="h-3 w-3" />
                            </span>
                            <span className="text-slate-700">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      {/* CTA — clean dark or outline (no playful gradient, no mascot) */}
                      <div className="mt-auto">
                        <span
                          className={[
                            'block w-full rounded-full h-10 text-sm font-semibold inline-flex items-center justify-center transition-colors',
                            isSelected
                              ? 'bg-slate-900 text-white'
                              : 'border border-slate-300 text-slate-800 group-hover:border-slate-400',
                          ].join(' ')}
                        >
                          {isSelected ? 'مختارة ✓' : 'اختر الباقة'}
                        </span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ======================================================
                PURCHASE / AUTH SECTION
                ====================================================== */}
            {isAuthenticated ? (
              /* Shroomi #3a (authed path): thumbs-up-big corner companion
                 on the purchase summary, contained, hidden <sm. */
              <div className="pk-pcard relative max-w-xl mx-auto overflow-hidden">
                <div
                  className="pk-card-mascot pk-card-mascot--tl hidden sm:block shroomi-halo shroomi-halo--green"
                  aria-hidden="true"
                  style={{ width: 64, height: 64 }}
                >
                  <Shroomi pose="thumbs-up-big" size={64} className="shroomi-bob" />
                </div>
                <div className="pk-pcard__topbar pk-topbar--green"></div>
                <div className="p-5 sm:p-6 space-y-5">
                  <div className="pk-section-head">
                    <span className="pk-section-head__num pk-section-head__num--done">
                      <ShieldCheck className="h-4 w-4" />
                    </span>
                    <div>
                      <div className="pk-section-head__title">أكمل عملية الشراء</div>
                      <div className="pk-section-head__sub">
                        خطوة أخيرة قبل تفعيل الباقة
                      </div>
                    </div>
                  </div>

                  <div>
                    <Label className="text-sm font-semibold text-slate-700">اختر الطفل</Label>
                    {children.length === 0 ? (
                      <div className="mt-2 rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-center">
                        <p className="text-sm text-slate-600 mb-3">
                          لم يتم إضافة أطفال بعد
                        </p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => navigate('/profile')}
                          className="rounded-full border-slate-300"
                        >
                          إضافة طفل
                        </Button>
                      </div>
                    ) : (
                      <Select value={selectedChild} onValueChange={setSelectedChild}>
                        <SelectTrigger
                          className="rounded-xl mt-1.5 border-slate-200"
                          data-testid="subscription-child-select"
                        >
                          <SelectValue placeholder="اختر طفلاً" />
                        </SelectTrigger>
                        <SelectContent>
                          {children.map((child) => (
                            <SelectItem key={child.id} value={child.id}>
                              {child.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Mini summary */}
                  <div className="pk-summary-card">
                    <div className="pk-summary-row">
                      <span>الباقة المختارة</span>
                      <span className="font-semibold text-slate-900">
                        {selectedPlan
                          ? stripWeekdayRangeFromPlanName(
                              selectedPlan.name_ar || selectedPlan.name
                            )
                          : '—'}
                      </span>
                    </div>
                    <div className="pk-summary-row">
                      <span>عدد الزيارات</span>
                      <span className="font-semibold text-slate-900">
                        {selectedPlan ? `${selectedPlan.visits} زيارة` : '—'}
                      </span>
                    </div>
                    <div className="pk-summary-row pk-summary-row--final">
                      <span>الإجمالي</span>
                      <span>
                        {selectedPlan
                          ? `${Number(selectedPlan.price).toFixed(1)} د`
                          : '— د'}
                      </span>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-slate-200">
                    <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                  </div>

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-3 pt-4 border-t border-slate-200">
                    <Button
                      onClick={handlePurchase}
                      disabled={!selectedPlan || !selectedChild || loading}
                      className="w-full sm:w-auto px-8 rounded-full h-12 bg-slate-900 hover:bg-slate-800 text-white shadow-md disabled:opacity-60"
                      data-testid="purchase-btn"
                    >
                      {loading ? (
                        <span className="inline-flex items-center gap-2">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          جاري المعالجة...
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-2">
                          <Sparkles className="h-4 w-4" />
                          اشترك الآن
                        </span>
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              /* Shroomi #3b (un-authed path): prayer mascot in the
                 auth invite. Mutually exclusive with #3a, total = 3. */
              <div className="pk-auth-invite max-w-xl mx-auto">
                <div className="pk-auth-invite__shroomi" aria-hidden="true">
                  <Shroomi pose="prayer" size={92} className="shroomi-pop-in" />
                </div>
                <p className="text-base font-semibold text-slate-800 mb-4">
                  سجّل الدخول أو أنشئ حساب لإتمام الشراء
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
          </>
        )}
      </div>
    </div>
  );
}
