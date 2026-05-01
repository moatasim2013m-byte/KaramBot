import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTranslation } from '../i18n/useT';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  User, Baby, Clock, Cake, Star, Gift, Plus, Edit, Trash2, 
  AlertTriangle, Calendar, Loader2, Phone, Settings, QrCode
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

  const initial = (user?.name || '').trim().charAt(0) || '؟';

  return (
    <div className="parent-dashboard-bg py-6 md:py-10" dir="rtl">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
        {/* Premium Identity Card */}
        <section className="identity-card p-5 sm:p-6 md:p-8 mb-6 md:mb-8">
          <div className="flex flex-col md:flex-row md:items-center gap-5 md:gap-6">
            <div className="flex items-start md:items-center gap-4 flex-1 min-w-0">
              <div className="identity-avatar" aria-hidden="true">
                {initial}
              </div>
              <div className="min-w-0">
                <p className="text-xs md:text-sm font-semibold text-[var(--pk-blue)] mb-1">
                  أهلاً بعودتك 👋
                </p>
                <h1
                  className="font-heading text-2xl sm:text-3xl md:text-4xl font-bold text-foreground leading-tight truncate"
                  data-testid="profile-title"
                >
                  {user?.name || ''}
                </h1>
                <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {user?.email && (
                    <span className="truncate max-w-[240px] sm:max-w-none">{user.email}</span>
                  )}
                  {user?.email && user?.phone && (
                    <span className="hidden sm:inline text-[var(--pk-blue)]/40">•</span>
                  )}
                  {user?.phone && (
                    <span className="ltr-text font-semibold text-[var(--text-primary)]" dir="ltr">
                      {user.phone}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Loyalty Summary */}
            <div className="loyalty-chip self-start md:self-center">
              <div className="loyalty-chip__icon">
                <Gift className="h-5 w-5" />
              </div>
              <div className="leading-tight">
                <p className="text-[11px] text-muted-foreground">رصيد نقاطي</p>
                <p className="font-heading text-xl font-bold text-[var(--pk-orange)] leading-none">
                  {loyaltyBalance}
                  <span className="text-xs text-muted-foreground font-semibold mr-1">نقطة</span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  ≈ {loyaltyJdValue.toFixed(2)} د.أ
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Active Session Alert */}
        {activeSession && (
          <div
            className={`relative overflow-hidden rounded-3xl mb-6 md:mb-8 border shadow-sm ${
              activeSession.warning_5min
                ? 'bg-gradient-to-l from-[var(--pk-red)]/10 via-white to-white border-[var(--pk-red)]/40'
                : 'bg-gradient-to-l from-[var(--pk-blue)]/10 via-white to-white border-[var(--pk-blue)]/30'
            }`}
          >
            <div className="p-5 md:p-6 flex flex-col md:flex-row items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div
                  className={`p-3 rounded-2xl shadow-sm ${
                    activeSession.warning_5min
                      ? 'bg-[var(--pk-red)] timer-warning'
                      : 'bg-[var(--pk-blue)]'
                  }`}
                >
                  <Clock className="h-6 w-6 text-white" />
                </div>
                <div>
                  <h3 className="font-heading font-bold text-lg text-foreground">جلسة لعب نشطة</h3>
                  <p className="text-sm text-muted-foreground">
                    {activeSession.child_id?.name || 'الطفل'} يلعب الآن!
                  </p>
                </div>
              </div>
              <div className="text-center">
                <div
                  className={`text-4xl font-heading font-bold ${
                    activeSession.warning_5min ? 'text-[var(--pk-red)]' : 'text-[var(--pk-blue)]'
                  }`}
                >
                  {activeSession.remaining_minutes} دقيقة
                </div>
                <p className="text-sm text-muted-foreground">متبقية</p>
                {activeSession.warning_5min && (
                  <div className="flex items-center justify-center gap-1 text-[var(--pk-red)] mt-1">
                    <AlertTriangle className="h-4 w-4" />
                    <span className="text-sm font-semibold">الجلسة تنتهي قريباً!</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Main Tabs */}
        <Tabs defaultValue="children" className="space-y-5 md:space-y-6">
          <div className="overflow-x-auto md:overflow-visible -mx-1 px-1">
            <TabsList className="dashboard-tabs-list">
              <TabsTrigger
                value="children"
                className="dashboard-tab-trigger"
                data-testid="tab-children"
              >
                <Baby className="h-4 w-4" /> أطفالي
              </TabsTrigger>
              <TabsTrigger
                value="hourly"
                className="dashboard-tab-trigger tab-accent-yellow"
                data-testid="tab-hourly"
              >
                <Clock className="h-4 w-4" /> بالساعة
              </TabsTrigger>
              <TabsTrigger
                value="birthday"
                className="dashboard-tab-trigger tab-accent-pink"
                data-testid="tab-birthday"
              >
                <Cake className="h-4 w-4" /> أعياد الميلاد
              </TabsTrigger>
              <TabsTrigger
                value="subscriptions"
                className="dashboard-tab-trigger tab-accent-green"
                data-testid="tab-subscriptions"
              >
                <Star className="h-4 w-4" /> الاشتراكات
              </TabsTrigger>
              <TabsTrigger
                value="loyalty"
                className="dashboard-tab-trigger tab-accent-orange"
                data-testid="tab-loyalty"
              >
                <Gift className="h-4 w-4" /> نقاطي
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="dashboard-tab-trigger"
                data-testid="tab-settings"
              >
                <Settings className="h-4 w-4" /> الإعدادات
              </TabsTrigger>
            </TabsList>
          </div>

          {/* Children Tab */}
          <TabsContent value="children">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Baby className="h-5 w-5 text-[var(--pk-blue)]" />
                    أطفالي
                  </h3>
                  <p>إدارة ملفات أطفالك للحجز الأسرع</p>
                </div>
                <Dialog open={addChildOpen} onOpenChange={setAddChildOpen}>
                  <DialogTrigger asChild>
                    <Button className="rounded-full gap-2 btn-playful h-10 px-4 text-sm" data-testid="add-child-btn">
                      <Plus className="h-4 w-4" /> إضافة طفل
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
                      <Button type="submit" className="w-full rounded-full btn-playful" data-testid="save-child-btn">
                        إضافة طفل
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="dashboard-card__body">
                {children.length === 0 ? (
                  <div className="dashboard-empty">
                    <div className="dashboard-empty__icon">
                      <Baby className="h-8 w-8" />
                    </div>
                    <p className="font-heading text-lg font-bold text-foreground mb-1">لم يتم إضافة أطفال بعد</p>
                    <p className="text-sm">أضف طفلك الأول لبدء الحجز بشكل أسرع</p>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {children.map((child) => (
                      <div key={child.id} className="child-card" data-testid={`child-card-${child.id}`}>
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="child-avatar">
                            <Baby className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <p className="font-heading font-bold text-foreground truncate">{child.name}</p>
                            <p className="text-xs text-muted-foreground">
                              تاريخ الميلاد: {formatDateSafe(child.birthday, 'yyyy/MM/dd', 'غير محدد')}
                            </p>
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleDeleteChild(child.id)}
                          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full shrink-0"
                          aria-label="حذف الطفل"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Hourly Bookings Tab */}
          <TabsContent value="hourly">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Clock className="h-5 w-5 text-[var(--pk-yellow)]" style={{ color: '#c7a700' }} />
                    حجوزات اللعب بالساعة
                  </h3>
                  <p>سجل جلسات اللعب الخاصة بك</p>
                </div>
                <Button
                  onClick={() => navigate('/tickets')}
                  variant="outline"
                  className="rounded-full border-[var(--pk-yellow)]/60 bg-[var(--pk-yellow)]/15 hover:bg-[var(--pk-yellow)]/25 text-[var(--text-primary)] h-10 px-4 text-sm gap-2"
                >
                  <Plus className="h-4 w-4" /> حجز جديد
                </Button>
              </div>
              <div className="dashboard-card__body">
                {hourlyBookings.length === 0 ? (
                  <div className="dashboard-empty">
                    <div className="dashboard-empty__icon">
                      <Clock className="h-8 w-8" />
                    </div>
                    <p className="font-heading text-lg font-bold text-foreground mb-1">لا توجد حجوزات بعد</p>
                    <p className="text-sm mb-4">احجز جلستك الأولى بالساعة الآن</p>
                    <Button onClick={() => navigate('/tickets')} className="rounded-full btn-playful">
                      احجز جلسة
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hourlyBookings.map((booking) => {
                      const statusClass =
                        booking.status === 'confirmed'
                          ? 'is-confirmed'
                          : booking.status === 'pending'
                          ? 'is-pending'
                          : booking.status === 'cancelled'
                          ? 'is-cancelled'
                          : booking.status === 'completed' || booking.status === 'checked_in'
                          ? 'is-done'
                          : '';
                      return (
                        <div key={booking.id} className={`booking-row ${statusClass}`}>
                          <div className="flex flex-col md:flex-row justify-between gap-4">
                            <div className="flex items-start gap-4">
                              {booking.status === 'confirmed' && booking.qr_code && (
                                <div className="qr-container hidden md:block shrink-0 p-2 rounded-xl bg-white border border-[var(--pk-blue)]/20">
                                  <img src={booking.qr_code} alt="رمز QR" className="w-20 h-20" />
                                </div>
                              )}
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                  <span className="font-heading font-bold text-foreground tracking-wide">
                                    {booking.booking_code}
                                  </span>
                                  <Badge className={`${getStatusBadge(booking.status)} font-bold`}>
                                    {booking.status === 'confirmed'
                                      ? 'مؤكد'
                                      : booking.status === 'checked_in'
                                      ? 'مسجل الدخول'
                                      : booking.status === 'completed'
                                      ? 'مكتمل'
                                      : booking.status === 'cancelled'
                                      ? 'ملغي'
                                      : booking.status}
                                  </Badge>
                                  {(() => {
                                    const qrLabel = getQrStatusLabel(booking);
                                    return qrLabel ? (
                                      <span
                                        className={`text-[11px] font-bold px-2 py-0.5 rounded-full border ${qrLabel.cls}`}
                                        data-testid="qr-status-label"
                                      >
                                        {qrLabel.text}
                                      </span>
                                    ) : null;
                                  })()}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                                  <span className="inline-flex items-center gap-1">
                                    <Calendar className="h-3.5 w-3.5" />
                                    {booking.slot_id?.date}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <Clock className="h-3.5 w-3.5" />
                                    {booking.slot_id?.start_time}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <Baby className="h-3.5 w-3.5" />
                                    {booking.child_id?.name}
                                  </span>
                                </div>
                              </div>
                            </div>
                            <div className="md:text-left flex md:block items-center justify-between">
                              <div>
                                <p className="font-heading font-bold text-lg text-[var(--pk-orange)]">
                                  {booking.amount} د.أ
                                </p>
                                {booking.coupon_code && (
                                  <p className="text-xs text-[var(--pk-green)] font-semibold">
                                    كوبون: {booking.coupon_code}
                                  </p>
                                )}
                              </div>
                              {booking.status === 'confirmed' && (
                                <Dialog>
                                  <DialogTrigger asChild>
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="rounded-full md:mt-2 md:hidden border-[var(--pk-blue)]/40 text-[var(--pk-blue)]"
                                    >
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
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Birthday Bookings Tab */}
          <TabsContent value="birthday">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Cake className="h-5 w-5 text-[var(--pk-red)]" />
                    حجوزات أعياد الميلاد
                  </h3>
                  <p>حفلاتك المحجوزة والطلبات المخصصة</p>
                </div>
                <Button
                  onClick={() => navigate('/birthday')}
                  variant="outline"
                  className="rounded-full border-[var(--pk-red)]/40 bg-[var(--pk-red)]/10 hover:bg-[var(--pk-red)]/15 text-[var(--pk-red)] h-10 px-4 text-sm gap-2"
                >
                  <Plus className="h-4 w-4" /> احجز حفلة
                </Button>
              </div>
              <div className="dashboard-card__body">
                {birthdayBookings.length === 0 ? (
                  <div className="dashboard-empty">
                    <div className="dashboard-empty__icon">
                      <Cake className="h-8 w-8" />
                    </div>
                    <p className="font-heading text-lg font-bold text-foreground mb-1">لا توجد حجوزات حفلات بعد</p>
                    <p className="text-sm mb-4">اجعل عيد ميلاد طفلك لا يُنسى مع بيكابو</p>
                    <Button onClick={() => navigate('/birthday')} className="rounded-full btn-playful">
                      احجز حفلة
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {birthdayBookings.map((booking) => {
                      const statusClass =
                        booking.status === 'confirmed'
                          ? 'is-confirmed'
                          : booking.status === 'custom_pending' || booking.status === 'pending'
                          ? 'is-pending'
                          : booking.status === 'cancelled'
                          ? 'is-cancelled'
                          : '';
                      return (
                        <div key={booking.id} className={`booking-row ${statusClass}`}>
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-3">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="font-heading font-bold text-foreground tracking-wide">
                                  {booking.booking_code}
                                </span>
                                <Badge className={`${getStatusBadge(booking.status)} font-bold`}>
                                  {booking.status === 'confirmed'
                                    ? 'مؤكد'
                                    : booking.status === 'custom_pending'
                                    ? 'قيد المراجعة'
                                    : booking.status}
                                </Badge>
                              </div>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                                <span className="inline-flex items-center gap-1">
                                  <Calendar className="h-3.5 w-3.5" />
                                  {booking.slot_id?.date}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Clock className="h-3.5 w-3.5" />
                                  {booking.slot_id?.start_time}
                                </span>
                                <span className="inline-flex items-center gap-1">
                                  <Baby className="h-3.5 w-3.5" />
                                  {booking.child_id?.name}
                                </span>
                              </div>
                              <p className="text-sm mt-1.5">
                                <span className="text-muted-foreground">الثيم:</span>{' '}
                                <span className="font-semibold text-foreground">
                                  {booking.is_custom
                                    ? 'طلب مخصص'
                                    : booking.theme_id?.name_ar || booking.theme_id?.name}
                                </span>
                              </p>
                            </div>
                            <div className="text-left shrink-0">
                              {booking.amount && (
                                <p className="font-heading font-bold text-lg text-[var(--pk-orange)]">
                                  {booking.amount} د.أ
                                </p>
                              )}
                              {booking.is_custom && (
                                <p className="text-xs text-muted-foreground">بانتظار التسعير</p>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Subscriptions Tab */}
          <TabsContent value="subscriptions">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Star className="h-5 w-5 text-[var(--pk-green)]" />
                    سجل الاشتراكات
                  </h3>
                  <p>باقاتك النشطة والسابقة والزيارات المتبقية</p>
                </div>
                <Button
                  onClick={() => navigate('/subscriptions')}
                  variant="outline"
                  className="rounded-full border-[var(--pk-green)]/40 bg-[var(--pk-green)]/10 hover:bg-[var(--pk-green)]/15 text-[#5a7a1e] h-10 px-4 text-sm gap-2"
                >
                  <Plus className="h-4 w-4" /> تصفح الباقات
                </Button>
              </div>
              <div className="dashboard-card__body">
                {subscriptions.length === 0 ? (
                  <div className="dashboard-empty">
                    <div className="dashboard-empty__icon">
                      <Star className="h-8 w-8" />
                    </div>
                    <p className="font-heading text-lg font-bold text-foreground mb-1">لا توجد اشتراكات بعد</p>
                    <p className="text-sm mb-4">وفّر أكثر مع باقاتنا المتنوعة</p>
                    <Button onClick={() => navigate('/subscriptions')} className="rounded-full btn-playful">
                      تصفح الباقات
                    </Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {subscriptions.map((sub) => {
                      const statusClass =
                        sub.status === 'active'
                          ? 'is-confirmed'
                          : sub.status === 'pending'
                          ? 'is-pending'
                          : sub.status === 'expired'
                          ? 'is-cancelled'
                          : 'is-done';
                      return (
                        <div key={sub.id} className={`booking-row ${statusClass}`}>
                          <div className="flex flex-col sm:flex-row justify-between items-start gap-4">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                                <span className="font-heading font-bold text-foreground">
                                  {sub.plan_id?.name_ar || sub.plan_id?.name}
                                </span>
                                <Badge className={`${getStatusBadge(sub.status)} font-bold`}>
                                  {sub.status === 'pending'
                                    ? 'غير مفعّل'
                                    : sub.status === 'active'
                                    ? 'نشط'
                                    : sub.status === 'expired'
                                    ? 'منتهي'
                                    : sub.status}
                                </Badge>
                              </div>
                              <p className="text-sm text-muted-foreground inline-flex items-center gap-1">
                                <Baby className="h-3.5 w-3.5" />
                                {sub.child_id?.name}
                              </p>
                              <p className="text-sm text-muted-foreground mt-1 inline-flex items-center gap-1">
                                <Calendar className="h-3.5 w-3.5" />
                                {sub.status === 'pending'
                                  ? 'ينتهي بعد 30 يوم من أول تسجيل دخول'
                                  : sub.expires_at
                                  ? `ينتهي: ${formatDateSafe(sub.expires_at, 'yyyy/MM/dd', 'غير محدد')}`
                                  : 'لم يتم تحديد تاريخ انتهاء'}
                              </p>
                            </div>
                            <div className="text-center bg-[var(--pk-green)]/10 rounded-2xl px-4 py-2 border border-[var(--pk-green)]/25 shrink-0">
                              <div className="text-3xl font-heading font-bold text-[#5a7a1e] leading-none">
                                {sub.remaining_visits}
                              </div>
                              <p className="text-[11px] text-muted-foreground mt-1">زيارة متبقية</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </TabsContent>

          {/* Loyalty Tab */}
          <TabsContent value="loyalty">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Gift className="h-5 w-5 text-[var(--pk-orange)]" />
                    نقاطي
                  </h3>
                  <p>راقب رصيد نقاطك وقيمتها بالدينار</p>
                </div>
              </div>
              <div className="dashboard-card__body space-y-6">
                {/* Points Balance Hero */}
                <div className="loyalty-hero">
                  <p className="text-xs md:text-sm font-semibold text-[var(--pk-orange)] mb-1 tracking-wide uppercase">
                    النقاط المتاحة
                  </p>
                  {loyaltyLoading ? (
                    <p className="text-base text-muted-foreground py-6">جاري تحميل نقاطك...</p>
                  ) : loyaltyError ? (
                    <p className="text-base text-destructive py-6">{loyaltyError}</p>
                  ) : (
                    <>
                      <p className="font-heading text-6xl md:text-7xl font-bold text-[var(--pk-orange)] leading-none">
                        {loyaltyBalance}
                      </p>
                      <p className="text-base text-[var(--text-secondary)] font-semibold mt-1">نقطة</p>
                      <div className="inline-flex items-center gap-2 mt-4 px-4 py-1.5 bg-white/80 rounded-full border border-[var(--pk-orange)]/25 shadow-sm">
                        <Gift className="h-4 w-4 text-[var(--pk-orange)]" />
                        <span className="text-sm font-semibold text-[var(--text-primary)]">
                          القيمة: {loyaltyJdValue.toFixed(2)} د.أ
                        </span>
                      </div>
                    </>
                  )}
                </div>

                {/* History */}
                <div>
                  <h4 className="font-heading font-bold text-base mb-3 flex items-center gap-2">
                    <span className="inline-block w-1.5 h-5 rounded-full bg-[var(--pk-orange)]" />
                    سجل النقاط
                  </h4>
                  {loyaltyLoading ? (
                    <div className="text-center py-8 text-muted-foreground">جاري تحميل سجل النقاط...</div>
                  ) : loyaltyError ? (
                    <div className="text-center py-8 text-destructive">{loyaltyError}</div>
                  ) : loyaltyHistory.length === 0 ? (
                    <div className="dashboard-empty">
                      <div className="dashboard-empty__icon">
                        <Gift className="h-7 w-7" />
                      </div>
                      <p className="font-semibold text-foreground">لا يوجد سجل نقاط بعد</p>
                      <p className="text-sm mt-1">اكسب نقاط الولاء عند تسجيل الدخول للحجوزات!</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {loyaltyHistory.map((entry) => {
                        const delta = entry.pointsDelta ?? entry.points ?? 0;
                        const isPositive = delta >= 0;
                        return (
                          <div
                            key={
                              entry.id ||
                              entry._id ||
                              `${entry.createdAt || entry.created_at}-${entry.reason || entry.description}`
                            }
                            className="loyalty-history-row"
                          >
                            <div className="min-w-0">
                              <p className="font-semibold text-foreground truncate">
                                {entry.reason || entry.description || 'عملية نقاط'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {entry.createdAt || entry.created_at
                                  ? formatDateSafe(entry.createdAt || entry.created_at, 'dd/MM/yyyy')
                                  : '--/--/----'}
                              </p>
                            </div>
                            <span
                              className={`font-heading font-bold text-base px-3 py-1 rounded-full shrink-0 ${
                                isPositive
                                  ? 'bg-[var(--pk-green)]/15 text-[#5a7a1e]'
                                  : 'bg-[var(--pk-red)]/10 text-[var(--pk-red)]'
                              }`}
                            >
                              {isPositive ? '+' : '-'}
                              {Math.abs(delta)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </TabsContent>

          {/* Settings Tab */}
          <TabsContent value="settings">
            <div className="dashboard-card">
              <div className="dashboard-card__head">
                <div>
                  <h3>
                    <Settings className="h-5 w-5 text-[var(--pk-blue)]" />
                    الإعدادات
                  </h3>
                  <p>تعديل معلومات حسابك</p>
                </div>
              </div>
              <div className="dashboard-card__body space-y-6">
                {/* Phone Number */}
                <div className="space-y-3 max-w-xl">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block w-1.5 h-5 rounded-full bg-[var(--pk-blue)]" />
                    <Label className="text-base font-bold text-foreground">رقم الهاتف</Label>
                  </div>
                  <p className="text-sm text-muted-foreground -mt-1">
                    نستخدم رقم هاتفك للتواصل وإرسال تأكيدات الحجز عبر واتساب.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
                    <div className="relative flex-1">
                      <Phone className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-[var(--pk-blue)]" />
                      <Input
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        placeholder="07XXXXXXXX"
                        className="pl-10 rounded-xl h-12 border-[var(--pk-blue)]/25 focus:border-[var(--pk-blue)] focus:ring-[var(--pk-blue)]/20"
                        dir="ltr"
                        data-testid="phone-input"
                      />
                    </div>
                    <Button
                      onClick={handleSavePhone}
                      disabled={savingPhone}
                      className="rounded-full h-12 px-6 btn-playful"
                      data-testid="save-phone-btn"
                    >
                      {savingPhone ? <Loader2 className="h-4 w-4 animate-spin" /> : 'حفظ'}
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">تنسيق الأرقام الأردنية (07XXXXXXXX)</p>
                </div>

                <div className="pt-4 border-t border-[var(--pk-blue)]/10">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="inline-block w-1.5 h-5 rounded-full bg-[var(--pk-blue)]" />
                    <Label className="text-base font-bold text-foreground">الحساب</Label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span>
                      البريد: <span className="font-semibold text-foreground">{user?.email || '—'}</span>
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
