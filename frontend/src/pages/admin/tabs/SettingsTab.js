import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Button } from '../../../components/ui/button';
import { Input } from '../../../components/ui/input';
import { Label } from '../../../components/ui/label';
import { Textarea } from '../../../components/ui/textarea';
import { Badge } from '../../../components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import {
  Clock, Star, Cake, Loader2, Settings, RefreshCw, MessageSquare,
  DollarSign, FileText, Check, X, Edit, Plus,
} from 'lucide-react';
import { toast } from 'sonner';

export default function SettingsTab(props) {
  const {
    // Pricing
    pricing,
    setPricing,
    handleUpdatePricing,
    plans,
    themes,
    // Settings
    settings,
    handleUpdateSettings,
    businessHours,
    setBusinessHours,
    handleSaveBusinessHours,
    savingBusinessHours,
    slotControlDate,
    setSlotControlDate,
    slotControlType,
    setSlotControlType,
    slotControls,
    loadingSlotControls,
    updatingSlotId,
    handleToggleSlotAvailability,
    fetchSlotControls,
    passwordForm,
    setPasswordForm,
    handleChangeAdminPassword,
    changingPassword,
    // WhatsApp
    autoReplyConfig,
    setAutoReplyConfig,
    saveWhatsAppAutoReplyConfig,
    savingAutoReply,
    api,
    unreadInboxCount,
    // Bot data
    playPricing,
    setPlayPricing,
    handleUpdatePlayPricing,
    savingPlayPricing,
    businessInfo,
    setBusinessInfo,
    handleUpdateBusinessInfo,
    savingBusinessInfo,
    daycarePackages,
    editingDaycarePackage,
    setEditingDaycarePackage,
    handleSaveDaycarePackage,
    savingDaycarePackage,
    newDaycarePackage,
    setNewDaycarePackage,
    handleAddDaycarePackage,
    addingDaycarePackage,
    birthdayPackages,
    editingBirthdayPackage,
    setEditingBirthdayPackage,
    handleSaveBirthdayPackage,
    savingBirthdayPackage,
    newBirthdayPackage,
    setNewBirthdayPackage,
    handleAddBirthdayPackage,
    addingBirthdayPackage,
  } = props;

  const navigate = useNavigate();
  const [subTab, setSubTab] = useState('pricing');

  const subTabs = [
    { key: 'pricing', label: 'الأسعار' },
    { key: 'settings', label: 'الإعدادات' },
    { key: 'templates', label: 'القوالب' },
    { key: 'quick_replies', label: 'الردود السريعة' },
    { key: 'whatsapp', label: 'واتساب' },
    { key: 'bot_data', label: 'بيانات البوت' },
  ];

  return (
    <div>
      {/* Sub-tab navigation */}
      <div className="flex flex-wrap gap-2 mb-6 border-b pb-3">
        {subTabs.map(({ key, label }) => (
          <button
            key={key}
            className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${subTab === key ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-muted/70'}`}
            onClick={() => setSubTab(key)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Pricing */}
      {subTab === 'pricing' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="font-heading text-2xl">إدارة الأسعار / Pricing Management</CardTitle>
            <CardDescription>
              تحكم كامل في أسعار التذاكر، الاشتراكات، وثيمات الحفلات
              <br />
              Full control over hourly tickets, subscriptions, and birthday theme prices
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-8">
            <div>
              <h3 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
                <Clock className="h-5 w-5 text-primary" />
                أسعار التذاكر بالساعة / Hourly Ticket Pricing
              </h3>
              <form onSubmit={handleUpdatePricing} className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <div>
                    <Label htmlFor="hourly_1hr">ساعة واحدة / 1 Hour (JD)</Label>
                    <Input
                      id="hourly_1hr"
                      type="number"
                      step="0.01"
                      value={pricing.hourly_1hr}
                      onChange={(e) => setPricing({ ...pricing, hourly_1hr: parseFloat(e.target.value) })}
                      className="rounded-xl mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="hourly_2hr">ساعتان / 2 Hours (JD) ⭐</Label>
                    <Input
                      id="hourly_2hr"
                      type="number"
                      step="0.01"
                      value={pricing.hourly_2hr}
                      onChange={(e) => setPricing({ ...pricing, hourly_2hr: parseFloat(e.target.value) })}
                      className="rounded-xl mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="hourly_3hr">3 ساعات / 3 Hours (JD)</Label>
                    <Input
                      id="hourly_3hr"
                      type="number"
                      step="0.01"
                      value={pricing.hourly_3hr}
                      onChange={(e) => setPricing({ ...pricing, hourly_3hr: parseFloat(e.target.value) })}
                      className="rounded-xl mt-1"
                    />
                  </div>
                  <div>
                    <Label htmlFor="hourly_extra_hr">ساعة إضافية / Extra Hour (JD)</Label>
                    <Input
                      id="hourly_extra_hr"
                      type="number"
                      step="0.01"
                      value={pricing.hourly_extra_hr}
                      onChange={(e) => setPricing({ ...pricing, hourly_extra_hr: parseFloat(e.target.value) })}
                      className="rounded-xl mt-1"
                    />
                  </div>
                </div>
                <Button type="submit" className="rounded-full px-8">
                  حفظ الأسعار / Save Pricing
                </Button>
              </form>
            </div>

            <div>
              <h3 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
                <Star className="h-5 w-5 text-secondary" />
                باقات الاشتراكات / Subscription Plans
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {plans.map((plan) => (
                  <Card key={plan.id} className="rounded-xl">
                    <CardContent className="p-4">
                      <h4 className="font-heading font-bold text-lg">{plan.name_ar || plan.name}</h4>
                      <p className="text-sm text-muted-foreground mb-2">{plan.description_ar || plan.description}</p>
                      <div className="flex justify-between items-center">
                        <Badge variant="secondary">{plan.visits} زيارة / visits</Badge>
                        <span className="font-bold text-primary text-lg">{plan.price} دينار</span>
                      </div>
                      {plan.is_daily_pass && (
                        <Badge className="mt-2 bg-purple-100 text-purple-700">باقة يومية / Daily Pass</Badge>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                يمكن تعديل الباقات من تبويب "Subscriptions"
                <br />
                Edit subscription plans in the "Subscriptions" tab
              </p>
            </div>

            <div>
              <h3 className="font-heading text-xl font-bold mb-4 flex items-center gap-2">
                <Cake className="h-5 w-5 text-pink-500" />
                ثيمات حفلات الأعياد / Birthday Themes
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {themes.slice(0, 6).map((theme) => (
                  <Card key={theme.id} className="rounded-xl">
                    <CardContent className="p-4">
                      <h4 className="font-heading font-bold">{theme.name_ar || theme.name}</h4>
                      <p className="text-sm text-muted-foreground line-clamp-1">{theme.description_ar || theme.description}</p>
                      <p className="text-primary font-bold mt-2">{theme.price} دينار / JD</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <p className="text-sm text-muted-foreground mt-4">
                يمكن تعديل الثيمات وأسعارها من تبويب "Themes"
                <br />
                Edit themes and prices in the "Themes" tab
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* General Settings */}
      {subTab === 'settings' && (
        <Card className="rounded-2xl">
          <CardHeader className="pb-2">
            <CardTitle className="text-xl">إعدادات الأسعار والسعة / Pricing & Capacity Settings</CardTitle>
            <p className="text-sm text-muted-foreground mt-1">إعدادات الأسعار والسعة والجداول</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <Label>سعر التذكرة بالساعة (JD)</Label>
                <Input
                  type="number"
                  step="0.01"
                  defaultValue={settings.hourly_price || 10}
                  onBlur={(e) => handleUpdateSettings('hourly_price', parseFloat(e.target.value))}
                  className="rounded-xl mt-2"
                />
              </div>
              <div>
                <Label>السعة الافتراضية</Label>
                <Input
                  type="number"
                  defaultValue={settings.hourly_capacity || 25}
                  onBlur={(e) => handleUpdateSettings('hourly_capacity', parseInt(e.target.value))}
                  className="rounded-xl mt-2"
                />
              </div>
              <div>
                <Label>Birthday Slot Capacity</Label>
                <Input
                  type="number"
                  defaultValue={settings.birthday_capacity || 1}
                  onBlur={(e) => handleUpdateSettings('birthday_capacity', parseInt(e.target.value))}
                  className="rounded-xl mt-2"
                />
              </div>
              <div className="md:col-span-2">
                <Label>وصف الفوتر (قابل للتعديل في الموقع)</Label>
                <Input
                  type="text"
                  defaultValue={settings.footer_description || 'أفضل ملعب داخلي للأطفال في إربد. احجز جلسات اللعب وحفلات أعياد الميلاد!'}
                  onBlur={(e) => handleUpdateSettings('footer_description', e.target.value.trim())}
                  className="rounded-xl mt-2"
                />
              </div>
              <div>
                <Label>ارتفاع شعار الفوتر (بكسل)</Label>
                <Input
                  type="number"
                  min={80}
                  max={220}
                  defaultValue={settings.footer_logo_height || 112}
                  onBlur={(e) => handleUpdateSettings('footer_logo_height', parseInt(e.target.value))}
                  className="rounded-xl mt-2"
                />
              </div>
            </div>

            <div className="border-t pt-6 space-y-4">
              <h3 className="font-semibold">إدارة ساعات العمل</h3>
              <form onSubmit={handleSaveBusinessHours} className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                <div>
                  <Label>وقت الفتح</Label>
                  <Input
                    type="time"
                    value={businessHours.opening_time}
                    onChange={(e) => setBusinessHours((prev) => ({ ...prev, opening_time: e.target.value }))}
                    className="rounded-xl mt-2"
                  />
                </div>
                <div>
                  <Label>وقت الإغلاق</Label>
                  <Input
                    type="time"
                    value={businessHours.closing_time}
                    onChange={(e) => setBusinessHours((prev) => ({ ...prev, closing_time: e.target.value }))}
                    className="rounded-xl mt-2"
                  />
                </div>
                <div>
                  <Button type="submit" className="rounded-full w-full" disabled={savingBusinessHours}>
                    {savingBusinessHours ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                    حفظ ساعات العمل
                  </Button>
                </div>
              </form>
            </div>

            <div className="border-t pt-6 space-y-4">
              <h3 className="font-semibold">إدارة توفر الأوقات</h3>
              <p className="text-sm text-muted-foreground">
                اختر التاريخ ونوع الحجز ثم فعّل/أوقف كل موعد مباشرة من لوحة التحكم.
              </p>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>التاريخ</Label>
                  <Input
                    type="date"
                    value={slotControlDate}
                    onChange={(e) => setSlotControlDate(e.target.value)}
                    className="rounded-xl mt-2"
                  />
                </div>
                <div>
                  <Label>نوع الموعد</Label>
                  <Select value={slotControlType} onValueChange={setSlotControlType}>
                    <SelectTrigger className="rounded-xl mt-2">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="hourly">بالساعة</SelectItem>
                      <SelectItem value="birthday">عيد ميلاد</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="md:col-span-2 flex items-end">
                  <Button
                    type="button"
                    className="rounded-full w-full"
                    onClick={() => fetchSlotControls(slotControlDate, slotControlType)}
                    disabled={loadingSlotControls}
                  >
                    {loadingSlotControls ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                    تحميل الأوقات
                  </Button>
                </div>
              </div>

              <div className="border rounded-2xl overflow-hidden">
                <div className="grid grid-cols-3 bg-muted/40 px-4 py-2 text-sm font-medium">
                  <span>الوقت</span>
                  <span className="text-center">السعة</span>
                  <span className="text-left md:text-right">الحالة</span>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y">
                  {slotControls.length === 0 ? (
                    <div className="px-4 py-6 text-sm text-muted-foreground">لا توجد أوقات لهذا اليوم.</div>
                  ) : slotControls.map((slot) => (
                    <div key={slot.id} className="grid grid-cols-3 items-center px-4 py-3 text-sm">
                      <span className="font-medium">{slot.start_time}</span>
                      <span className="text-center">{slot.capacity}</span>
                      <div className="flex justify-start md:justify-end">
                        <Button
                          type="button"
                          size="sm"
                          variant={slot.is_active ? 'default' : 'outline'}
                          disabled={updatingSlotId === slot.id}
                          onClick={() => handleToggleSlotAvailability(slot, !slot.is_active)}
                          className="rounded-full"
                        >
                          {updatingSlotId === slot.id ? <Loader2 className="h-4 w-4 animate-spin" /> : (slot.is_active ? 'متاح' : 'غير متاح')}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="border-t pt-6">
              <h3 className="font-semibold mb-3">تغيير كلمة مرور المدير</h3>
              <form onSubmit={handleChangeAdminPassword} className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="md:col-span-2">
                  <Label>كلمة المرور الحالية</Label>
                  <Input
                    type="password"
                    value={passwordForm.current_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, current_password: e.target.value })}
                    className="rounded-xl mt-2"
                    required
                  />
                </div>
                <div>
                  <Label>كلمة المرور الجديدة</Label>
                  <Input
                    type="password"
                    value={passwordForm.new_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, new_password: e.target.value })}
                    className="rounded-xl mt-2"
                    required
                    minLength={8}
                  />
                </div>
                <div>
                  <Label>تأكيد كلمة المرور الجديدة</Label>
                  <Input
                    type="password"
                    value={passwordForm.confirm_password}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirm_password: e.target.value })}
                    className="rounded-xl mt-2"
                    required
                    minLength={8}
                  />
                </div>
                <div className="md:col-span-2">
                  <Button type="submit" className="rounded-full" disabled={changingPassword}>
                    {changingPassword ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                    حفظ كلمة المرور الجديدة
                  </Button>
                </div>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Templates */}
      {subTab === 'templates' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-[#66A9E9]" /> قوالب واتساب
            </CardTitle>
            <CardDescription>القوالب المعتمدة من Meta لإرسال الحملات</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              onClick={async () => {
                try {
                  const res = await api.post('/templates/sync');
                  toast.success(`تم المزامنة · ${res.data.synced_count} قالب`);
                } catch (e) {
                  toast.error(e?.response?.data?.error || 'فشل المزامنة');
                }
              }}
              className="rounded-full gap-2 mb-4"
            >
              <RefreshCw className="h-4 w-4" /> مزامنة القوالب من Meta
            </Button>
            <p className="text-sm text-muted-foreground">بعد المزامنة ستظهر القوالب هنا. يمكنك استخدامها في الحملات.</p>
          </CardContent>
        </Card>
      )}

      {/* Quick Replies */}
      {subTab === 'quick_replies' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5 text-[#66A9E9]" /> إدارة الردود السريعة
            </CardTitle>
            <CardDescription>الردود السريعة المستخدمة في صندوق الوارد</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground mb-4">يمكن إدارة الردود السريعة مباشرة من صندوق الوارد عند فتح أي محادثة.</p>
            <Button onClick={() => navigate('/staff?tab=inbox')} className="rounded-full gap-2 relative">
              <MessageSquare className="h-4 w-4" /> فتح صندوق الوارد
              {unreadInboxCount > 0 && (
                <Badge className="bg-red-500 text-white min-w-6 h-6 rounded-full px-1.5">
                  {unreadInboxCount > 99 ? '99+' : unreadInboxCount}
                </Badge>
              )}
            </Button>
          </CardContent>
        </Card>
      )}

      {/* WhatsApp Settings */}
      {subTab === 'whatsapp' && (
        <Card className="rounded-2xl">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5 text-[#66A9E9]" /> إعدادات واتساب
            </CardTitle>
            <CardDescription>إدارة إعدادات حساب واتساب للأعمال</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-xl bg-muted/50 space-y-2">
              <p className="text-sm font-semibold">رقم الهاتف</p>
              <p className="text-sm text-muted-foreground">+962 7 7777 5652 · PEEKABOO-Jordan</p>
              <p className="text-xs text-muted-foreground">Phone Number ID: 1070295776173680</p>
              <p className="text-xs text-muted-foreground">WABA ID: 1176705417481897</p>
            </div>
            <div className="p-4 rounded-xl bg-blue-50 border border-blue-100">
              <p className="text-sm font-semibold text-blue-800 mb-1">مزامنة القوالب</p>
              <p className="text-xs text-blue-600 mb-3">اسحب القوالب المعتمدة من Meta إلى قاعدة البيانات لاستخدامها في الحملات</p>
              <Button
                size="sm"
                onClick={async () => {
                  try {
                    const res = await api.post('/templates/sync');
                    toast.success(`تم المزامنة · ${res.data.synced_count} قالب`);
                  } catch (e) {
                    toast.error(e?.response?.data?.error || 'فشل المزامنة');
                  }
                }}
                className="rounded-full gap-2"
              >
                <RefreshCw className="h-4 w-4" /> مزامنة القوالب
              </Button>
            </div>

            <div className="p-4 rounded-xl bg-green-50 border border-green-200 space-y-3">
              <p className="text-sm font-semibold text-green-800 mb-1">الرد الذكي التلقائي (Gemini)</p>
              <p className="text-xs text-green-700">يتم الرد على رسائل العملاء تلقائيًا بواسطة Gemini كمساعد بشري. الردود الجاهزة تظهر فقط كحماية احتياطية إذا تعذّر Gemini أو في حالات السلامة (شكاوى، إيقاف الاشتراك، تحويل لموظف).</p>

              <div className="flex items-center justify-between gap-3">
                <Label className="text-sm">تفعيل الرد الذكي</Label>
                <Button
                  size="sm"
                  variant={autoReplyConfig.enabled ? 'default' : 'outline'}
                  onClick={() => setAutoReplyConfig(prev => ({ ...prev, enabled: !prev.enabled }))}
                  className="rounded-full"
                >
                  {autoReplyConfig.enabled ? 'مفعل' : 'غير مفعل'}
                </Button>
              </div>

              <div>
                <Label className="text-sm">مدة الانتظار بين الردود (دقائق)</Label>
                <Input
                  type="number"
                  min={1}
                  value={autoReplyConfig.cooldownMinutes}
                  onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, cooldownMinutes: e.target.value }))}
                  className="rounded-xl mt-1 bg-white"
                />
                <p className="text-[11px] text-green-700/80 mt-1">تطبّق فقط بين ردّين متتاليين لنفس العميل. إذا أرسل رسالة جديدة بعد ردّنا، سيتم الرد عليها مباشرة دون انتظار.</p>
              </div>

              <div>
                <Label className="text-sm">نص بديل (يُستخدم فقط إذا فشل Gemini)</Label>
                <Textarea
                  value={autoReplyConfig.fallbackReply || ''}
                  onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, fallbackReply: e.target.value }))}
                  className="rounded-xl mt-1 bg-white"
                  rows={3}
                />
                <p className="text-[11px] text-green-700/80 mt-1">لن يراه العميل في الحالات الطبيعية — Gemini هو المرسل الأساسي.</p>
              </div>

              <details className="rounded-xl bg-white/60 border border-green-100 p-3">
                <summary className="text-xs text-green-800 cursor-pointer select-none">إعدادات Gemini المتقدمة</summary>
                <div className="space-y-3 mt-3">
                  <div>
                    <Label className="text-sm">حد ثقة Gemini (0 إلى 1)</Label>
                    <Input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={autoReplyConfig.aiConfidenceThreshold ?? 0.7}
                      onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, aiConfidenceThreshold: e.target.value }))}
                      className="rounded-xl mt-1 bg-white"
                    />
                  </div>
                  <div>
                    <Label className="text-sm">الحد الأقصى لحروف رد Gemini</Label>
                    <Input
                      type="number"
                      min={50}
                      value={autoReplyConfig.aiMaxReplyChars ?? 500}
                      onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, aiMaxReplyChars: e.target.value }))}
                      className="rounded-xl mt-1 bg-white"
                    />
                  </div>
                </div>
              </details>

              <Button
                size="sm"
                onClick={saveWhatsAppAutoReplyConfig}
                disabled={savingAutoReply}
                className="rounded-full gap-2 bg-green-600 hover:bg-green-700"
              >
                {savingAutoReply ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                حفظ إعدادات الرد الذكي
              </Button>
            </div>

            <div className="p-4 rounded-xl bg-yellow-50 border border-yellow-100">
              <p className="text-sm font-semibold text-yellow-800 mb-1">حالة الحساب</p>
              <p className="text-xs text-yellow-700">Display Name: Pending Review · تأكد من إكمال مراجعة الاسم في Meta Business Manager</p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bot Data */}
      {subTab === 'bot_data' && (
        <div className="space-y-6">
          {/* Play Pricing */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[#66A9E9]" /> أسعار اللعب (للبوت)
              </CardTitle>
              <CardDescription>تحديث أسعار اللعب التي يعرضها البوت تلقائياً</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdatePlayPricing} className="space-y-3">
                {[
                  { key: 'hourly_1hr', label: 'ساعة واحدة (د.أ)' },
                  { key: 'hourly_2hr', label: 'ساعتان (د.أ)' },
                  { key: 'hourly_3hr', label: '3 ساعات (د.أ)' },
                  { key: 'hourly_extra_hr', label: 'ساعة إضافية (د.أ)' },
                  { key: 'extra_companion', label: 'مرافق إضافي (د.أ)' },
                  { key: 'sand_area_addon', label: 'منطقة الرمل - إضافة (د.أ)' },
                  { key: 'transport_one_way', label: 'التوصيل - اتجاه واحد (د.أ)' }
                ].map(({ key, label }) => (
                  <div key={key} className="flex items-center gap-3">
                    <Label className="w-48 text-sm shrink-0">{label}</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0"
                      value={playPricing[key] || ''}
                      onChange={e => setPlayPricing(prev => ({ ...prev, [key]: e.target.value }))}
                      className="rounded-xl bg-white max-w-[120px]"
                    />
                  </div>
                ))}
                <Button type="submit" disabled={savingPlayPricing} size="sm" className="rounded-full gap-2 mt-2">
                  {savingPlayPricing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حفظ أسعار اللعب
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Business Info */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Settings className="h-5 w-5 text-[#66A9E9]" /> معلومات العمل (للبوت)
              </CardTitle>
              <CardDescription>ساعات العمل والموقع الجغرافي الظاهران في ردود البوت</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleUpdateBusinessInfo} className="space-y-3">
                <div>
                  <Label className="text-sm">ساعات العمل (واتساب)</Label>
                  <Input
                    value={businessInfo.whatsapp_hours}
                    onChange={e => setBusinessInfo(prev => ({ ...prev, whatsapp_hours: e.target.value }))}
                    className="rounded-xl mt-1 bg-white"
                    placeholder="الأحد-الخميس: 10ص-11م، الجمعة-السبت: 10ص-12ص"
                  />
                </div>
                <div>
                  <Label className="text-sm">الموقع الجغرافي (واتساب)</Label>
                  <Input
                    value={businessInfo.whatsapp_location}
                    onChange={e => setBusinessInfo(prev => ({ ...prev, whatsapp_location: e.target.value }))}
                    className="rounded-xl mt-1 bg-white"
                    placeholder="إربد - شارع أبو راشد، مجمع السيف التجاري، الطابق الثاني"
                  />
                </div>
                <Button type="submit" disabled={savingBusinessInfo} size="sm" className="rounded-full gap-2 mt-2">
                  {savingBusinessInfo ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  حفظ معلومات العمل
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Daycare Packages */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Star className="h-5 w-5 text-[#66A9E9]" /> باقات الداي كير
              </CardTitle>
              <CardDescription>إدارة باقات الرعاية النهارية الظاهرة في البوت</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {daycarePackages.map(pkg => (
                <div key={pkg.id || pkg._id} className="p-3 rounded-xl border bg-white space-y-2">
                  {editingDaycarePackage && (editingDaycarePackage.id || editingDaycarePackage._id) === (pkg.id || pkg._id) ? (
                    <div className="space-y-2">
                      <Input value={editingDaycarePackage.name_ar || ''} onChange={e => setEditingDaycarePackage(prev => ({ ...prev, name_ar: e.target.value }))} placeholder="الاسم بالعربي" className="rounded-xl bg-white text-sm" />
                      <Input value={editingDaycarePackage.name || ''} onChange={e => setEditingDaycarePackage(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (English)" className="rounded-xl bg-white text-sm" />
                      <div className="flex gap-2">
                        <Input type="number" value={editingDaycarePackage.price || ''} onChange={e => setEditingDaycarePackage(prev => ({ ...prev, price: e.target.value }))} placeholder="السعر (د.أ)" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={editingDaycarePackage.duration_hours || ''} onChange={e => setEditingDaycarePackage(prev => ({ ...prev, duration_hours: e.target.value }))} placeholder="المدة (ساعات)" className="rounded-xl bg-white text-sm" />
                      </div>
                      <Input value={Array.isArray(editingDaycarePackage.time_slots) ? editingDaycarePackage.time_slots.join(', ') : ''} onChange={e => setEditingDaycarePackage(prev => ({ ...prev, time_slots: e.target.value.split(',').map(s => s.trim()) }))} placeholder="أوقات متاحة (افصل بفاصلة)" className="rounded-xl bg-white text-sm" />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveDaycarePackage(editingDaycarePackage)} disabled={savingDaycarePackage} className="rounded-full gap-1">
                          {savingDaycarePackage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} حفظ
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingDaycarePackage(null)} className="rounded-full gap-1">
                          <X className="h-3 w-3" /> إلغاء
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{pkg.name_ar || pkg.name}</p>
                        <p className="text-xs text-muted-foreground">{pkg.price} د.أ · {pkg.duration_hours || 0} ساعة{pkg.time_slots?.length ? ` · ${pkg.time_slots.join(', ')}` : ''}</p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setEditingDaycarePackage({ ...pkg })} className="rounded-full">
                        <Edit className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              <form onSubmit={handleAddDaycarePackage} className="p-3 rounded-xl border border-dashed bg-muted/30 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">إضافة باقة جديدة</p>
                <Input value={newDaycarePackage.name_ar} onChange={e => setNewDaycarePackage(prev => ({ ...prev, name_ar: e.target.value }))} placeholder="الاسم بالعربي *" className="rounded-xl bg-white text-sm" required />
                <Input value={newDaycarePackage.name} onChange={e => setNewDaycarePackage(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (English) *" className="rounded-xl bg-white text-sm" required />
                <div className="flex gap-2">
                  <Input type="number" value={newDaycarePackage.price} onChange={e => setNewDaycarePackage(prev => ({ ...prev, price: e.target.value }))} placeholder="السعر (د.أ) *" className="rounded-xl bg-white text-sm" required />
                  <Input type="number" value={newDaycarePackage.duration_hours} onChange={e => setNewDaycarePackage(prev => ({ ...prev, duration_hours: e.target.value }))} placeholder="المدة (ساعات)" className="rounded-xl bg-white text-sm" />
                </div>
                <Input value={newDaycarePackage.time_slots} onChange={e => setNewDaycarePackage(prev => ({ ...prev, time_slots: e.target.value }))} placeholder="أوقات متاحة (افصل بفاصلة)" className="rounded-xl bg-white text-sm" />
                <Button type="submit" size="sm" disabled={addingDaycarePackage} className="rounded-full gap-1">
                  {addingDaycarePackage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} إضافة
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Birthday Packages */}
          <Card className="rounded-2xl">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cake className="h-5 w-5 text-[#66A9E9]" /> باقات أعياد الميلاد
              </CardTitle>
              <CardDescription>إدارة باقات الحفلات الظاهرة في البوت</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {birthdayPackages.map(pkg => (
                <div key={pkg.id || pkg._id} className="p-3 rounded-xl border bg-white space-y-2">
                  {editingBirthdayPackage && (editingBirthdayPackage.id || editingBirthdayPackage._id) === (pkg.id || pkg._id) ? (
                    <div className="space-y-2">
                      <Input value={editingBirthdayPackage.name_ar || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, name_ar: e.target.value }))} placeholder="الاسم بالعربي" className="rounded-xl bg-white text-sm" />
                      <Input value={editingBirthdayPackage.name || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (English)" className="rounded-xl bg-white text-sm" />
                      <Input type="number" value={editingBirthdayPackage.price || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, price: e.target.value }))} placeholder="السعر (د.أ)" className="rounded-xl bg-white text-sm" />
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="number" value={editingBirthdayPackage.kids_count || editingBirthdayPackage.includes?.kids_count || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, kids_count: e.target.value }))} placeholder="عدد الأطفال" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={editingBirthdayPackage.play_hours || editingBirthdayPackage.includes?.play_hours || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, play_hours: e.target.value }))} placeholder="ساعات اللعب" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={editingBirthdayPackage.meals || editingBirthdayPackage.includes?.meals || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, meals: e.target.value }))} placeholder="عدد الوجبات" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={editingBirthdayPackage.stands !== undefined ? editingBirthdayPackage.stands : editingBirthdayPackage.includes?.stands || ''} onChange={e => setEditingBirthdayPackage(prev => ({ ...prev, stands: e.target.value }))} placeholder="عدد الستاندات" className="rounded-xl bg-white text-sm" />
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => handleSaveBirthdayPackage(editingBirthdayPackage)} disabled={savingBirthdayPackage} className="rounded-full gap-1">
                          {savingBirthdayPackage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} حفظ
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditingBirthdayPackage(null)} className="rounded-full gap-1">
                          <X className="h-3 w-3" /> إلغاء
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-sm">{pkg.name_ar || pkg.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {pkg.price} د.أ · {pkg.includes?.kids_count || 0} طفل · {pkg.includes?.play_hours || 0} ساعة
                          {pkg.includes?.meals ? ` · ${pkg.includes.meals} وجبة` : ''}
                          {pkg.includes?.gifts_per_kid ? ' · هدايا' : ''}
                        </p>
                      </div>
                      <Button size="sm" variant="ghost" onClick={() => setEditingBirthdayPackage({ ...pkg, kids_count: pkg.includes?.kids_count, play_hours: pkg.includes?.play_hours, meals: pkg.includes?.meals, stands: pkg.includes?.stands, gifts_per_kid: pkg.includes?.gifts_per_kid, premium_gift: pkg.includes?.premium_gift })} className="rounded-full">
                        <Edit className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                </div>
              ))}

              <form onSubmit={handleAddBirthdayPackage} className="p-3 rounded-xl border border-dashed bg-muted/30 space-y-2">
                <p className="text-sm font-medium text-muted-foreground">إضافة باقة عيد ميلاد جديدة</p>
                <p className="text-xs text-foreground">
                  الحقول المطلوبة: الاسم بالعربي، الاسم بالإنجليزي، والسعر. باقي الحقول اختيارية.
                </p>
                <Input value={newBirthdayPackage.name_ar} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, name_ar: e.target.value }))} placeholder="الاسم بالعربي *" className="rounded-xl bg-white text-sm" required />
                <Input value={newBirthdayPackage.name} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (English) *" className="rounded-xl bg-white text-sm" required />
                <Input type="number" value={newBirthdayPackage.price} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, price: e.target.value }))} placeholder="السعر (د.أ) *" className="rounded-xl bg-white text-sm" required />
                <div className="grid grid-cols-2 gap-2">
                  <Input type="number" value={newBirthdayPackage.kids_count} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, kids_count: e.target.value }))} placeholder="عدد الأطفال (اختياري)" className="rounded-xl bg-white text-sm" />
                  <Input type="number" value={newBirthdayPackage.play_hours} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, play_hours: e.target.value }))} placeholder="ساعات اللعب (اختياري)" className="rounded-xl bg-white text-sm" />
                  <Input type="number" value={newBirthdayPackage.meals} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, meals: e.target.value }))} placeholder="عدد الوجبات (اختياري)" className="rounded-xl bg-white text-sm" />
                  <Input type="number" value={newBirthdayPackage.stands} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, stands: e.target.value }))} placeholder="عدد الستاندات (اختياري)" className="rounded-xl bg-white text-sm" />
                </div>
                <Button type="submit" size="sm" disabled={addingBirthdayPackage} className="rounded-full gap-1">
                  {addingBirthdayPackage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} إضافة
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
