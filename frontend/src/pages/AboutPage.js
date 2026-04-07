import { Heart, Shield, Sparkles, Users, MapPin, Clock, Phone, Map } from 'lucide-react';
import { Button } from '../components/ui/button';
import PublicPageShell, { WonderSection, WonderSectionTitle, WonderCard } from '../components/PublicPageShell';
import { useAuth } from '../context/AuthContext';
import logoImg from '../assets/logo.png';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '').replace(/\/api$/i, '');

const resolveMediaUrl = (url) => {
  if (!url) return '';

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

export default function AboutPage() {
  const { api } = useAuth();
  const [heroImage, setHeroImage] = useState('');

  const values = [
    { icon: Shield, title: 'السلامة أولاً', desc: 'بيئة آمنة ومعدات مطابقة للمعايير', color: 'blue' },
    { icon: Sparkles, title: 'متعة بلا حدود', desc: 'ألعاب متنوعة وأنشطة ممتعة', color: 'yellow' },
    { icon: Heart, title: 'حفلات مميزة', desc: 'أعياد ميلاد وحفلات لا تُنسى', color: 'pink' },
    { icon: Users, title: 'فريق متخصص', desc: 'طاقم مدرب للإشراف والرعاية', color: 'green' },
  ];

  useEffect(() => {
    let isActive = true;

    const loadHeroImage = async () => {
      try {
        const settingsResult = await api.get('/settings');
        const heroImageSetting = settingsResult?.data?.settings?.hero_image || '';
        if (isActive) {
          setHeroImage(heroImageSetting ? resolveMediaUrl(heroImageSetting) : '');
        }
      } catch (error) {
        if (isActive) {
          setHeroImage('');
        }
      }
    };

    loadHeroImage();

    return () => {
      isActive = false;
    };
  }, [api]);

  return (
    <PublicPageShell
      title="من نحن"
      subtitle="بيكابو يصنع السعادة"
    >
      {/* Logo */}
      <div className="text-center mb-6">
        <img src={logoImg} alt="بيكابو" className="h-24 mx-auto drop-shadow-lg" />
      </div>

      {/* Editable Hero Image */}
      {heroImage ? (
        <WonderSection>
          <div className="overflow-hidden rounded-3xl border-4 border-[var(--pk-yellow)]/60 shadow-lg">
            <img
              src={heroImage}
              alt="صورة بيكابو الرئيسية"
              className="w-full h-[220px] sm:h-[300px] object-cover"
              loading="lazy"
            />
          </div>
        </WonderSection>
      ) : null}

      {/* About Section */}
      <WonderSection>
        <p className="text-lg leading-relaxed text-muted-foreground text-center max-w-2xl mx-auto">
          بيكابو هو ملعب داخلي مخصص للأطفال في إربد، حيث نوفر بيئة آمنة وممتعة للعب والاستكشاف.
          نؤمن بأن اللعب هو أساس نمو الطفل وتطوره، ونسعى لتقديم تجربة فريدة لكل عائلة تزورنا.
        </p>
      </WonderSection>

      {/* Values Grid */}
      <WonderSection>
        <WonderSectionTitle icon={Heart} iconColor="red">قيمنا</WonderSectionTitle>
        <div className="wonder-card-grid">
          {values.map((item, index) => (
            <WonderCard key={index} color={item.color}>
              <item.icon className={`h-8 w-8 text-[var(--pk-${item.color})] mb-3`} />
              <h3 className="font-heading font-bold text-foreground mb-1">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </WonderCard>
          ))}
        </div>
      </WonderSection>

      {/* Location */}
      <WonderSection className="text-center">
        <WonderSectionTitle icon={MapPin} iconColor="blue">موقعنا</WonderSectionTitle>
        <div className="space-y-3">
          <p className="text-muted-foreground flex items-center justify-center gap-2">
            <MapPin className="h-5 w-5 text-[var(--pk-blue)]" />
            ابو راشد مجمع السيف التجاري، إربد
          </p>
          <a href="https://share.google/30qIenCYvngQpVUqJ" target="_blank" rel="noreferrer" className="inline-block">
            <Button variant="outline" size="sm" className="rounded-full border-2 border-[var(--pk-blue)] text-[var(--pk-blue)] hover:bg-[var(--pk-bg-light-blue)]">
              <Map className="h-4 w-4 ml-2" />
              الموقع على الخريطة
            </Button>
          </a>
          <p className="text-muted-foreground flex items-center justify-center gap-2">
            <Clock className="h-5 w-5 text-[var(--pk-green)]" />
            مفتوح يومياً من 10 صباحاً حتى 12 منتصف الليل
          </p>
          <p className="font-bold flex items-center justify-center gap-2">
            <Phone className="h-5 w-5 text-[var(--pk-yellow)]" />
            <span dir="ltr">0777775652</span>
          </p>
        </div>
      </WonderSection>
    </PublicPageShell>
  );
}
