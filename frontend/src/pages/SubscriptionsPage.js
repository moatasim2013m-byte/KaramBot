import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { PaymentMethodSelector } from '../components/PaymentMethodSelector';
import mascotImg from '../assets/mascot.png';
import SkyBackground from '../components/theme/SkyBackground';
import SmilingSun from '../components/theme/SmilingSun';
import MascotVariant from '../components/theme/MascotVariant';
import starIcon from '../assets/cartoon-icons/star.svg';
import checkIcon from '../assets/cartoon-icons/check.svg';
import popperIcon from '../assets/cartoon-icons/popper.svg';
import sparkleIcon from '../assets/cartoon-icons/sparkle.svg';
import crownIcon from '../assets/cartoon-icons/crown.svg';
import giftIcon from '../assets/cartoon-icons/party-cake.svg';
import rocketIcon from '../assets/cartoon-icons/rocket.svg';
import subscriptionAccessory from '../assets/mascot-variants/subscription-crown.svg';

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

  const tierIconMap = {
    basic: { icon: giftIcon, bg: 'bg-[var(--pk-orange)]/15' },
    standard: { icon: sparkleIcon, bg: 'bg-[var(--pk-blue)]/15' },
    premium: { icon: crownIcon, bg: 'bg-[var(--pk-yellow)]/20' }
  };

  return (
    <div className="subscriptions-page min-h-screen py-8 md:py-12" dir="rtl">
      <SkyBackground className="subscriptions-sky" />
      <SmilingSun className="subscriptions-sun" />
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Page Header */}
        <div className="subscriptions-hero text-center mb-10">
          <div className="subscriptions-hero-decor" aria-hidden="true">
            <span className="subscriptions-hero-cloud subscriptions-hero-cloud--one" />
            <span className="subscriptions-hero-cloud subscriptions-hero-cloud--two" />
            <span className="subscriptions-hero-balloon subscriptions-hero-balloon--one" />
            <span className="subscriptions-hero-balloon subscriptions-hero-balloon--two" />
          </div>
          <h1 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-foreground mb-3" data-testid="subscriptions-title">
            <img src={starIcon} className="inline-block h-9 w-9 ml-2" alt="" />
            باقات الاشتراك
          </h1>
          <div className="shroomi-promo shroomi-promo--subscriptions">
            <img src={mascotImg} alt="Shroomi with calendar" className="shroomi-promo__img shroomi-promo__img--calendar" />
            <span className="shroomi-promo__text">Join Now!</span>
          </div>
          <p className="text-muted-foreground text-base md:text-lg max-w-xl mx-auto">
            وفّر أكثر مع باقات الزيارات. صالحة لمدة 30 يومًا.
          </p>
          <div className="mt-5 flex items-center justify-center gap-3 sm:gap-4">
            {[
              { icon: popperIcon, bg: 'bg-[var(--pk-orange)]/20' },
              { icon: rocketIcon, bg: 'bg-[var(--pk-blue)]/20' },
              { icon: sparkleIcon, bg: 'bg-[var(--pk-yellow)]/20' }
            ].map((item, index) => {
              const iconSrc = item.icon;
              return (
                <span
                  key={index}
                  className={`inline-flex h-11 w-11 items-center justify-center rounded-full border border-white shadow-sm ${item.bg}`}
                  aria-hidden="true"
                >
                  <img src={iconSrc} className="h-5 w-5" alt="" />
                </span>
              );
            })}
          </div>
        </div>

        {loadingPlans ? (
          <div className="flex justify-center py-12">
            <span className="pk-spinner" aria-label="جاري التحميل" />
          </div>
        ) : (
          <>
            {/* Plans Grid */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 lg:gap-6 mb-10">
              {plans.map((plan, index) => {
                const tier = getPlanTier(index);
                const isPopular = index === 1;
                const tierIcon = tierIconMap[tier] || tierIconMap.basic;
                const tierIconSrc = tierIcon.icon;
                
                return (
                  <Card
                    key={plan.id}
                    onClick={() => setSelectedPlan(plan)}
                    className={`pk-card theme-package-card subscription-plan-card cursor-pointer transition-all relative ${
                      selectedPlan?.id === plan.id ? 'is-selected ring-2 ring-[var(--pk-yellow)] shadow-lg' : 'hover:shadow-lg'
                    } ${isPopular ? 'md:-mt-4 md:mb-4' : ''}`}
                    data-testid={`plan-${plan.id}`}
                  >
                    <div className={`pk-card-accent ${isPopular ? 'accent-rainbow' : tier === 'basic' ? 'accent-green' : 'accent-orange'}`} />
                    {isPopular && <Badge className="absolute top-3 left-3 theme-saving-badge theme-saving-badge--subscriptions">الأكثر توفيراً</Badge>}
                    <CardHeader className={`text-center pb-3 ${isPopular ? 'pt-10' : 'pt-6'}`}>
                      <div className="mb-3 flex justify-center">
                        <span className={`inline-flex h-12 w-12 items-center justify-center rounded-full border-2 border-white shadow-sm ${tierIcon.bg}`}>
                          <img src={tierIconSrc} className="h-6 w-6" alt="" />
                        </span>
                      </div>
                      <CardTitle className="font-heading text-xl font-bold">
                        {stripWeekdayRangeFromPlanName(plan.name_ar || t(plan.name) || plan.name)}
                      </CardTitle>
                      <CardDescription className="text-xs">
                        {plan.description_ar || t(plan.description) || plan.description}
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="text-center pb-6">
                      <div className="mb-4">
                        <span className="text-4xl font-heading font-bold text-slate-800">{plan.price}</span>
                        <span className="text-sm text-slate-500 mr-1">دينار</span>
                      </div>
                      <div className="mb-4 flex justify-center gap-2">
                        <Badge className="theme-price-badge">سعر مميز</Badge>
                        <Badge className="theme-price-badge theme-price-badge--value">{plan.price} د</Badge>
                      </div>
                      
                      <div className="bg-gradient-to-r from-[var(--pk-yellow)]/20 to-[var(--pk-orange)]/20 rounded-xl p-3 mb-4">
                        <span className="text-2xl font-heading font-bold text-[var(--pk-orange)]">{plan.visits}</span>
                        <span className="text-slate-600 mr-1 text-sm">زيارة</span>
                      </div>

                      {/* Validity Days Notice */}
                      <div className="subscription-validity-pill">
                        <img src={starIcon} className="h-3.5 w-3.5" alt="" />
                        <p className="text-xs font-bold text-[var(--pk-blue)]">صالحة من الأحد إلى الخميس</p>
                      </div>

                      <ul className="space-y-2 text-right mb-4" dir="rtl">
                        {planFeatures[tier]?.slice(0, 3).map((feature, i) => (
                          <li key={i} className="flex items-center gap-2 text-xs">
                            <img src={checkIcon} className="h-4 w-4 flex-shrink-0" alt="" />
                            <span className="text-slate-600">{feature}</span>
                          </li>
                        ))}
                      </ul>

                      <Button
                        variant={selectedPlan?.id === plan.id ? 'default' : 'outline'}
                        className={`w-full rounded-full h-10 text-sm font-semibold ${
                          selectedPlan?.id === plan.id 
                            ? 'bg-[var(--pk-yellow)] hover:bg-[var(--pk-yellow)]/90 text-[var(--text-primary)]' 
                            : 'border-2 hover:border-[var(--pk-yellow)] hover:bg-[var(--pk-yellow)]/10'
                        }`}
                      >
                        اختر الباقة
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Purchase Section */}
            {isAuthenticated ? (
              <Card className="booking-card max-w-xl mx-auto subscription-purchase-card">
                <CardHeader className="booking-card-header">
                  <CardTitle className="booking-card-title">أكمل عملية الشراء</CardTitle>
                </CardHeader>
                <CardContent className="py-5 space-y-5">
                  <div>
                    <label className="block text-sm font-medium mb-2">اختر الطفل</label>
                    {children.length === 0 ? (
                      <div className="text-muted-foreground text-sm">
                        <p className="mb-2">لم يتم إضافة أطفال بعد</p>
                        <Button variant="outline" size="sm" onClick={() => navigate('/profile')} className="rounded-full">
                          إضافة طفل
                        </Button>
                      </div>
                    ) : (
                      <Select value={selectedChild} onValueChange={setSelectedChild}>
                        <SelectTrigger className="rounded-xl" data-testid="subscription-child-select">
                          <SelectValue placeholder="اختر طفلاً" />
                        </SelectTrigger>
                        <SelectContent>
                          {children.map((child) => (
                            <SelectItem key={child.id} value={child.id}>{child.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  <div className="pt-4 border-t">
                    <PaymentMethodSelector value={paymentMethod} onChange={setPaymentMethod} />
                  </div>

                  <div className="subscription-purchase-row flex flex-col sm:flex-row items-center justify-between gap-4 pt-4 border-t">
                    {selectedPlan && (
                      <div className="subscription-selected-summary text-center sm:text-right">
                        <p className="text-xs text-muted-foreground">الباقة المختارة</p>
                        <p className="font-bold">{stripWeekdayRangeFromPlanName(selectedPlan.name_ar || selectedPlan.name)}</p>
                        <p className="font-bold text-xl text-secondary">{selectedPlan.price} د</p>
                      </div>
                    )}
                    <Button
                      onClick={handlePurchase}
                      disabled={!selectedPlan || !selectedChild || loading}
                      className="w-full sm:w-auto px-8 rounded-full h-[52px] btn-playful theme-gradient-btn text-white"
                      data-testid="purchase-btn"
                    >
                      {loading ? (
                        <span className="inline-flex items-center gap-2"><span className="pk-spinner pk-spinner--sm" aria-hidden="true" />جاري المعالجة...</span>
                      ) : (
                        <span className="inline-flex items-center gap-2">اشترك الآن <MascotVariant accessory={subscriptionAccessory} alt="" /></span>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="booking-card max-w-xl mx-auto bg-secondary/5">
                <CardContent className="py-8 text-center">
                  <p className="text-base mb-4">سجّل الدخول أو أنشئ حساب لإتمام الشراء</p>
                  <div className="flex gap-4 justify-center">
                    <Button onClick={() => navigate('/login')} variant="outline" className="rounded-full">تسجيل الدخول</Button>
                    <Button onClick={() => navigate('/register')} className="rounded-full btn-playful bg-secondary text-secondary-foreground">إنشاء حساب</Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
