import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { toast } from 'sonner';
import { Mail, Lock, User, Loader2, Phone, CheckCircle } from 'lucide-react';
import mascotImg from '../assets/mascot.png';

const SNAP_UUID_STORAGE_KEY = 'snap_uuid_c1';

const getOrCreateSnapUuid = () => {
  const existingUuid = window.localStorage.getItem(SNAP_UUID_STORAGE_KEY);
  if (existingUuid) {
    return existingUuid;
  }

  const generatedUuid = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(SNAP_UUID_STORAGE_KEY, generatedUuid);
  return generatedUuid;
};

const sha256Hex = async (value) => {
  const normalized = value.trim().toLowerCase();
  if (!window.crypto?.subtle) {
    return '';
  }
  const payload = new TextEncoder().encode(normalized);
  const digest = await window.crypto.subtle.digest('SHA-256', payload);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
};

const trackSnapSignup = async ({ email, phone }) => {
  if (typeof window.snaptr !== 'function') {
    return;
  }

  const normalizedEmail = email.trim().toLowerCase();
  const normalizedPhone = phone.replace(/\s/g, '');
  const userHashedEmail = normalizedEmail ? await sha256Hex(normalizedEmail) : '';
  const userHashedPhoneNumber = normalizedPhone ? await sha256Hex(normalizedPhone) : '';

  window.snaptr('track', 'SIGN_UP', {
    sign_up_method: 'email',
    uuid_c1: getOrCreateSnapUuid(),
    user_email: normalizedEmail,
    user_phone_number: normalizedPhone,
    user_hashed_email: userHashedEmail,
    user_hashed_phone_number: userHashedPhoneNumber
  });
};

export default function RegisterPage() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);
  const { api } = useAuth();

  const validatePhone = (phoneNum) => {
    const cleaned = phoneNum.replace(/\s/g, '');
    return /^07\d{8}$/.test(cleaned);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (password !== confirmPassword) {
      toast.error('كلمتا المرور غير متطابقتين');
      return;
    }

    if (password.length < 6) {
      toast.error('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
      return;
    }

    if (phone && !validatePhone(phone)) {
      toast.error('رقم الهاتف غير صالح (07XXXXXXXX)');
      return;
    }

    setLoading(true);

    try {
      await api.post('/auth/register', {
        name,
        email,
        password,
        phone: phone.replace(/\s/g, ''),
        origin_url: window.location.origin
      });
      try {
        await trackSnapSignup({ email, phone });
      } catch (trackingError) {
        console.warn('Snap SIGN_UP tracking failed', trackingError);
      }
      setRegistrationSuccess(true);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إنشاء الحساب');
    } finally {
      setLoading(false);
    }
  };

  // Show success message after registration
  if (registrationSuccess) {
    return (
      <div className="min-h-[80vh] flex items-center justify-center py-12 px-4" dir="rtl">
        <Card className="auth-card-premium w-full max-w-md">
          <CardContent className="pt-8 pb-8 text-center">
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="h-12 w-12 text-green-600" />
              </div>
            </div>
            <h2 className="font-heading text-2xl text-[var(--text-primary)] mb-4">تم إنشاء الحساب بنجاح!</h2>
            <p className="text-muted-foreground mb-6 leading-relaxed">
              تم إرسال رابط تأكيد إلى بريدك الإلكتروني.<br />
              الرجاء التحقق من البريد الوارد أو الرسائل غير المرغوب فيها.
            </p>
            <Link to="/login">
              <Button className="rounded-full btn-playful">
                الذهاب لتسجيل الدخول
              </Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[80vh] flex items-center justify-center py-12 px-4" dir="rtl">
      <Card className="auth-card-premium w-full max-w-md">
        <CardHeader className="text-center pb-2">
          {/* Mascot with yellow badge */}
          <div className="flex justify-center mb-4">
            <div className="auth-mascot-badge">
              <img src={mascotImg} alt="بيكابو" className="auth-mascot-img" />
            </div>
          </div>
          <CardTitle className="font-heading text-3xl text-[var(--text-primary)]" data-testid="register-title">انضم إلى بيكابو!</CardTitle>
          <p className="auth-slogan">بيكابو يصنع السعادة ✨</p>
          <CardDescription className="text-base mt-2">
            أنشئ حسابك لبدء الحجز
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="name">الاسم الكامل</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="name"
                  type="text"
                  placeholder="أدخل اسمك الكامل"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="register-name"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="example@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="register-email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone">رقم الهاتف</Label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="phone"
                  type="tel"
                  placeholder="07XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="pl-10 rounded-xl h-12"
                  dir="ltr"
                  data-testid="register-phone"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="6 أحرف على الأقل"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="register-password"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">تأكيد كلمة المرور</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  placeholder="أعد إدخال كلمة المرور"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="register-confirm-password"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full rounded-full h-12 text-lg btn-playful"
              disabled={loading}
              data-testid="register-submit"
            >
              {loading ? (
                <>
                  <Loader2 className="ml-2 h-5 w-5 animate-spin" />
                  جاري إنشاء الحساب...
                </>
              ) : (
                'إنشاء حساب'
              )}
            </Button>
          </form>

          <div className="mt-6 text-center">
            <p className="text-muted-foreground">
              لديك حساب بالفعل؟{' '}
              <Link to="/login" className="text-primary font-semibold hover:underline" data-testid="login-link">
                تسجيل الدخول
              </Link>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
