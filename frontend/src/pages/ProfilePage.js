import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  User, Baby, Clock, Cake, Star, Gift, Plus, Edit, Trash2, 
  AlertTriangle, Calendar, Loader2, Phone, Settings, QrCode,
  Sparkles, Mail, TrendingUp
} from 'lucide-react';

export default function ProfilePage() {
  const { user, api, logout, isAdmin } = useAuth();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [children, setChildren] = useState([]);
  const [hourlyBookings, setHourlyBookings] = useState([]);
  const [birthdayBookings, setBirthdayBookings] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [loyaltyBalance, setLoyaltyBalance] = useState(0);
  const [loyaltyJdValue, setLoyaltyJdValue] = useState(0);
  const [loyaltyHistory, setLoyaltyHistory] = useState([]);
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState('');
  const [activeSession, setActiveSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [addChildOpen, setAddChildOpen] = useState(false);
  const [newChildName, setNewChildName] = useState('');
  const [newChildBirthday, setNewChildBirthday] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [savingPhone, setSavingPhone] = useState(false);

  const formatDateSafe = useCallback((value, formatPattern, fallback = '--/--/----') => {
    if (!value) return fallback;

    const dateValue = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(dateValue.getTime())) return fallback;

    return format(dateValue, formatPattern);
  }, []);

  // Defense in depth: Redirect admin users
  useEffect(() => {
    if (isAdmin) {
      navigate('/admin', { replace: true });
    }
  }, [isAdmin, navigate]);

  // Initialize phone from user
  useEffect(() => {
    if (user?.phone) {
      setEditPhone(user.phone);
    }
  }, [user]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setLoyaltyLoading(true);
    setLoyaltyError('');
    const [
      profileRes,
      hourlyRes,
      birthdayRes,
      subsRes,
      activeRes
    ] = await Promise.allSettled([
      api.get('/profile'),
      api.get('/bookings/hourly'),
      api.get('/bookings/birthday'),
      api.get('/subscriptions/my'),
      api.get('/bookings/hourly/active')
    ]);

    if (profileRes.status === 'fulfilled') setChildren(profileRes.value.data.children || []);
    if (hourlyRes.status === 'fulfilled') setHourlyBookings(hourlyRes.value.data.bookings || []);
    if (birthdayRes.status === 'fulfilled') setBirthdayBookings(birthdayRes.value.data.bookings || []);
    if (subsRes.status === 'fulfilled') setSubscriptions(subsRes.value.data.subscriptions || []);
    if (activeRes.status === 'fulfilled') setActiveSession(activeRes.value.data.active_session);

    if ([profileRes, hourlyRes, birthdayRes, subsRes, activeRes].some((res) => res.status === 'rejected')) {
      console.error('Failed to fetch some profile data');
    }
    setLoading(false);

    try {
      const [loyaltyBalanceRes, loyaltyHistoryRes] = await Promise.all([
        api.get('/loyalty/balance'),
        api.get('/loyalty/history')
      ]);
      const pointsAvailable = Number(loyaltyBalanceRes.data.pointsAvailable ?? loyaltyBalanceRes.data.points ?? 0);
      const jdValue = pointsAvailable / 100;
      const history = loyaltyHistoryRes.data.history || loyaltyHistoryRes.data.entries || [];

      setLoyaltyBalance(Number.isFinite(pointsAvailable) ? pointsAvailable : 0);
      setLoyaltyJdValue(Number.isFinite(jdValue) ? jdValue : 0);
      setLoyaltyHistory(Array.isArray(history) ? history.slice(0, 50) : []);
    } catch (error) {
      setLoyaltyError('تعذر تحميل نقاط الولاء حالياً. حاول مرة أخرى لاحقاً.');
      setLoyaltyBalance(0);
      setLoyaltyJdValue(0);
      setLoyaltyHistory([]);
    } finally {
      setLoyaltyLoading(false);
    }
  }, [api]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Poll for active session updates
  useEffect(() => {
    if (!activeSession) return;

    const interval = setInterval(async () => {
      try {
        const response = await api.get('/bookings/hourly/active');
        setActiveSession(response.data.active_session);
      } catch (error) {
        console.error('Failed to poll active session:', error);
      }
    }, 30000); // Poll every 30 seconds

    return () => clearInterval(interval);
  }, [activeSession, api]);

  const handleAddChild = async (e) => {
    e.preventDefault();
    if (!newChildName.trim()) {
      toast.error('الرجاء إدخال اسم الطفل');
      return;
    }

    try {
      await api.post('/profile/children', {
        name: newChildName.trim(),
        birthday: newChildBirthday || null
      });
      toast.success('تمت إضافة الطفل بنجاح');
      setNewChildName('');
      setNewChildBirthday('');
      setAddChildOpen(false);
      fetchData();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إضافة الطفل');
    }
  };

  const handleDeleteChild = async (childId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا الطفل؟')) return;

    try {
      await api.delete(`/profile/children/${childId}`);
      toast.success('تم حذف الطفل');
      fetchData();
    } catch (error) {
      toast.error('فشل حذف الطفل');
    }
  };

  const handleSavePhone = async () => {
    const cleaned = editPhone.replace(/\s/g, '');
    if (cleaned && !/^07\d{8}$/.test(cleaned)) {
      toast.error('رقم الهاتف غير صالح (07XXXXXXXX)');
      return;
    }
    
    setSavingPhone(true);
    try {
      await api.put('/profile', { phone: cleaned });
      toast.success('تم حفظ رقم الهاتف');
      // Refresh user data
      window.location.reload();
    } catch (error) {
      toast.error('فشل حفظ رقم الهاتف');
    } finally {
      setSavingPhone(false);
    }
  };

  const getStatusBadge = (status) => {
    const colors = {
      confirmed: 'bg-green-100 text-green-700',
      pending: 'bg-yellow-100 text-yellow-700',
      checked_in: 'bg-blue-100 text-blue-700',
      completed: 'bg-gray-100 text-gray-700',
      cancelled: 'bg-red-100 text-red-700',
      custom_pending: 'bg-purple-100 text-purple-700',
      active: 'bg-green-100 text-green-700',
      expired: 'bg-red-100 text-red-700',
      consumed: 'bg-gray-100 text-gray-700'
    };
    return colors[status] || 'bg-yellow-100 text-yellow-700';
  };

  // Phase 2 — Arabic label for QR lifecycle status shown alongside booking cards.
  const getQrStatusLabel = (booking) => {
    if (!booking) return null;
    if (booking.status === 'cancelled') return { text: 'ملغي', cls: 'bg-red-100 text-red-700 border-red-200' };
    if (booking.qr_status === 'checked_in' || booking.status === 'checked_in' || booking.status === 'completed') {
      return { text: 'تم استخدامه', cls: 'bg-gray-200 text-gray-700 border-gray-300' };
    }
    if (booking.qr_status === 'expired') return { text: 'منتهي', cls: 'bg-red-100 text-red-700 border-red-200' };
    if (booking.status === 'confirmed' && (!booking.qr_status || booking.qr_status === 'unused') && booking.qr_code) {
      return { text: 'صالح للاستخدام', cls: 'bg-green-100 text-green-700 border-green-200' };
    }
    return null;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F4F8FE] via-[#F9FBFF] to-[#FFF8F0] py-8 md:py-12" dir="rtl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Premium Dashboard Hero */}
        <section className="relative overflow-hidden rounded-3xl bg-white border border-[#E6EAF2] shadow-[0_10px_30px_rgba(45,45,45,0.06)] mb-6 md:mb-8">
          {/* Subtle decorative blobs (behind content, pointer-events-none) */}
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
            <div className="absolute -top-10 -right-10 w-40 h-40 rounded-full bg-[#FFD166]/20 blur-3xl" />
            <div className="absolute -bottom-14 -left-10 w-48 h-48 rounded-full bg-[#4A90D9]/10 blur-3xl" />
          </div>
          <div className="relative p-6 md:p-8">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Identity block */}
              <div className="flex items-start gap-4 md:gap-5 flex-1 min-w-0">
                <div className="shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-2xl bg-gradient-to-br from-[#FFD166] to-[#E63946] flex items-center justify-center shadow-md">
                  <User className="h-7 w-7 md:h-8 md:w-8 text-white" strokeWidth={2.5} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-[#2D2D2D]/60 mb-1">أهلاً بعودتك</p>
                  <h1 className="font-heading heading-bubble text-2xl sm:text-3xl md:text-4xl font-extrabold text-[#2D2D2D] leading-tight truncate" data-testid="profile-title">
                    مرحباً، <span className="heading-bubble__accent">{user?.name || ''}</span>
                  </h1>
                  <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-[#2D2D2D]/65">
                    {user?.email && (
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="h-4 w-4" />
                        <span className="truncate">{user.email}</span>
                      </span>
                    )}
                    {user?.phone && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone className="h-4 w-4" />
                        <span className="ltr-text font-mono text-[13px]">{user.phone}</span>
                      </span>
                    )}
                  </div>
                </div>
              </div>
              {/* Loyalty featured chip */}
              <div className="shrink-0 flex items-center gap-3 rounded-2xl bg-gradient-to-br from-[#FFF3D6] to-[#FFE2A8] border border-[#F2E533]/60 px-4 py-3 shadow-sm">
                <div className="w-10 h-10 rounded-xl bg-white/80 flex items-center justify-center">
                  <Sparkles className="h-5 w-5 text-[#E8872E]" />
                </div>
                <div className="leading-tight">
                  <p className="text-[11px] font-medium text-[#2D2D2D]/60">نقاطك</p>
                  <p className="font-heading font-extrabold text-[#2D2D2D]">
                    <span className="text-xl">{loyaltyBalance}</span>
                    <span className="text-xs font-bold text-[#2D2D2D]/60 mr-1">نقطة</span>
                  </p>
                </div>
              </div>
            </div>

            {/* Quick stat chips */}
            <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-2.5 md:gap-3">
              <div className="rounded-2xl bg-[#F1FAEA] border border-[#7AC74F]/25 p-3 flex items-center gap-3" data-testid="stat-children">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                  <Baby className="h-4.5 w-4.5 text-[#3F7A1E]" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-[11px] text-[#2D2D2D]/60">أطفالي</p>
                  <p className="font-heading font-extrabold text-lg text-[#2D2D2D]">{children.length}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[#E9F3FF] border border-[#4A90D9]/25 p-3 flex items-center gap-3" data-testid="stat-hourly">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                  <Clock className="h-4.5 w-4.5 text-[#2A6FC7]" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-[11px] text-[#2D2D2D]/60">جلساتي</p>
                  <p className="font-heading font-extrabold text-lg text-[#2D2D2D]">{hourlyBookings.length}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[#FFF1E1] border border-[#E8872E]/25 p-3 flex items-center gap-3" data-testid="stat-birthday">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                  <Cake className="h-4.5 w-4.5 text-[#C66A1B]" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-[11px] text-[#2D2D2D]/60">حفلاتي</p>
                  <p className="font-heading font-extrabold text-lg text-[#2D2D2D]">{birthdayBookings.length}</p>
                </div>
              </div>
              <div className="rounded-2xl bg-[#FDECEF] border border-[#E63946]/25 p-3 flex items-center gap-3" data-testid="stat-subs">
                <div className="shrink-0 w-9 h-9 rounded-xl bg-white flex items-center justify-center shadow-sm">
                  <TrendingUp className="h-4.5 w-4.5 text-[#C62433]" />
                </div>
                <div className="leading-tight min-w-0">
                  <p className="text-[11px] text-[#2D2D2D]/60">اشتراكاتي</p>
                  <p className="font-heading font-extrabold text-lg text-[#2D2D2D]">{subscriptions.length}</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Active Session Alert */}
        {activeSession && (
          <Card className={`relative overflow-hidden rounded-3xl mb-8 border-2 ${activeSession.warning_5min ? 'border-[#E63946]/60 bg-gradient-to-br from-[#FDECEF] to-[#FFF1E1]' : 'border-[#7AC74F]/50 bg-gradient-to-br from-[#F1FAEA] to-[#F6FBEF]'} shadow-[0_8px_22px_rgba(45,45,45,0.08)]`}>
            <div aria-hidden="true" className="pointer-events-none absolute -top-8 -left-8 w-40 h-40 rounded-full bg-white/40 blur-3xl" />
            <CardContent className="py-5 md:py-6 relative">
              <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className={`p-3.5 rounded-2xl shadow-sm ${activeSession.warning_5min ? 'bg-[#E63946] timer-warning' : 'bg-[#3F7A1E]'}`}>
                    <Clock className="h-6 w-6 text-white" />
                  </div>
                  <div>
                    <h3 className="font-heading heading-bubble font-extrabold text-lg md:text-xl text-[#2D2D2D]">جلسة لعب نشطة الآن 🎈</h3>
                    <p className="text-sm text-[#2D2D2D]/65">
                      {activeSession.child_id?.name || 'الطفل'} يلعب الآن — استمتعوا!
                    </p>
                  </div>
                </div>
                <div className="text-center">
                  <div className={`text-4xl md:text-5xl font-heading font-extrabold leading-none ${activeSession.warning_5min ? 'text-[#C62433]' : 'text-[#3F7A1E]'}`}>
                    {activeSession.remaining_minutes}
                  </div>
                  <p className="text-xs md:text-sm text-[#2D2D2D]/65 mt-1 font-bold">دقيقة متبقية</p>
                  {activeSession.warning_5min && (
                    <div className="flex items-center justify-center gap-1 text-[#C62433] mt-1.5 bg-white/60 rounded-full px-2.5 py-1">
                      <AlertTriangle className="h-4 w-4" />
                      <span className="text-xs font-bold">الجلسة تنتهي قريباً!</span>
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="children" className="space-y-6">
          <div className="overflow-x-auto peekaboo-hide-scrollbar -mx-1 px-1">
            <TabsList className="bg-white border border-[#E6EAF2] rounded-2xl p-1.5 inline-flex flex-nowrap whitespace-nowrap gap-1 shadow-sm data-[state=active]:shadow-md">
              <TabsTrigger value="children" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#FFD166]/25 data-[state=active]:text-[#8A5A00] data-[state=active]:shadow-[0_2px_6px_rgba(232,135,46,0.15)] data-[state=active]:font-bold transition" data-testid="tab-children">
                <Baby className="h-4 w-4" /> أطفالي
              </TabsTrigger>
              <TabsTrigger value="hourly" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#4A90D9]/15 data-[state=active]:text-[#2A6FC7] data-[state=active]:shadow-[0_2px_6px_rgba(74,144,217,0.15)] data-[state=active]:font-bold transition" data-testid="tab-hourly">
                <Clock className="h-4 w-4" /> بالساعة
              </TabsTrigger>
              <TabsTrigger value="birthday" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#E8872E]/15 data-[state=active]:text-[#C66A1B] data-[state=active]:shadow-[0_2px_6px_rgba(232,135,46,0.15)] data-[state=active]:font-bold transition" data-testid="tab-birthday">
                <Cake className="h-4 w-4" /> أعياد الميلاد
              </TabsTrigger>
              <TabsTrigger value="subscriptions" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#E63946]/12 data-[state=active]:text-[#C62433] data-[state=active]:shadow-[0_2px_6px_rgba(230,57,70,0.15)] data-[state=active]:font-bold transition" data-testid="tab-subscriptions">
                <Star className="h-4 w-4" /> الاشتراكات
              </TabsTrigger>
              <TabsTrigger value="loyalty" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#7AC74F]/18 data-[state=active]:text-[#3F7A1E] data-[state=active]:shadow-[0_2px_6px_rgba(122,199,79,0.15)] data-[state=active]:font-bold transition" data-testid="tab-loyalty">
                <Gift className="h-4 w-4" /> نقاط الولاء
              </TabsTrigger>
              <TabsTrigger value="settings" className="rounded-xl gap-2 px-3.5 py-2 data-[state=active]:bg-[#2D2D2D]/8 data-[state=active]:text-[#2D2D2D] data-[state=active]:shadow-[0_2px_6px_rgba(45,45,45,0.12)] data-[state=active]:font-bold transition" data-testid="tab-settings">
                <Settings className="h-4 w-4" /> الإعدادات
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Children Tab */}
          <TabsContent value="children">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader className="flex flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="shrink-0 w-10 h-10 rounded-xl bg-[#FFD166]/25 flex items-center justify-center">
                    <Baby className="h-5 w-5 text-[#8A5A00]" />
                  </div>
                  <div className="min-w-0">
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl">أطفالي</CardTitle>
                    <CardDescription>إدارة ملفات أطفالك</CardDescription>
                  </div>
                </div>
                <Dialog open={addChildOpen} onOpenChange={setAddChildOpen}>
                  <DialogTrigger asChild>
                    <Button className="rounded-full gap-2 shrink-0" data-testid="add-child-btn">
                      <Plus className="h-4 w-4" /> <span className="hidden sm:inline">إضافة طفل</span><span className="sm:hidden">إضافة</span>
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="rounded-3xl">
                    <DialogHeader>
                      <DialogTitle className="font-heading">إضافة طفل</DialogTitle>
                    </DialogHeader>
                    <form onSubmit={handleAddChild} className="space-y-4">
                      <div>
                        <Label htmlFor="childName">الاسم</Label>
                        <Input
                          id="childName"
                          value={newChildName}
                          onChange={(e) => setNewChildName(e.target.value)}
                          className="rounded-xl mt-2"
                          placeholder="اسم الطفل"
                          data-testid="child-name-input"
                        />
                      </div>
                      <div>
                        <Label htmlFor="childBirthday">تاريخ الميلاد</Label>
                        <Input
                          id="childBirthday"
                          type="date"
                          value={newChildBirthday}
                          onChange={(e) => setNewChildBirthday(e.target.value)}
                          className="rounded-xl mt-2"
                          data-testid="child-birthday-input"
                        />
                      </div>
                      <Button type="submit" className="w-full rounded-full" data-testid="save-child-btn">
                        إضافة طفل
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {children.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <div className="w-16 h-16 rounded-2xl bg-[#FFD166]/20 flex items-center justify-center mx-auto mb-4">
                      <Baby className="h-8 w-8 text-[#8A5A00]" />
                    </div>
                    <p className="font-semibold text-[#2D2D2D]">لم يتم إضافة أطفال بعد</p>
                    <p className="text-sm mt-2">أضف طفلك الأول لبدء الحجز</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {children.map((child) => (
                      <Card key={child.id} className="border border-[#E6EAF2] rounded-2xl hover:shadow-md transition-shadow" data-testid={`child-card-${child.id}`}>
                        <CardContent className="p-4 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#FFD166]/25 to-[#FFE2A8]/40 flex items-center justify-center shrink-0">
                              <Baby className="h-5 w-5 text-[#8A5A00]" />
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{child.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {formatDateSafe(child.birthday, 'yyyy/MM/dd', 'تاريخ ميلاد غير محدد')}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteChild(child.id)}
                            className="text-destructive hover:text-destructive hover:bg-red-50 shrink-0"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Hourly Bookings Tab */}
          <TabsContent value="hourly">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#4A90D9]/15 flex items-center justify-center">
                    <Clock className="h-5 w-5 text-[#2A6FC7]" />
                  </div>
                  <div>
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl">حجوزات اللعب بالساعة</CardTitle>
                    <CardDescription>سجل جلسات اللعب الخاصة بك</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {hourlyBookings.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <div className="w-16 h-16 rounded-2xl bg-[#4A90D9]/10 flex items-center justify-center mx-auto mb-4">
                      <Clock className="h-8 w-8 text-[#2A6FC7]" />
                    </div>
                    <p className="font-semibold text-[#2D2D2D]">لا توجد حجوزات بعد</p>
                    <Button onClick={() => navigate('/tickets')} className="rounded-full mt-4">
                      احجز جلسة
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {hourlyBookings.map((booking) => (
                      <Card key={booking.id} className="border border-[#E6EAF2] rounded-2xl overflow-hidden hover:shadow-md transition-shadow relative">
                        <div className="absolute top-0 bottom-0 right-0 w-1 bg-[#4A90D9]/40" aria-hidden="true" />
                        <CardContent className="p-4 pr-5">
                          <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex items-start gap-4">
                              {booking.status === 'confirmed' && booking.qr_code && (
                                <div className="qr-container hidden md:block shrink-0">
                                  <img src={booking.qr_code} alt="رمز QR" className="w-20 h-20 rounded-lg border border-gray-200" />
                                </div>
                              )}
                              <div>
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className="font-bold font-mono text-[#2D2D2D] tracking-wide">{booking.booking_code}</span>
                                  <Badge className={getStatusBadge(booking.status)}>
                                    {booking.status === 'confirmed' ? 'مؤكد' : booking.status === 'checked_in' ? 'مسجل الدخول' : booking.status === 'completed' ? 'مكتمل' : booking.status === 'cancelled' ? 'ملغي' : booking.status}
                                  </Badge>
                                  {(() => {
                                    const qrLabel = getQrStatusLabel(booking);
                                    return qrLabel ? (
                                      <span
                                        className={`text-xs font-bold px-2 py-0.5 rounded-full border ${qrLabel.cls}`}
                                        data-testid="qr-status-label"
                                      >
                                        {qrLabel.text}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5">
                                  <Calendar className="h-3.5 w-3.5" />
                                  {booking.slot_id?.date} <span className="text-[#2D2D2D]/50">·</span> {booking.slot_id?.start_time}
                                </p>
                                <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5 mt-0.5">
                                  <Baby className="h-3.5 w-3.5" />
                                  {booking.child_id?.name}
                                </p>
                              </div>
                            </div>
                            <div className="text-left">
                              <p className="font-heading font-extrabold text-lg text-[#E63946]">{booking.amount} <span className="text-sm text-[#2D2D2D]/60 font-bold">دينار</span></p>
                              {booking.coupon_code && (
                                <p className="text-xs text-green-700 mt-0.5">كوبون: {booking.coupon_code}</p>
                              )}
                              {booking.status === 'confirmed' && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button variant="outline" size="sm" className="rounded-full mt-2 md:hidden">
                                      <QrCode className="h-4 w-4 ml-1" /> عرض QR
                                    </Button>
                                  </DialogTrigger>
                                  <DialogContent>
                                    <DialogHeader>
                                      <DialogTitle>رمز QR للحجز</DialogTitle>
                                    </DialogHeader>
                                    <div className="flex justify-center">
                                      <img src={booking.qr_code} alt="رمز QR" className="w-48 h-48" />
                                    </div>
                                    <p className="text-center text-muted-foreground">
                                      اعرض هذا الرمز في الاستقبال لتسجيل الدخول
                                    </p>
                                  </DialogContent>
                                </Dialog>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Birthday Bookings Tab */}
          <TabsContent value="birthday">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#E8872E]/15 flex items-center justify-center">
                    <Cake className="h-5 w-5 text-[#C66A1B]" />
                  </div>
                  <div>
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl">حجوزات أعياد الميلاد</CardTitle>
                    <CardDescription>حجوزات الحفلات الخاصة بك</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {birthdayBookings.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <div className="w-16 h-16 rounded-2xl bg-[#E8872E]/12 flex items-center justify-center mx-auto mb-4">
                      <Cake className="h-8 w-8 text-[#C66A1B]" />
                    </div>
                    <p className="font-semibold text-[#2D2D2D]">لا توجد حجوزات حفلات بعد</p>
                    <Button onClick={() => navigate('/birthday')} className="rounded-full mt-4 bg-accent">
                      احجز حفلة
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {birthdayBookings.map((booking) => (
                      <Card key={booking.id} className="border border-[#E6EAF2] rounded-2xl overflow-hidden hover:shadow-md transition-shadow relative">
                        <div className="absolute top-0 bottom-0 right-0 w-1 bg-[#E8872E]/50" aria-hidden="true" />
                        <CardContent className="p-4 pr-5">
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="font-bold font-mono text-[#2D2D2D] tracking-wide">{booking.booking_code}</span>
                                <Badge className={getStatusBadge(booking.status)}>
                                  {booking.status === 'confirmed' ? 'مؤكد' : booking.status === 'custom_pending' ? 'قيد المراجعة' : booking.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {booking.slot_id?.date} <span className="text-[#2D2D2D]/50">·</span> {booking.slot_id?.start_time}
                              </p>
                              <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5 mt-0.5">
                                <Baby className="h-3.5 w-3.5" />
                                {booking.child_id?.name}
                              </p>
                              <p className="text-sm text-[#2D2D2D]/80 mt-1">
                                <span className="text-[#2D2D2D]/55">الثيم:</span> {booking.is_custom ? 'طلب مخصص' : booking.theme_id?.name_ar || booking.theme_id?.name}
                              </p>
                            </div>
                            <div className="text-left shrink-0">
                              {booking.amount && <p className="font-heading font-extrabold text-lg text-[#C66A1B]">{booking.amount} <span className="text-sm text-[#2D2D2D]/60 font-bold">دينار</span></p>}
                              {booking.is_custom && (
                                <p className="text-xs text-muted-foreground mt-1">بانتظار التسعير</p>
                              )}
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscriptions Tab */}
          <TabsContent value="subscriptions">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#E63946]/12 flex items-center justify-center">
                    <Star className="h-5 w-5 text-[#C62433]" />
                  </div>
                  <div>
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl">سجل الاشتراكات</CardTitle>
                    <CardDescription>باقات الاشتراك الخاصة بك</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {subscriptions.length === 0 ? (
                  <div className="text-center py-12 text-muted-foreground">
                    <div className="w-16 h-16 rounded-2xl bg-[#E63946]/8 flex items-center justify-center mx-auto mb-4">
                      <Star className="h-8 w-8 text-[#C62433]" />
                    </div>
                    <p className="font-semibold text-[#2D2D2D]">لا توجد اشتراكات بعد</p>
                    <Button onClick={() => navigate('/subscriptions')} className="rounded-full mt-4 bg-secondary text-secondary-foreground">
                      تصفح الباقات
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {subscriptions.map((sub) => (
                      <Card key={sub.id} className={`border border-[#E6EAF2] rounded-2xl overflow-hidden hover:shadow-md transition-shadow relative ${sub.status === 'active' || sub.status === 'pending' ? 'ring-1 ring-[#E63946]/25' : ''}`}>
                        <div className="absolute top-0 bottom-0 right-0 w-1 bg-[#E63946]/50" aria-hidden="true" />
                        <CardContent className="p-4 pr-5">
                          <div className="flex justify-between items-start gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="font-semibold text-[#2D2D2D]">{sub.plan_id?.name_ar || sub.plan_id?.name}</span>
                                <Badge className={getStatusBadge(sub.status)}>
                                  {sub.status === 'pending' ? 'غير مفعّل' : sub.status === 'active' ? 'نشط' : sub.status === 'expired' ? 'منتهي' : sub.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5">
                                <Baby className="h-3.5 w-3.5" />
                                {sub.child_id?.name}
                              </p>
                              <p className="text-sm text-[#2D2D2D]/70 inline-flex items-center gap-1.5 mt-0.5">
                                <Calendar className="h-3.5 w-3.5" />
                                {sub.status === 'pending'
                                  ? 'ينتهي بعد 30 يوم من أول تسجيل دخول'
                                  : sub.expires_at
                                    ? `ينتهي: ${formatDateSafe(sub.expires_at, 'yyyy/MM/dd', 'غير محدد')}`
                                    : 'لم يتم تحديد تاريخ انتهاء'
                                }
                              </p>
                            </div>
                            <div className="text-left shrink-0 bg-[#FDECEF] rounded-2xl px-4 py-2 border border-[#E63946]/20">
                              <div className="text-2xl md:text-3xl font-heading font-extrabold text-[#C62433] leading-none">
                                {sub.remaining_visits}
                              </div>
                              <p className="text-[11px] text-[#2D2D2D]/60 mt-0.5 text-center">زيارة متبقية</p>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Loyalty Tab */}
          <TabsContent value="loyalty">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#7AC74F]/18 flex items-center justify-center">
                    <Gift className="h-5 w-5 text-[#3F7A1E]" />
                  </div>
                  <div>
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl flex items-center gap-2">
                      نقاطي
                    </CardTitle>
                    <CardDescription>
                      راقب رصيد نقاطك وقيمتها بالدينار.
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Points Balance Card - premium */}
                <div className="relative overflow-hidden rounded-3xl p-6 md:p-8 text-center bg-gradient-to-br from-[#FFF9E3] via-[#FFE9B5] to-[#FFD78A] border border-[#F2E533]/50 shadow-[0_10px_24px_rgba(242,229,51,0.2)]">
                  <div aria-hidden="true" className="pointer-events-none absolute -top-6 -right-6 w-24 h-24 rounded-full bg-white/40 blur-2xl" />
                  <div aria-hidden="true" className="pointer-events-none absolute -bottom-6 -left-6 w-32 h-32 rounded-full bg-[#E8872E]/20 blur-3xl" />
                  <div className="relative">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/70 text-[#8A5A00] text-xs font-bold mb-3">
                      <Sparkles className="h-3.5 w-3.5" /> النقاط المتاحة
                    </div>
                    {loyaltyLoading ? (
                      <p className="text-lg text-[#8A5A00]">جاري تحميل نقاطك...</p>
                    ) : loyaltyError ? (
                      <p className="text-lg text-destructive">{loyaltyError}</p>
                    ) : (
                      <>
                        <p className="text-6xl md:text-7xl font-heading font-extrabold text-[#C66A1B] drop-shadow-sm">
                          {loyaltyBalance}
                        </p>
                        <p className="text-base text-[#8A5A00] mt-1 font-bold">نقطة</p>
                        <div className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-full bg-white/80 border border-white text-[#2D2D2D] text-sm font-bold shadow-sm">
                          ≈ {loyaltyJdValue.toFixed(2)} دينار
                        </div>
                      </>
                    )}
                  </div>
                </div>

                {/* History */}
                <div>
                  <h4 className="font-heading font-bold mb-3 text-[#2D2D2D] flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-[#3F7A1E]" />
                    سجل النقاط
                  </h4>
                  {loyaltyLoading ? (
                    <div className="text-center py-8 text-muted-foreground">جاري تحميل سجل النقاط...</div>
                  ) : loyaltyError ? (
                    <div className="text-center py-8 text-destructive">{loyaltyError}</div>
                  ) : loyaltyHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Gift className="h-10 w-10 mx-auto mb-3 opacity-50" />
                      <p>لا يوجد سجل نقاط بعد</p>
                      <p className="text-sm mt-2">اكسب نقاط الولاء عند تسجيل الدخول للحجوزات!</p>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {loyaltyHistory.map((entry) => {
                        const delta = entry.pointsDelta ?? entry.points ?? 0;
                        const isPositive = delta >= 0;
                        return (
                          <div key={entry.id || entry._id || `${entry.createdAt || entry.created_at}-${entry.reason || entry.description}`} className="flex justify-between items-center p-3.5 rounded-xl bg-[#F7F9FB] border border-[#E6EAF2] hover:bg-white transition-colors">
                            <div className="flex items-center gap-3 min-w-0">
                              <div className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center ${isPositive ? 'bg-green-50' : 'bg-red-50'}`}>
                                <Gift className={`h-4 w-4 ${isPositive ? 'text-green-600' : 'text-red-600'}`} />
                              </div>
                              <div className="min-w-0">
                                <p className="font-medium text-sm text-[#2D2D2D] truncate">{entry.reason || entry.description || 'عملية نقاط'}</p>
                                <p className="text-xs text-muted-foreground">
                                  {entry.createdAt || entry.created_at
                                    ? formatDateSafe(entry.createdAt || entry.created_at, 'dd/MM/yyyy')
                                    : '--/--/----'}
                                </p>
                              </div>
                            </div>
                            <span className={`font-heading font-extrabold text-base shrink-0 ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                              {isPositive ? '+' : '-'}{Math.abs(delta)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <Card className="border border-[#E6EAF2] rounded-3xl shadow-sm">
              <CardHeader>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#2D2D2D]/8 flex items-center justify-center">
                    <Settings className="h-5 w-5 text-[#2D2D2D]" />
                  </div>
                  <div>
                    <CardTitle className="font-heading heading-bubble text-xl md:text-2xl">الإعدادات</CardTitle>
                    <CardDescription>تعديل معلومات حسابك</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Phone Number */}
                <div className="space-y-3 rounded-2xl bg-[#F7F9FB] border border-[#E6EAF2] p-4 md:p-5">
                  <Label className="text-base font-bold text-[#2D2D2D] inline-flex items-center gap-2">
                    <Phone className="h-4 w-4 text-[#2A6FC7]" />
                    رقم الهاتف
                  </Label>
                  <div className="flex gap-3 items-center max-w-md">
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      <Input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="07XXXXXXXX"
                        className="pl-10 rounded-xl h-12 bg-white"
                        dir="ltr"
                        data-testid="phone-input"
                      />
                    </div>
                    <Button
                      onClick={handleSavePhone}
                      disabled={savingPhone}
                      className="rounded-full h-12 px-6"
                      data-testid="save-phone-btn"
                    >
                      {savingPhone ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        'حفظ'
                      )}
                    </Button>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    أدخل رقم هاتفك الأردني للتواصل (07XXXXXXXX)
                  </p>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
