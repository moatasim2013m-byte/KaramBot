import { Users, Phone, MessageCircle, Calendar, Shield, Smile } from 'lucide-react';
import { Button } from '../components/ui/button';
import PublicPageShell, { WonderSection, WonderSectionTitle, WonderCard } from '../components/PublicPageShell';
import Shroomi from '../components/Shroomi';

export default function GroupsPage() {
  const features = [
    { icon: Shield, title: 'بيئة آمنة', desc: 'إشراف كامل وتعليمات سلامة', color: 'blue' },
    { icon: Smile, title: 'متعة للجميع', desc: 'أنشطة متنوعة تناسب كل الأعمار', color: 'yellow' },
    { icon: Calendar, title: 'حجز مرن', desc: 'مواعيد تناسب جدول المدرسة', color: 'green' },
  ];

  return (
    <PublicPageShell
      title="المدارس والمجموعات"
      subtitle="رحلات مدرسية وبرامج لعب آمنة للمجموعات"
      icon={Users}
      iconBg="bg-[var(--pk-green)]"
      maxWidth="max-w-3xl"
    >
      <WonderSection className="text-center relative overflow-visible">
        {/* Shroomi as a friendly schools/groups guide — clipboard pose
            anchors the "we're prepping the program" message. Decorative
            only; never blocks CTAs or contact info. */}
        <div className="hidden sm:block absolute -top-12 -left-2 shroomi-halo shroomi-halo--green" aria-hidden="true">
          <Shroomi pose="clipboard-write" size={96} className="shroomi-bob" />
        </div>

        <span className="pk-section-eyebrow pk-section-eyebrow--green mb-3">قريباً</span>
        <div className="inline-flex mt-3 mb-4 px-4 py-2 rounded-full bg-[var(--pk-bg-light-green)] text-[var(--pk-green)] font-bold text-base items-center gap-2">
          <Shroomi pose="thumbs-up" size={28} aria-hidden="true" />
          نعمل على تجهيز البرنامج
        </div>
        <p className="text-muted-foreground mb-6 max-w-md mx-auto">
          مجموعاتك الصغيرة تستحق تجربة آمنة وممتعة. اتركوا لنا التفاصيل وسنرتب الزيارة المثالية.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-md mx-auto">
          <a href="https://wa.me/962777775652" target="_blank" rel="noreferrer">
            <Button className="rounded-full w-full h-12 text-base bg-[#25D366] hover:bg-[#20BD5A]" data-testid="groups-whatsapp-btn">
              <MessageCircle className="h-5 w-5 ml-2" />
              واتساب
            </Button>
          </a>
          <a href="tel:0777775652">
            <Button variant="outline" className="rounded-full w-full h-12 text-base border-2" data-testid="groups-phone-btn">
              <Phone className="h-5 w-5 ml-2" />
              <span dir="ltr">0777775652</span>
            </Button>
          </a>
        </div>
      </WonderSection>

      <WonderSection className="relative">
        {/* Trust-themed Shroomi reinforces the safety/care pillars. */}
        <div className="hidden md:block absolute -top-6 left-2 shroomi-halo shroomi-halo--blue" aria-hidden="true">
          <Shroomi pose="heart-hold" size={68} className="shroomi-float" />
        </div>
        <WonderSectionTitle icon={Users} iconColor="green">مميزات الخدمة</WonderSectionTitle>
        <div className="wonder-card-grid grid-3">
          {features.map((item, index) => (
            <WonderCard key={index} color={item.color}>
              <item.icon className={`h-8 w-8 text-[var(--pk-${item.color})] mb-2`} />
              <h3 className="font-heading font-bold text-foreground mb-1">{item.title}</h3>
              <p className="text-sm text-muted-foreground">{item.desc}</p>
            </WonderCard>
          ))}
        </div>
      </WonderSection>
    </PublicPageShell>
  );
}
