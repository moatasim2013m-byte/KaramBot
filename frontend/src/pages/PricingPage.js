import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Clock, Cake, Star, Sun, Moon, ChevronLeft } from 'lucide-react';
import { Button } from '../components/ui/button';
import PublicPageShell, { WonderSection, WonderSectionTitle, WonderCard } from '../components/PublicPageShell';
import { trackSnapViewContent } from '../utils/snapPixel';

export default function PricingPage() {
  useEffect(() => {
    trackSnapViewContent({
      price: 3.5,
      currency: 'JOD',
      itemIds: ['hourly_morning', 'hourly_evening'],
      itemCategory: 'pricing',
    });
  }, []);

  return (
    <PublicPageShell
      title="الأسعار"
      subtitle="أسعار شفافة ومناسبة للجميع"
      maxWidth="max-w-5xl"
    >
      {/* Hourly Play */}
      <WonderSection>
        <WonderSectionTitle icon={Clock} iconColor="blue">اللعب بالساعة</WonderSectionTitle>

        <div className="wonder-card-grid mb-6">
          {/* Morning */}
          <WonderCard color="yellow" className="wonder-card-featured">
            <div className="flex items-center gap-2 mb-3">
              <Sun className="h-6 w-6 text-[var(--pk-yellow)]" />
              <span className="font-heading font-bold text-lg">صباحي (Happy Hour)</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">10 صباحاً - 2 ظهراً</p>
            <p className="wonder-price text-[var(--pk-yellow)]">
              3.5 <span className="wonder-price-unit">دينار/ساعة</span>
            </p>
          </WonderCard>

          {/* Afternoon */}
          <WonderCard color="blue">
            <div className="flex items-center gap-2 mb-3">
              <Moon className="h-6 w-6 text-[var(--pk-blue)]" />
              <span className="font-heading font-bold text-lg">مسائي</span>
            </div>
            <p className="text-sm text-muted-foreground mb-3">2 ظهراً - 12 منتصف الليل</p>
            <p className="wonder-price text-[var(--pk-blue)]">
              7-13 <span className="wonder-price-unit">دينار</span>
            </p>
          </WonderCard>
        </div>

        <Link to="/tickets">
          <Button className="rounded-full btn-playful">
            احجز الآن
            <ChevronLeft className="mr-2 h-4 w-4" />
          </Button>
        </Link>
      </WonderSection>

      {/* Birthday */}
      <WonderSection>
        <WonderSectionTitle icon={Cake} iconColor="red">حفلات أعياد الميلاد</WonderSectionTitle>

        <div className="wonder-card-grid grid-3 mb-6">
          <WonderCard color="pink">
            <p className="font-heading font-bold text-lg mb-2 text-center">باقة برونزية</p>
            <p className="wonder-price text-[var(--pk-red)] text-center">80 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
          <WonderCard color="yellow" className="wonder-card-featured">
            <p className="font-heading font-bold text-lg mb-2 text-center">باقة فضية</p>
            <p className="wonder-price text-[var(--pk-yellow)] text-center">120 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
          <WonderCard color="blue">
            <p className="font-heading font-bold text-lg mb-2 text-center">باقة ذهبية</p>
            <p className="wonder-price text-[var(--pk-blue)] text-center">160 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
        </div>

        <Link to="/birthday">
          <Button className="rounded-full btn-playful bg-[var(--pk-red)] hover:bg-[var(--pk-red)]/90">
            احجز حفلة
            <ChevronLeft className="mr-2 h-4 w-4" />
          </Button>
        </Link>
      </WonderSection>

      {/* Subscriptions */}
      <WonderSection>
        <WonderSectionTitle icon={Star} iconColor="green">الاشتراكات</WonderSectionTitle>
        <p className="text-muted-foreground mb-4">باقات زيارات بأسعار مخفضة - صالحة لمدة 30 يوم</p>

        <div className="wonder-card-grid grid-3 mb-4">
          <WonderCard color="green">
            <p className="font-heading font-bold text-lg mb-2 text-center">5 زيارات</p>
            <p className="wonder-price text-[var(--pk-green)] text-center">30 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
          <WonderCard color="yellow" className="wonder-card-featured">
            <p className="font-heading font-bold text-lg mb-2 text-center">10 زيارات</p>
            <p className="wonder-price text-[var(--pk-yellow)] text-center">55 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
          <WonderCard color="blue">
            <p className="font-heading font-bold text-lg mb-2 text-center">20 زيارة</p>
            <p className="wonder-price text-[var(--pk-blue)] text-center">100 <span className="wonder-price-unit">د</span></p>
          </WonderCard>
        </div>

        <p className="text-xs text-muted-foreground mb-4">* صالحة من الأحد إلى الخميس فقط</p>

        <Link to="/subscriptions">
          <Button className="rounded-full btn-playful bg-[var(--pk-green)] hover:bg-[var(--pk-green)]/90">
            اشترك الآن
            <ChevronLeft className="mr-2 h-4 w-4" />
          </Button>
        </Link>
      </WonderSection>
    </PublicPageShell>
  );
}
