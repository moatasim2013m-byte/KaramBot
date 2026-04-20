import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { toast } from 'sonner';
import { Mail, Lock, Loader2, ShieldCheck, AlertTriangle } from 'lucide-react';
import mascotImg from '../assets/mascot.png';

export default function StaffLoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [loginError, setLoginError] = useState('');
  const { login } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoginError('');
    setLoading(true);

    try {
      const user = await login(email, password);
      
      // Only allow staff/admin
      if (user.role === 'parent') {
        toast.error('هذا البوابة للموظفين فقط / Staff portal only');
        navigate('/login');
        return;
      }
      
      toast.success('مرحباً! / Welcome!');
      
      if (user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/reception');
      }
    } catch (error) {
      const backendMessage = error?.response?.data?.error;
      const fallbackMessage = 'فشل تسجيل دخول الموظف. تأكد من البريد الإلكتروني وكلمة المرور.';
      setLoginError(backendMessage || fallbackMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-[80vh] flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 py-12 px-4">
      <Card className="w-full max-w-md border-2 border-[var(--peekaboo-green)] rounded-3xl shadow-xl bg-white">
        <CardHeader className="text-center pb-2">
          <div className="flex justify-center mb-4">
            <img src={mascotImg} alt="Peekaboo" className="h-20 w-20 rounded-full border-4 border-[var(--peekaboo-green)] shadow-lg" />
          </div>
          <Badge className="mx-auto mb-3 bg-[var(--peekaboo-green)] text-white px-4 py-1">
            <ShieldCheck className="h-4 w-4 mr-2" />
            بوابة الموظفين / Staff Portal
          </Badge>
          <CardTitle className="font-heading text-2xl" data-testid="staff-login-title">
            تسجيل دخول الموظفين
          </CardTitle>
          <CardDescription className="text-base">
            Staff & Admin Login
          </CardDescription>
        </CardHeader>
        <CardContent>
          {/* Warning Banner */}
          <div className="mb-6 p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2">
            <AlertTriangle className="h-5 w-5 text-amber-600 shrink-0 mt-0.5" />
            <p className="text-sm text-amber-800">
              هذا البوابة مخصص لموظفي Peekaboo فقط. العملاء يرجى استخدام{' '}
              <a href="/login" className="underline font-semibold">صفحة تسجيل الدخول العادية</a>
            </p>
          </div>

          {loginError && (
            <div className="mb-4 p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-sm text-right" role="alert" aria-live="polite">
              {loginError}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="email">البريد الإلكتروني / Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  placeholder="staff@peekaboo.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="staff-login-email"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">كلمة المرور / Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    if (loginError) setLoginError('');
                  }}
                  className="pl-10 rounded-xl h-12"
                  required
                  data-testid="staff-login-password"
                />
              </div>
            </div>

            <Button 
              type="submit" 
              className="w-full rounded-full h-12 text-lg bg-[var(--peekaboo-green)] hover:bg-[var(--peekaboo-green)]/90"
              disabled={loading}
              data-testid="staff-login-submit"
            >
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                  جاري الدخول...
                </>
              ) : (
                'دخول / Login'
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
