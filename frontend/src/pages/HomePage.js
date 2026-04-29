import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, CheckCircle2 } from 'lucide-react';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { useAuth } from '../context/AuthContext';
import Shroomi from '../components/Shroomi';
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
          // Keep first paint responsive and do not block hero rendering on gallery API latency
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

  const features = [
    {
      id: 'hourly',
      icon: playHourIcon,
      title: 'اللعب بالساعة',
      description: 'احجز جلسات لعب لأطفالك واختر الوقت المثالي!',
      link: '/tickets',
      buttonText: 'احجز الآن',
      isCoreOffer: true
    },
    {
      id: 'birthdays',
      icon: birthdayCakeIcon,
      title: 'حفلات أعياد الميلاد',
      description: 'احتفل مع ثيمات رائعة وحفلات مخصصة!',
      link: '/birthday',
      buttonText: 'خطط لحفلتك',
      isCoreOffer: true
    },
    {
      id: 'subscriptions',
      icon: crownIcon,
      title: 'الاشتراكات',
      description: 'وفّر مع باقات الزيارات بصلاحية 30 يوم!',
      link: '/subscriptions',
      buttonText: 'اشترك الآن',
      isCoreOffer: true
    },
    {
      id: 'schools',
      icon: schoolBusIcon,
      title: 'المدارس والمجموعات',
      description: 'رحلات مدرسية وبرامج لعب آمنة للمجموعات',
      link: '/groups',
      buttonText: 'تواصل معنا',
    },
    {
      icon: homePartyIcon,
      title: 'حفلتك في بيتك',
      description: 'نأتيكم للمنزل مع ديكور واحتفال كامل!',
      link: '/home-party',
      buttonText: 'احجز حفلتك',
    },
    {
      icon: careHeartIcon,
      title: 'ذوي الهمم',
      description: 'برامج مخصصة لأصحاب الاحتياجات الخاصة',
      link: null,
      buttonText: 'قريباً',
      disabled: true
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

  const showHeroImage = heroImageReady && !!heroImgSrc && !heroImageError;
  const canOpenLightbox = showHeroImage;

  return (
    <div className="min-h-screen bg-[#EAF8FF] text-slate-900" dir="rtl">
      {/* 1. Hero Section */}
      <section className="relative pt-20 pb-16 md:pt-28 md:pb-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center relative z-10">
          
          <div className="space-y-6 text-right">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200 text-sm font-medium text-slate-600">
              <img src={logoImg} alt="Peekaboo" className="h-5 object-contain" />
              <span>We bring happiness</span>
            </div>
            
            <div className="inline-flex items-center text-xs font-medium text-amber-600 bg-amber-50 px-3 py-1 rounded-full mb-2">
              🚧 الموقع تحت التطوير — قريباً سيكون متاحاً بالكامل
            </div>

            <h1 className="font-heading text-4xl sm:text-5xl md:text-6xl font-extrabold text-slate-900 leading-tight" data-testid="hero-title">
              {heroConfig.title}
            </h1>
            
            <p className="text-lg sm:text-xl text-slate-600 max-w-lg leading-relaxed">
              {heroConfig.subtitle}
            </p>

            <ul className="flex flex-wrap gap-4 pt-2">
              {trustBullets.map((bullet) => (
                <li key={bullet} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <CheckCircle2 className="h-4 w-4 text-rose-500" />
                  {bullet}
                </li>
              ))}
            </ul>

            <div className="flex flex-col sm:flex-row gap-4 pt-4">
              <Link to={heroConfig.ctaRoute} className="w-full sm:w-auto">
                <Button size="lg" className="w-full rounded-full text-base px-8 h-14 bg-rose-500 hover:bg-rose-600 text-white shadow-lg shadow-rose-500/25 transition-all" data-testid="hero-primary-btn">
                  {heroConfig.ctaText}
                </Button>
              </Link>
              {!isAuthenticated && (
                <Link to="/register" className="w-full sm:w-auto">
                  <Button size="lg" variant="outline" className="w-full rounded-full text-base px-8 h-14 border-orange-300 text-orange-700 hover:bg-orange-50" data-testid="hero-secondary-btn">
                    سجل مجاناً
                  </Button>
                </Link>
              )}
              <a href={whatsappUrl} target="_blank" rel="noreferrer" className="w-full sm:w-auto">
                <Button size="lg" className="w-full rounded-full text-base px-8 h-14 bg-emerald-500 hover:bg-emerald-600 text-white shadow-lg shadow-emerald-500/25 transition-all" data-testid="hero-whatsapp-btn">
                  <MessageCircle className="h-5 w-5 ml-2" />
                  واتساب
                </Button>
              </a>
            </div>
          </div>

          <div className="relative w-full aspect-square md:aspect-[4/3] lg:aspect-square">
            <div 
              className={`w-full h-full rounded-3xl overflow-hidden shadow-2xl relative z-10 bg-slate-200 ${canOpenLightbox ? 'cursor-pointer hover:shadow-3xl transition-shadow' : ''}`}
              onClick={() => canOpenLightbox && setLightboxOpen(true)}
              role={canOpenLightbox ? 'button' : undefined}
              tabIndex={canOpenLightbox ? 0 : -1}
              onKeyDown={(e) => canOpenLightbox && e.key === 'Enter' && setLightboxOpen(true)}
              data-testid="hero-image-clickable"
            >
              {!showHeroImage ? (
                <div className="w-full h-full flex items-center justify-center bg-sky-50 text-slate-400 font-medium">
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
            
            {/* Placement 1: Hero Shroomi (Side/Back) */}
            <div className="hidden lg:block absolute -right-16 bottom-8 z-0 opacity-90 pointer-events-none" aria-hidden="true">
              <Shroomi pose="point-side" size={180} />
            </div>
          </div>

        </div>
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
          {/* 2. Why Peekaboo Section */}
          <section className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-slate-200/60">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <Badge variant="secondary" className="mb-4 bg-sky-100 text-sky-700 hover:bg-sky-100 border-none px-3 py-1 text-sm font-medium">لماذا بيكابو</Badge>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-slate-900 mb-4" data-testid="why-peekaboo-box">
                ماذا يميزنا؟
              </h2>
              <p className="text-lg text-slate-600">
                لأننا نهتم بالتفاصيل التي تصنع تجربة آمنة وممتعة لطفلك.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-6">
              {whyPeekabooFeatures.map((feature, index) => (
                <Card key={index} className="bg-white border-slate-100 shadow-sm hover:shadow-md transition-shadow">
                  <CardContent className="p-6 text-center flex flex-col items-center h-full">
                    <div className="w-12 h-12 rounded-full bg-sky-50 flex items-center justify-center text-2xl mb-4 border border-sky-100 shadow-sm">
                      {feature.icon}
                    </div>
                    <h3 className="font-bold text-base text-slate-900 mb-2">{feature.title}</h3>
                    <p className="text-sm text-slate-500 leading-relaxed flex-grow">{feature.description}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* 3. Services / What We Offer */}
          <section className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto bg-white rounded-3xl shadow-sm border border-sky-100 mb-16 md:mb-24">
            <div className="text-center max-w-2xl mx-auto mb-12 relative">
              <Badge variant="secondary" className="mb-4 bg-orange-100 text-orange-700 hover:bg-orange-100 border-none px-3 py-1 text-sm font-medium">خدماتنا</Badge>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-slate-900 mb-4" data-testid="features-title">
                ماذا نقدم
              </h2>
              <p className="text-lg text-slate-600">
                كل ما تحتاجه ليوم لعب مثالي!
              </p>
              
              {/* Placement 2: Services Header Mascot */}
              <div className="hidden md:block absolute -top-8 right-0 pointer-events-none opacity-90" aria-hidden="true">
                <Shroomi pose="jump-cheer" size={80} />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {features.map((feature, index) => (
                <Card 
                  key={index} 
                  className={`bg-sky-50 border-sky-100 overflow-hidden hover:shadow-lg transition-all duration-300 flex flex-col ${feature.disabled ? 'opacity-70 grayscale-[0.5]' : ''}`}
                  data-testid={`feature-card-${index}`}
                >
                  <CardContent className="p-6 flex flex-col items-center text-center h-full relative">
                    {feature.isCoreOffer && (
                      <Badge className="absolute top-4 right-4 bg-rose-600 text-white border-none shadow-sm z-10">الأكثر طلباً</Badge>
                    )}
                    <div className="w-16 h-16 rounded-2xl bg-white flex items-center justify-center mb-5 shadow-sm border border-slate-100">
                      <img src={feature.icon} alt="" className="w-8 h-8 opacity-80" />
                    </div>
                    <h3 className="font-bold text-xl text-slate-900 mb-3">{feature.title}</h3>
                    <p className="text-sm text-slate-600 mb-6 flex-grow leading-relaxed">{feature.description}</p>
                    
                    <div className="w-full mt-auto">
                      {feature.disabled ? (
                        <Button disabled className="w-full rounded-xl bg-slate-200 text-slate-500 hover:bg-slate-200" data-testid={`feature-btn-${index}`}>
                          {feature.buttonText}
                        </Button>
                      ) : (
                        <Link to={feature.link} className="block w-full">
                          <Button className="w-full rounded-xl bg-rose-50 border border-rose-200 text-rose-700 hover:bg-rose-100 hover:text-rose-800 shadow-sm" data-testid={`feature-btn-${index}`}>
                            {feature.buttonText}
                          </Button>
                        </Link>
                      )}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>

          {/* 4. Gallery Section */}
          <section className="py-16 md:py-24 px-4 sm:px-6 lg:px-8 max-w-7xl mx-auto border-t border-slate-200/60">
            <div className="text-center max-w-2xl mx-auto mb-12">
              <Badge variant="secondary" className="mb-4 bg-rose-100 text-rose-700 hover:bg-rose-100 border-none px-3 py-1 text-sm font-medium">لقطات حقيقية</Badge>
              <h2 className="font-heading text-3xl sm:text-4xl font-bold text-slate-900 mb-4" data-testid="gallery-title">
                لحظات ممتعة في بيكابو
              </h2>
              <p className="text-lg text-slate-600 mb-6">
                شاهد ما يجعلنا مميزين!
              </p>
              <div className="inline-flex items-center justify-center bg-gradient-to-r from-rose-600 to-orange-500 text-white px-5 py-2.5 rounded-full text-sm font-medium shadow-sm">
                مفتوح يومياً من 10 صباحاً حتى 12 منتصف الليل
              </div>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 auto-rows-[200px] md:auto-rows-[280px]">
              {gallery.length > 0 ? (
                gallery.slice(0, 6).map((item, index) => (
                  <div 
                    key={item.id} 
                    className={`relative rounded-2xl overflow-hidden bg-slate-100 shadow-sm border border-slate-200 ${index === 0 ? 'col-span-2 row-span-2' : ''}`}
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
                        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/20">
                          <div className="w-12 h-12 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-lg">
                            <div className="w-0 h-0 border-t-[6px] border-t-transparent border-l-[10px] border-l-slate-900 border-b-[6px] border-b-transparent ml-1"></div>
                          </div>
                        </div>
                      </>
                    ) : (
                      <img 
                        src={resolveMediaUrl(item.url)} 
                        alt={item.title || 'صورة من المعرض'} 
                        className="w-full h-full object-cover hover:scale-105 transition-transform duration-500"
                        loading="lazy"
                        decoding="async"
                      />
                    )}
                  </div>
                ))
              ) : (
                <div className="col-span-full py-20 text-center text-slate-500 bg-white rounded-3xl border border-sky-100 border-dashed">
                  لا توجد صور حالياً في المعرض
                </div>
              )}
            </div>
          </section>

          {/* 5. Final CTA Section */}
          {!isAuthenticated && (
            <section className="py-20 md:py-32 px-4 sm:px-6 lg:px-8 max-w-5xl mx-auto text-center relative">
              <div className="bg-slate-900 rounded-[3rem] p-10 sm:p-16 md:p-20 shadow-2xl relative overflow-hidden">
                {/* Subtle dark pattern overlay */}
                <div className="absolute inset-0 opacity-10 bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-white to-transparent" aria-hidden="true"></div>
                
                <div className="relative z-10">
                  <img src={logoImg} alt="Peekaboo" className="h-16 mx-auto mb-8 brightness-0 invert opacity-90" />
                  
                  <h2 className="font-heading text-3xl sm:text-4xl md:text-5xl font-bold text-white mb-6" data-testid="cta-title">
                    هل أنت مستعد للمتعة؟
                  </h2>
                  
                  <p className="text-slate-300 text-lg sm:text-xl max-w-2xl mx-auto mb-10 leading-relaxed">
                    أنشئ حسابك المجاني لحجز الجلسات، تتبع نقاط الولاء، والحصول على عروض حصرية!
                  </p>
                  
                  <Link to="/register" className="inline-block">
                    <Button
                      size="lg"
                      className="rounded-full bg-white text-slate-900 hover:bg-slate-100 text-lg px-12 h-16 font-bold shadow-xl transition-transform hover:scale-105"
                      data-testid="cta-signup-btn"
                    >
                      سجّل الآن للبدء
                    </Button>
                  </Link>
                </div>

                {/* Placement 3: Final CTA Shroomi */}
                <div className="hidden lg:block absolute bottom-0 left-12 pointer-events-none opacity-90" aria-hidden="true">
                  <Shroomi pose="thumbs-up-big" size={140} />
                </div>
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
