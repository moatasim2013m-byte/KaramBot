import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageCircle, Phone, MapPin, Clock } from 'lucide-react';
import logoImg from '../assets/logo.png';
import mascotImg from '../assets/mascot.png';
import { PaymentCardIcons } from './PaymentCardIcons';
import { FacebookLogoIcon, InstagramLogoIcon } from './SocialBrandIcons';
import { useAuth } from '../context/AuthContext';

export const Footer = () => {
  const { api } = useAuth();
  const [footerSettings, setFooterSettings] = useState({
    description: 'أفضل ملعب داخلي للأطفال في إربد. احجز جلسات اللعب وحفلات أعياد الميلاد!',
    logoHeight: 112
  });

  useEffect(() => {
    const fetchFooterSettings = async () => {
      try {
        const res = await api.get('/settings');
        const s = res.data.settings || {};
        const logoHeight = Number(s.footer_logo_height);

        setFooterSettings((prev) => ({
          description: s.footer_description || prev.description,
          logoHeight: Number.isFinite(logoHeight) && logoHeight >= 80 && logoHeight <= 220 ? logoHeight : prev.logoHeight
        }));
      } catch (error) {
        console.error('Failed to load footer settings:', error);
      }
    };

    fetchFooterSettings();
  }, [api]);

  return (
    <footer className="footer-section mt-auto" dir="rtl">
      {/* Wave Divider */}
      <div className="footer-wave"></div>
      
      {/* Footer Card Container */}
      <div className="footer-card">
        <div className="footer-gradient-border"></div>
        
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-14 relative">
          {/* Decorative Mascot */}
          <img 
            src={mascotImg} 
            alt="بيكابو" 
            className="footer-mascot"
          />
          
          <div className="footer-main-grid grid grid-cols-1 md:grid-cols-4 gap-8 lg:gap-10">
            
            {/* Column 1: Brand & Contact */}
            <div>
              <Link to="/" className="inline-block mb-4">
                <img
                  src={logoImg}
                  alt="بيكابو"
                  className="w-auto drop-shadow-md"
                  style={{ height: `${footerSettings.logoHeight}px` }}
                />
              </Link>
              <p className="footer-description-bubbly mb-4">
                {footerSettings.description}
              </p>
              
              {/* Social Links */}
              <div className="flex flex-wrap gap-3">
                <a href="https://www.instagram.com/peekaboo_playtime?igsh=cDc1eDQxZmVsZHM%3D&utm_source=qr" target="_blank" rel="noopener noreferrer" className="footer-social-link footer-social-instagram" aria-label="Instagram">
                  <InstagramLogoIcon className="h-5 w-5" />
                  <span className="footer-social-label">Instagram</span>
                </a>
                <a href="https://www.facebook.com/profile.php?id=61573636087726" target="_blank" rel="noopener noreferrer" className="footer-social-link footer-social-facebook" aria-label="Facebook">
                  <FacebookLogoIcon className="h-5 w-5" />
                  <span className="footer-social-label">Facebook</span>
                </a>
              </div>
            </div>

            {/* Column 2: Quick Links */}
            <div>
              <h4 className="footer-heading footer-heading-blue">روابط سريعة</h4>
              <ul className="space-y-2">
                <li><Link to="/#home" className="footer-link-new">الرئيسية</Link></li>
                <li><Link to="/#hourly" className="footer-link-new">تذاكر بالساعة</Link></li>
                <li><Link to="/#birthdays" className="footer-link-new">حفلات أعياد الميلاد</Link></li>
                <li><Link to="/#subscriptions" className="footer-link-new">الاشتراكات</Link></li>
                <li><Link to="/#schools" className="footer-link-new">المدارس والمجموعات</Link></li>
              </ul>
            </div>

            {/* Column 3: Policies */}
            <div>
              <h4 className="footer-heading footer-heading-red">السياسات</h4>
              <ul className="space-y-2">
                <li><Link to="/terms" className="footer-link-new">الشروط والأحكام</Link></li>
                <li><Link to="/privacy" className="footer-link-new">سياسة الخصوصية</Link></li>
                <li><Link to="/refund" className="footer-link-new">سياسة الاسترجاع</Link></li>
              </ul>
              
              <Link to="/staff/login" className="text-xs text-[var(--text-muted)] hover:text-[var(--pk-blue)] mt-4 inline-block">
                تسجيل دخول الإدارة
              </Link>
            </div>

            {/* Column 4: Contact & Hours */}
            <div>
              <h4 className="footer-heading footer-heading-green">تواصل معنا</h4>
              
              {/* Address */}
              <div className="mb-4">
                <div className="flex items-start gap-2 text-sm text-[var(--text-secondary)]">
                  <MapPin className="h-4 w-4 mt-0.5 text-[var(--pk-blue)]" />
                  <a href="https://share.google/30qIenCYvngQpVUqJ" target="_blank" rel="noreferrer" className="hover:text-[var(--pk-blue)] hover:underline">
                    ابو راشد مجمع السيف التجاري, إربد
                  </a>
                </div>
              </div>
              
              {/* Phone & WhatsApp */}
              <div className="flex flex-col gap-2 mb-4">
                <a href="tel:0777775652" className="footer-btn-new footer-btn-phone-new text-sm">
                  <Phone className="h-4 w-4" />
                  <span className="ltr-text" dir="ltr">0777775652</span>
                </a>
                <a
                  href="https://wa.me/962777775652?text=%D9%85%D8%B1%D8%AD%D8%A8%D8%A7%D8%8C%20%D8%A8%D8%AF%D9%8A%20%D8%A3%D8%B3%D8%AA%D9%81%D8%B3%D8%B1%20%D8%B9%D9%86%20%D8%A7%D9%84%D8%AD%D8%AC%D8%B2%20%D9%81%D9%8A%20%D8%A8%D9%8A%D9%83%D8%A7%D8%A8%D9%88"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="footer-btn-new footer-btn-whatsapp-new text-sm"
                  aria-label="تواصل معنا عبر واتساب"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>تواصل معنا عبر واتساب</span>
                </a>
              </div>
              
              {/* Hours */}
              <div className="flex items-center gap-2 text-sm">
                <Clock className="h-4 w-4 text-[var(--pk-green)]" />
                <span className="text-[var(--text-secondary)]">يومياً: <span className="ltr-text font-medium" dir="ltr">10AM - 12AM</span></span>
              </div>
            </div>
          </div>

          {/* Footer Bottom */}
          <div className="footer-bottom-row border-t border-[var(--border-light)] mt-8 pt-6 flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-sm text-[var(--text-secondary)]">&copy; {new Date().getFullYear()} بيكابو. جميع الحقوق محفوظة.</p>
            
            {/* Trust Badge - Payment Methods */}
            <div className="footer-payment-badge inline-flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <PaymentCardIcons className="[&_svg]:h-5 [&_svg]:w-auto" />
              <span className="font-medium">نقبل فيزا وماستركارد</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};
