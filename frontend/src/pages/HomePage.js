import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, CheckCircle2, Wifi, Coffee, Eye, MapPin, Clock, Phone, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAuth } from '../context/AuthContext';
import Shroomi from '../components/Shroomi';
import SkyBackground from '../components/theme/SkyBackground';
import SmilingSun from '../components/theme/SmilingSun';
import logoImg from '../assets/logo.png';
import playHourIcon from '../assets/cartoon-icons/play-clock.svg';
import birthdayCakeIcon from '../assets/cartoon-icons/party-cake.svg';
import crownIcon from '../assets/cartoon-icons/crown.svg';
import schoolBusIcon from '../assets/cartoon-icons/bus.svg';
import homePartyIcon from '../assets/cartoon-icons/house-party.svg';
import careHeartIcon from '../assets/cartoon-icons/heart-care.svg';
import closeIcon from '../assets/cartoon-icons/close.svg';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

const WHATSAPP_NUMBER = '962777775652';
const WHATSAPP_PREFILL = 'مرحباً، بدي أحجز جلسة في بيكابو';
const whatsappUrl = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(WHATSAPP_PREFILL)}`;

const resolveMediaUrl = (url) => {
  if (!url) return '';
  if (/^(data:|blob:)/i.test(url)) return url;

  let normalizedUrl = String(url).trim();

  if (/^https?:\/\//i.test(normalizedUrl)) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.pathname.startsWith('/api/uploads/') || parsed.pathname.startsWith('/uploads/')) {
        const normalizedPath = parsed.pathname.replace(/^\/api\/api\/uploads\//i, '/api/uploads/');
        normalizedUrl = `${normalizedPath}${parsed.search}`;
      } else {
        return normalizedUrl;
      }
    } catch {
      return normalizedUrl;
    }
  }

  normalizedUrl = normalizedUrl.replace(/^\/api\/api\/uploads\//i, '/api/uploads/');

  if (normalizedUrl.startsWith('/uploads/')) {
    normalizedUrl = `/api${normalizedUrl}`;
  }

  return `${BACKEND_ORIGIN}${normalizedUrl.startsWith('/') ? '' : '/'}${normalizedUrl}`;
};

export default function HomePage() {
  const { isAuthenticated, api } = useAuth();
  const [gallery, setGallery] = useState([]);
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [heroImgSrc, setHeroImgSrc] = useState('');
  const [heroImageReady, setHeroImageReady] = useState(false);
  const [heroImageError, setHeroImageError] = useState(false);
  const [showDeferredSections, setShowDeferredSections] = useState(false);
  const [heroConfig, setHeroConfig] = useState({
    title: 'حيث يلعب الأطفال ويحتفلون 🎈',
    subtitle: 'أفضل تجربة ملعب داخلي! احجز جلسات اللعب، أقم حفلات أعياد ميلاد لا تُنسى، ووفّر مع باقات الاشتراك',
    ctaText: 'احجز جلسة',
    ctaRoute: '/tickets',
    image: ''
  });

  useEffect(() => {
    document.title = 'بيكابو | ملعب داخلي للأطفال - إربد';
  }, []);

  useEffect(() => {
    let timeoutId;
    let idleId;

    const markReady = () => setShowDeferredSections(true);

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      idleId = window.requestIdleCallback(markReady, { timeout: 600 });
    } else {
      timeoutId = window.setTimeout(markReady, 250);
    }

    return () => {
      if (typeof window !== 'undefined' && typeof window.cancelIdleCallback === 'function' && idleId) {
        window.cancelIdleCallback(idleId);
      }
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  // Handle ESC key and body scroll
  useEffect(() => {
    const handleEsc = (e) => {
      if (e.key === 'Escape') setLightboxOpen(false);
    };
    if (lightboxOpen) {
      document.addEventListener('keydown', handleEsc);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.removeEventListener('keydown', handleEsc);
      document.body.style.overflow = '';
    };
  }, [lightboxOpen]);

  useEffect(() => {
    let isActive = true;

    const fetchSettings = async () => {
      try {
        const settingsResult = await api.get('/settings');
        const s = settingsResult?.data?.settings || {};
        if (!isActive) return;

        setHeroConfig((prev) => ({
          title: s.hero_title || prev.title,
          subtitle: s.hero_subtitle || prev.subtitle,
          ctaText: s.hero_cta_text || prev.ctaText,
          ctaRoute: s.hero_cta_route || prev.ctaRoute,
          image: s.hero_image || ''
        }));
        setHeroImgSrc(s.hero_image ? resolveMediaUrl(s.hero_image) : '');
        setHeroImageError(false);
      } catch (error) {
        if (!isActive) return;
        console.error('Failed to fetch settings:', error);
        setHeroImgSrc('');
        setHeroImageError(false);
      } finally {
        if (isActive) {
          setHeroImageReady(true);
        }
      }
    };

    fetchSettings();

    return () => {
      isActive = false;
    };
  }, [api]);

  useEffect(() => {
    if (!showDeferredSections) return;

    let isActive = true;

    const fetchGallery = async () => {
      try {
        const galleryResult = await api.get('/gallery');
        if (isActive) {
          setGallery(galleryResult?.data?.media || []);
        }
      } catch (error) {
        if (isActive) {
          console.error('Failed to fetch gallery:', error);
        }
      }
    };

    fetchGallery();

    return () => {
      isActive = false;
    };
  }, [api, showDeferredSections]);

  // ================== DATA (logic preserved) ==================
  const features = [
    {
      id: 'hourly',
      icon: playHourIcon,
      title: 'اللعب بالساعة',
      description: 'احجز جلسات لعب لأطفالك واختر الوقت المثالي!',
      link: '/tickets',
      buttonText: 'احجز الآن',
      isCoreOffer: true,
      accent: 'blue'
    },
    {
      id: 'birthdays',
      icon: birthdayCakeIcon,
      title: 'حفلات أعياد الميلاد',
      description: 'احتفل مع ثيمات رائعة وحفلات مخصصة!',
      link: '/birthday',
      buttonText: 'خطط لحفلتك',
      isCoreOffer: true,
      accent: 'red'
    },
    {
      id: 'subscriptions',
      icon: crownIcon,
      title: 'الاشتراكات',
      description: 'وفّر مع باقات الزيارات بصلاحية 30 يوم!',
      link: '/subscriptions',
      buttonText: 'اشترك الآن',
      isCoreOffer: true,
      accent: 'yellow'
    },
    {
      icon: schoolBusIcon,
      title: 'المدارس والمجموعات',
      description: 'رحلات مدرسية وبرامج لعب آمنة للمجموعات',
      link: '/groups',
      buttonText: 'تواصل معنا',
      accent: 'green'
    },
    {
      icon: homePartyIcon,
      title: 'حفلتك في بيتك',
      description: 'نأتيكم للمنزل مع ديكور واحتفال كامل!',
      link: '/home-party',
      buttonText: 'احجز حفلتك',
      accent: 'orange'
    },
    {
      icon: careHeartIcon,
      title: 'ذوي الهمم',
      description: 'برامج مخصصة لأصحاب الاحتياجات الخاصة',
      link: null,
      buttonText: 'قريباً',
      disabled: true,
      accent: 'blue'
    }
  ];

  const whyPeekabooFeatures = [
    {
      icon: '⭐',
      title: 'عناية واهتمام بكل طفل',
      description: 'نراعي احتياجات كل طفل ونمنحه تجربة مريحة وممتعة.'
    },
    {
      icon: '🧼',
      title: 'نظافة وتعقيم مستمر',
      description: 'تعقيم مستمر للألعاب والمناطق طوال اليوم.'
    },
    {
      icon: '🧩',
      title: 'اللعب للتعلّم وتنمية المهارات',
      description: 'أنشطة تفاعلية تطوّر التفكير والتعاون والثقة.'
    },
    {
      icon: '🛡️',
      title: 'بيئة آمنة ومراقبة',
      description: 'مساحات لعب آمنة مع متابعة دائمة من الفريق.'
    },
    {
      icon: '🎁',
      title: 'فعاليات وهدايا وتجارب ممتعة',
      description: 'مفاجآت وأنشطة موسمية تجعل كل زيارة مختلفة.'
    }
  ];

  const trustBullets = [
    'آمن ومعقم يومياً',
    'للأعمار 1–10 سنوات',
    'اربد- شارع ابو راشد'
  ];

  // Journey is presentation-only static content per spec
  const journeySteps = [
    { pose: 'wave', title: 'الاستقبال', desc: 'ترحيب دافئ من فريق بيكابو لحظة الوصول', color: 'red' },
    { pose: 'point', title: 'اختيار النشاط', desc: 'الطفل يختار اللعبة أو المنطقة المفضلة', color: 'blue' },
    { pose: 'paws-up', title: 'اللعب والمرح', desc: 'وقت ممتع وآمن في مساحات اللعب', color: 'yellow' },
    { pose: 'clipboard-write', title: 'الأنشطة الإبداعية', desc: 'فنون وأنشطة تنمّي مهارات طفلك', color: 'green' },
    { pose: 'party-confetti', title: 'الاحتفال', desc: 'لحظات احتفال لا تُنسى', color: 'orange' },
    { pose: 'gift-magic', title: 'الهدية', desc: 'هدية صغيرة تخرج بها مبتسمة', color: 'red' },
  ];

  // Static parent-area cards (presentation-only)
  const parentPerks = [
    { icon: Wifi, title: 'WiFi مجاني', desc: 'إنترنت سريع طوال زيارتك' },
    { icon: Coffee, title: 'كافيه مريح', desc: 'مشروبات وقهوة بانتظارك' },
    { icon: Eye, title: 'راحة ومتابعة', desc: 'رؤية واضحة لطفلك أثناء اللعب' },
  ];

  // Color helpers (Tailwind-friendly maps to keep accents predictable)
  const accentMap = {
    red:    { strip: 'bg-[#E63946]',  ring: 'ring-[#E63946]/20', soft: 'bg-[#E63946]/10', text: 'text-[#E63946]', border: 'border-[#E63946]/25' },
    yellow: { strip: 'bg-[#FFD166]',  ring: 'ring-[#E8A80B]/20', soft: 'bg-[#FFD166]/25', text: 'text-[#9A6B00]', border: 'border-[#FFD166]/60' },
    green:  { strip: 'bg-[#7AC74F]',  ring: 'ring-[#7AC74F]/20', soft: 'bg-[#7AC74F]/12', text: 'text-[#3F7A1E]', border: 'border-[#7AC74F]/30' },
    blue:   { strip: 'bg-[#4A90D9]',  ring: 'ring-[#4A90D9]/20', soft: 'bg-[#4A90D9]/10', text: 'text-[#1E5BA8]', border: 'border-[#4A90D9]/25' },
    orange: { strip: 'bg-[#E8872E]',  ring: 'ring-[#E8872E]/20', soft: 'bg-[#E8872E]/10', text: 'text-[#B25E0F]', border: 'border-[#E8872E]/25' },
  };

  const showHeroImage = heroImageReady && !!heroImgSrc && !heroImageError;
  const canOpenLightbox = showHeroImage;

  return (
    <div className="min-h-screen bg-[#FFF8F0] text-[#2D2D2D]" dir="rtl">
      {/* ================== 1. HERO ================== */}
      <section className="relative overflow-hidden">
        {/* Warm cream → soft yellow gradient backdrop */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-gradient-to-b from-[#FFF8F0] via-[#FFF3DE] to-[#FFF8F0]"
        />
        {/* Subtle sky + sun (only here) */}
        <div className="absolute inset-0 opacity-60 pointer-events-none" aria-hidden="true">
          <SkyBackground />
        </div>
        <div className="hidden md:block absolute top-8 left-8 opacity-90 pointer-events-none" aria-hidden="true">
          <SmilingSun className="w-24 h-24" />
        </div>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 md:pt-24 pb-20 md:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            {/* Text block (right in RTL) */}
            <div className="space-y-6 text-right">
              <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/80 backdrop-blur border border-[#FFD166]/60 text-sm font-bold text-[#9A6B00] shadow-sm">
                <img src={logoImg} alt="Peekaboo" className="h-5 object-contain" />
                <span>We bring happiness</span>
              </div>

              <h1
                className="font-heading text-4xl sm:text-5xl md:text-6xl font-extrabold text-[#2D2D2D] leading-[1.15] tracking-tight"
                data-testid="hero-title"
              >
                {heroConfig.title}
              </h1>

              <p className="text-lg sm:text-xl text-[#2D2D2D]/70 max-w-xl leading-relaxed">
                {heroConfig.subtitle}
              </p>

              <ul className="flex flex-wrap gap-x-5 gap-y-2 pt-1">
                {trustBullets.map((bullet) => (
                  <li key={bullet} className="flex items-center gap-2 text-sm font-semibold text-[#2D2D2D]/80">
                    <CheckCircle2 className="h-4 w-4 text-[#E63946]" />
                    {bullet}
                  </li>
                ))}
              </ul>

              <div className="flex flex-col sm:flex-row gap-3 pt-4">
                <Link to={heroConfig.ctaRoute} className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="w-full rounded-full text-base px-8 h-14 bg-[#E63946] hover:bg-[#cf2f3c] text-white shadow-lg shadow-[#E63946]/25 transition-all"
                    data-testid="hero-primary-btn"
                  >
                    {heroConfig.ctaText}
                  </Button>
                </Link>
                <a href={whatsappUrl} target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                  <Button
                    size="lg"
                    className="w-full rounded-full text-base px-8 h-14 bg-[#7AC74F] hover:bg-[#6ab33f] text-white shadow-lg shadow-[#7AC74F]/25 transition-all"
                    data-testid="hero-whatsapp-btn"
                  >
                    <MessageCircle className="h-5 w-5 ml-2" />
                    واتساب
                  </Button>
                </a>
                {!isAuthenticated && (
                  <Link to="/register" className="w-full sm:w-auto">
                    <Button
                      size="lg"
                      variant="outline"
                      className="w-full rounded-full text-base px-8 h-14 border-2 border-[#E8872E]/40 text-[#B25E0F] bg-white/70 hover:bg-[#FFD166]/30 hover:border-[#E8872E]/70"
                      data-testid="hero-secondary-btn"
                    >
                      سجل مجاناً
                    </Button>
                  </Link>
                )}
              </div>
            </div>

            {/* Visual block (left in RTL) */}
            <div className="relative">
              <div
                className={`relative w-full aspect-square md:aspect-[4/3] lg:aspect-square rounded-[2rem] overflow-hidden shadow-2xl ring-1 ring-black/5 bg-white ${
                  canOpenLightbox ? 'cursor-pointer hover:shadow-[0_25px_55px_-15px_rgba(230,57,70,0.35)] transition-shadow' : ''
                }`}
                onClick={() => canOpenLightbox && setLightboxOpen(true)}
                role={canOpenLightbox ? 'button' : undefined}
                tabIndex={canOpenLightbox ? 0 : -1}
                onKeyDown={(e) => canOpenLightbox && e.key === 'Enter' && setLightboxOpen(true)}
                data-testid="hero-image-clickable"
              >
                {!showHeroImage ? (
                  <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-[#FFD166]/30 to-[#FFF8F0] text-[#2D2D2D]/50 font-semibold">
                    جاري التحميل...
                  </div>
                ) : (
                  <img
                    src={heroImgSrc}
                    alt="أطفال يلعبون في بيكابو"
                    className="w-full h-full object-cover"
                    loading="eager"
                    decoding="async"
                    onError={() => setHeroImageError(true)}
                  />
                )}
              </div>

              {/* Soft accent dots */}
              <div className="hidden md:block absolute -top-4 -left-4 w-20 h-20 rounded-full bg-[#FFD166]/40 blur-xl" aria-hidden="true" />
              <div className="hidden md:block absolute -bottom-6 right-6 w-24 h-24 rounded-full bg-[#7AC74F]/30 blur-xl" aria-hidden="true" />

              {/* Shroomi #1: Hero wave — placed clearly aside, never overlapping */}
              <div
                className="hidden lg:block absolute -bottom-6 -left-10 z-10 pointer-events-none drop-shadow-xl"
                aria-hidden="true"
              >
                <Shroomi pose="wave" size={170} />
              </div>
            </div>
          </div>
        </div>

        {/* Soft wave divider into next section */}
        <div
          aria-hidden="true"
          className="relative h-12 -mt-1"
          style={{
            background:
              'radial-gradient(ellipse at 50% 0%, rgba(122,199,79,0.15) 0%, rgba(255,248,240,0) 70%)',
          }}
        />
      </section>

      {/* Hero Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/95 backdrop-blur-sm flex items-center justify-center p-4 sm:p-8"
          onClick={() => setLightboxOpen(false)}
          data-testid="lightbox-overlay"
        >
          <button
            className="absolute top-6 right-6 p-2 bg-white/10 hover:bg-white/20 rounded-full text-white transition-colors"
            onClick={() => setLightboxOpen(false)}
            aria-label="إغلاق"
          >
            <img src={closeIcon} alt="" className="h-6 w-6 invert" />
          </button>
          <img
            src={heroImgSrc}
            alt="عرض كامل"
            className="max-w-full max-h-full rounded-2xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
            data-testid="lightbox-image"
          />
        </div>
      )}

      {showDeferredSections && (
        <>
          {/* ================== 2. PEEKABOO JOURNEY ================== */}
          <section className="relative py-16 md:py-24 bg-gradient-to-b from-[#F1FAEA] via-[#F6FBEF] to-[#FFF8F0]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <span className="inline-block px-4 py-1.5 rounded-full bg-[#7AC74F]/15 text-[#3F7A1E] text-sm font-bold mb-4">
                  رحلة بيكابو
                </span>
                <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#2D2D2D] mb-3">
                  رحلة طفلك في بيكابو 🎠
                </h2>
                <p className="text-lg text-[#2D2D2D]/65">
                  من لحظة الوصول إلى لحظة الوداع — كل خطوة مصممة بعناية.
                </p>
              </div>

              {/* Horizontal scroll on mobile, grid on lg */}
              <div className="relative">
                <div className="flex lg:grid lg:grid-cols-6 gap-4 overflow-x-auto pb-6 lg:pb-0 snap-x snap-mandatory peekaboo-hide-scrollbar">
                  {journeySteps.map((step, idx) => {
                    const a = accentMap[step.color];
                    return (
                      <div
                        key={step.title}
                        className="snap-start shrink-0 w-[78%] sm:w-[46%] md:w-[32%] lg:w-auto relative"
                      >
                        <div className={`relative h-full bg-white rounded-3xl border ${a.border} shadow-[0_8px_24px_rgba(45,45,45,0.06)] hover:shadow-[0_14px_30px_rgba(45,45,45,0.10)] transition-shadow p-5 pt-7 flex flex-col items-center text-center`}>
                          {/* Step number */}
                          <div className={`absolute -top-4 ${a.strip} text-white text-sm font-extrabold w-9 h-9 rounded-full flex items-center justify-center shadow-md ring-4 ring-[#FFF8F0]`}>
                            {idx + 1}
                          </div>
                          <div className={`w-24 h-24 rounded-2xl ${a.soft} flex items-center justify-center mb-3`}>
                            <Shroomi pose={step.pose} size={86} />
                          </div>
                          <h3 className="font-bold text-base text-[#2D2D2D] mb-1.5">{step.title}</h3>
                          <p className="text-xs text-[#2D2D2D]/60 leading-relaxed">{step.desc}</p>
                        </div>
                        {/* Connector arrow (desktop, between cards) */}
                        {idx < journeySteps.length - 1 && (
                          <div className="hidden lg:flex absolute top-1/2 -left-3 -translate-y-1/2 z-10 items-center justify-center w-6 h-6 text-[#7AC74F]" aria-hidden="true">
                            <ArrowLeft className="h-5 w-5" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </section>

          {/* ================== 3. OUR SERVICES ================== */}
          <section className="relative py-16 md:py-24 bg-[#FFF8F0]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <span className="inline-block px-4 py-1.5 rounded-full bg-[#E8872E]/12 text-[#B25E0F] text-sm font-bold mb-4">
                  خدماتنا
                </span>
                <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#2D2D2D] mb-3" data-testid="features-title">
                  خدماتنا 🎯
                </h2>
                <p className="text-lg text-[#2D2D2D]/65">
                  كل ما تحتاجه ليوم لعب مثالي وحفلات لا تُنسى.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {features.map((feature, index) => {
                  const a = accentMap[feature.accent] || accentMap.blue;
                  return (
                    <div
                      key={index}
                      className={`group relative bg-white rounded-3xl border border-black/5 shadow-[0_10px_30px_rgba(45,45,45,0.06)] hover:shadow-[0_18px_40px_rgba(45,45,45,0.10)] hover:-translate-y-1 transition-all duration-300 overflow-hidden flex flex-col ${
                        feature.disabled ? 'opacity-75' : ''
                      }`}
                      data-testid={`feature-card-${index}`}
                    >
                      {/* Color-coded top strip */}
                      <div className={`h-1.5 w-full ${a.strip}`} />

                      <div className="p-7 flex flex-col h-full">
                        {feature.isCoreOffer && (
                          <span className="absolute top-5 left-5 bg-[#E63946] text-white text-[11px] font-bold px-3 py-1 rounded-full shadow-sm">
                            الأكثر طلباً
                          </span>
                        )}
                        <div className={`w-16 h-16 rounded-2xl ${a.soft} flex items-center justify-center mb-5 ring-1 ring-inset ${a.border}`}>
                          <img src={feature.icon} alt="" className="w-9 h-9" />
                        </div>
                        <h3 className="font-bold text-xl text-[#2D2D2D] mb-2.5">{feature.title}</h3>
                        <p className="text-sm text-[#2D2D2D]/65 mb-6 flex-grow leading-relaxed">{feature.description}</p>

                        <div className="mt-auto">
                          {feature.disabled ? (
                            <Button
                              disabled
                              className="w-full rounded-full bg-[#F2EDE4] text-[#2D2D2D]/50 hover:bg-[#F2EDE4] cursor-not-allowed"
                              data-testid={`feature-btn-${index}`}
                            >
                              {feature.buttonText}
                            </Button>
                          ) : (
                            <Link to={feature.link} className="block w-full">
                              <Button
                                className={`w-full rounded-full ${a.strip} text-white hover:opacity-90 transition-opacity shadow-sm`}
                                data-testid={`feature-btn-${index}`}
                              >
                                {feature.buttonText}
                              </Button>
                            </Link>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* ================== 4. WHY PEEKABOO ================== */}
          <section className="relative py-16 md:py-24 bg-gradient-to-b from-[#EAF3FB] via-[#F0F7FC] to-[#FFF8F0]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
                {/* Left intro column with single accent Shroomi */}
                <div className="lg:col-span-4 text-right relative">
                  <span className="inline-block px-4 py-1.5 rounded-full bg-[#4A90D9]/15 text-[#1E5BA8] text-sm font-bold mb-4">
                    ليش بيكابو
                  </span>
                  <h2
                    className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#2D2D2D] mb-4 leading-tight"
                    data-testid="why-peekaboo-box"
                  >
                    ليش بيكابو؟ 💛
                  </h2>
                  <p className="text-lg text-[#2D2D2D]/65 leading-relaxed mb-6">
                    لأننا نهتم بكل تفصيلة تصنع تجربة آمنة وممتعة لطفلك ولك.
                  </p>
                  {/* Shroomi #3 — single supporting accent */}
                  <div className="hidden lg:flex justify-start pr-2">
                    <Shroomi pose="heart-hold" size={170} />
                  </div>
                </div>

                {/* Feature grid */}
                <div className="lg:col-span-8 grid grid-cols-1 sm:grid-cols-2 gap-5">
                  {whyPeekabooFeatures.map((feature, index) => (
                    <div
                      key={index}
                      className="bg-white rounded-2xl p-6 border border-black/5 shadow-[0_8px_20px_rgba(45,45,45,0.05)] hover:shadow-[0_14px_28px_rgba(45,45,45,0.09)] transition-shadow flex items-start gap-4"
                    >
                      <div className="shrink-0 w-12 h-12 rounded-xl bg-[#FFD166]/30 flex items-center justify-center text-2xl">
                        {feature.icon}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-base text-[#2D2D2D] mb-1.5">{feature.title}</h3>
                        <p className="text-sm text-[#2D2D2D]/65 leading-relaxed">{feature.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ================== 5. PARENT AREA ================== */}
          <section className="relative py-16 md:py-20 bg-[#FFF8F0]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="bg-white rounded-[2rem] border border-[#FFD166]/40 shadow-[0_10px_30px_rgba(45,45,45,0.06)] p-8 md:p-12">
                <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                  <div className="md:col-span-5 text-right">
                    <span className="inline-block px-4 py-1.5 rounded-full bg-[#FFD166]/30 text-[#9A6B00] text-sm font-bold mb-4">
                      للأهالي
                    </span>
                    <h2 className="font-heading text-3xl sm:text-4xl font-extrabold text-[#2D2D2D] mb-3 leading-tight">
                      منطقة الأهالي ☕
                    </h2>
                    <p className="text-base text-[#2D2D2D]/65 leading-relaxed mb-6">
                      استرخِ في منطقة مخصصة للأهالي مع رؤية واضحة لطفلك أثناء اللعب — اشرب قهوتك ولا تشيل هم.
                    </p>
                    {/* Shroomi #4 */}
                    <div className="hidden md:block">
                      <Shroomi pose="thumbs-up" size={120} />
                    </div>
                  </div>

                  <div className="md:col-span-7 grid grid-cols-1 sm:grid-cols-3 gap-4">
                    {parentPerks.map((perk) => {
                      const Icon = perk.icon;
                      return (
                        <div
                          key={perk.title}
                          className="bg-[#FFF8F0] rounded-2xl border border-black/5 p-5 text-center hover:shadow-md transition-shadow"
                        >
                          <div className="w-12 h-12 mx-auto rounded-xl bg-[#7AC74F]/15 flex items-center justify-center mb-3">
                            <Icon className="h-6 w-6 text-[#3F7A1E]" />
                          </div>
                          <h3 className="font-bold text-base text-[#2D2D2D] mb-1">{perk.title}</h3>
                          <p className="text-xs text-[#2D2D2D]/65 leading-relaxed">{perk.desc}</p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* ================== 6. GALLERY ================== */}
          <section className="relative py-16 md:py-24 bg-gradient-to-b from-[#FFF8F0] via-[#FFF3DE] to-[#FFF8F0]">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="text-center max-w-2xl mx-auto mb-12">
                <span className="inline-block px-4 py-1.5 rounded-full bg-[#E63946]/12 text-[#E63946] text-sm font-bold mb-4">
                  لقطات حقيقية
                </span>
                <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold text-[#2D2D2D] mb-3" data-testid="gallery-title">
                  لحظات ممتعة في بيكابو
                </h2>
                <p className="text-lg text-[#2D2D2D]/65">
                  لمحات من الفرح والمرح اليومي.
                </p>
              </div>

              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-5 auto-rows-[180px] md:auto-rows-[260px]">
                {gallery.length > 0 ? (
                  gallery.slice(0, 6).map((item, index) => (
                    <div
                      key={item.id}
                      className={`relative rounded-3xl overflow-hidden bg-white shadow-[0_10px_25px_rgba(45,45,45,0.08)] hover:shadow-[0_18px_35px_rgba(45,45,45,0.12)] transition-shadow ring-1 ring-black/5 ${
                        index === 0 ? 'col-span-2 row-span-2' : ''
                      }`}
                      data-testid={`gallery-item-${index}`}
                    >
                      {item.type === 'video' ? (
                        <>
                          <video
                            src={resolveMediaUrl(item.url)}
                            className="w-full h-full object-cover"
                            preload="none"
                            muted
                            playsInline
                          />
                          <div className="absolute inset-0 flex items-center justify-center bg-black/15">
                            <div className="w-14 h-14 rounded-full bg-white/95 backdrop-blur-sm flex items-center justify-center shadow-lg">
                              <div className="w-0 h-0 border-t-[7px] border-t-transparent border-l-[12px] border-l-[#2D2D2D] border-b-[7px] border-b-transparent ml-1"></div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <img
                          src={resolveMediaUrl(item.url)}
                          alt={item.title || 'صورة من المعرض'}
                          className="w-full h-full object-cover hover:scale-[1.04] transition-transform duration-700"
                          loading="lazy"
                          decoding="async"
                        />
                      )}
                    </div>
                  ))
                ) : (
                  <div className="col-span-full py-20 text-center text-[#2D2D2D]/50 bg-white rounded-3xl border border-dashed border-black/10">
                    لا توجد صور حالياً في المعرض
                  </div>
                )}
              </div>
            </div>
          </section>

          {/* ================== 7. LOCATION + HOURS (static brand info) ================== */}
          <section className="relative py-14 md:py-20 bg-[#FFF8F0]">
            <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-[0_8px_22px_rgba(45,45,45,0.05)] flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#E63946]/12 flex items-center justify-center shrink-0">
                    <MapPin className="h-6 w-6 text-[#E63946]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-[#2D2D2D] mb-1">موقعنا</h3>
                    <p className="text-sm text-[#2D2D2D]/70 leading-relaxed">إربد — شارع أبو راشد</p>
                  </div>
                </div>

                <div className="bg-white rounded-3xl p-6 border border-black/5 shadow-[0_8px_22px_rgba(45,45,45,0.05)] flex items-start gap-4">
                  <div className="w-12 h-12 rounded-xl bg-[#4A90D9]/12 flex items-center justify-center shrink-0">
                    <Clock className="h-6 w-6 text-[#1E5BA8]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-[#2D2D2D] mb-1">ساعات العمل</h3>
                    <p className="text-sm text-[#2D2D2D]/70 leading-relaxed">يومياً من 10 صباحاً حتى 12 منتصف الليل</p>
                  </div>
                </div>

                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="bg-white rounded-3xl p-6 border border-black/5 shadow-[0_8px_22px_rgba(45,45,45,0.05)] flex items-start gap-4 hover:shadow-[0_14px_30px_rgba(45,45,45,0.10)] transition-shadow"
                >
                  <div className="w-12 h-12 rounded-xl bg-[#7AC74F]/15 flex items-center justify-center shrink-0">
                    <Phone className="h-6 w-6 text-[#3F7A1E]" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-[#2D2D2D] mb-1">تواصل معنا</h3>
                    <p className="text-sm text-[#2D2D2D]/70 leading-relaxed">واتساب — رد سريع</p>
                  </div>
                </a>
              </div>
            </div>
          </section>

          {/* ================== 8. FINAL CTA ================== */}
          <section className="relative py-16 md:py-24 px-4 sm:px-6 lg:px-8">
            <div className="max-w-6xl mx-auto">
              <div className="relative overflow-hidden rounded-[2.5rem] bg-gradient-to-br from-[#E63946] via-[#E8872E] to-[#FFD166] p-10 sm:p-14 md:p-20 shadow-[0_25px_60px_-20px_rgba(230,57,70,0.45)]">
                {/* Decorative blobs */}
                <div className="absolute -top-16 -right-16 w-64 h-64 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />
                <div className="absolute -bottom-20 -left-10 w-72 h-72 rounded-full bg-white/10 blur-2xl" aria-hidden="true" />

                <div className="relative z-10 grid grid-cols-1 md:grid-cols-12 gap-8 items-center">
                  <div className="md:col-span-8 text-right text-white">
                    <span className="inline-block px-4 py-1.5 rounded-full bg-white/20 backdrop-blur text-white text-sm font-bold mb-4">
                      جاهز للحجز
                    </span>
                    <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-extrabold mb-4 leading-tight" data-testid="cta-title">
                      جاهز تحجز؟ 🎉
                    </h2>
                    <p className="text-base sm:text-lg text-white/90 max-w-xl leading-relaxed mb-7">
                      احجز جلسة لعب أو حفلة عيد ميلاد لطفلك اليوم — تجربة لا تُنسى بانتظاركم.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-3">
                      <Link to={heroConfig.ctaRoute || '/tickets'}>
                        <Button
                          size="lg"
                          className="w-full sm:w-auto rounded-full bg-white text-[#E63946] hover:bg-white/95 text-base px-8 h-14 font-bold shadow-xl hover:scale-[1.02] transition-transform"
                          data-testid="cta-signup-btn"
                        >
                          {heroConfig.ctaText || 'احجز جلسة'}
                        </Button>
                      </Link>
                      <a href={whatsappUrl} target="_blank" rel="noreferrer">
                        <Button
                          size="lg"
                          className="w-full sm:w-auto rounded-full bg-[#0E5C2A] hover:bg-[#0a4a22] text-white text-base px-8 h-14 font-bold shadow-xl"
                        >
                          <MessageCircle className="h-5 w-5 ml-2" />
                          واتساب
                        </Button>
                      </a>
                    </div>
                  </div>

                  {/* Shroomi #5 — Final CTA */}
                  <div className="md:col-span-4 flex justify-center md:justify-end" aria-hidden="true">
                    <Shroomi pose="party-big" size={220} className="drop-shadow-2xl" />
                  </div>
                </div>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
