import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Textarea } from '../components/ui/textarea';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { 
  LayoutDashboard, Users, Clock, Cake, Star, Settings, Image, 
  Plus, Edit, Trash2, Loader2, Gift, Calendar, DollarSign, Home, Upload, Search, UserPlus, Eye, Ban, Check, X, MessageSquare,
  Megaphone, FileText, Palette, RefreshCw, QrCode
} from 'lucide-react';
import mascotImg from '../assets/mascot.png';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '');
const MAX_IMAGE_UPLOAD_MB = 25;
const MAX_IMAGE_UPLOAD_BYTES = MAX_IMAGE_UPLOAD_MB * 1024 * 1024;

const getApiErrorMessage = (error, fallbackMessage) =>
  error?.response?.data?.error ||
  error?.response?.data?.message ||
  error?.message ||
  fallbackMessage;

const resolveMediaUrl = (url) => {
  if (!url) return '';
  if (/^(data:|blob:)/i.test(url)) return url;

  let normalizedUrl = String(url).trim();

  if (/^https?:\/\//i.test(normalizedUrl)) {
    try {
      const parsed = new URL(normalizedUrl);
      if (parsed.pathname.startsWith('/api/uploads/')) {
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

export default function AdminPage() {
  const { api, isAdmin, user } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [activeFilter, setActiveFilter] = useState(null); // 'today', 'active', 'custom_pending'
  const [stats, setStats] = useState({});
  const [users, setUsers] = useState([]);
  const [hourlyBookings, setHourlyBookings] = useState([]);
  const [birthdayBookings, setBirthdayBookings] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [themes, setThemes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [gallery, setGallery] = useState([]);
  const [settings, setSettings] = useState({});
  const [pricing, setPricing] = useState({
    hourly_1hr: 7,
    hourly_2hr: 10,
    hourly_3hr: 13,
    hourly_extra_hr: 3
  });
  const [autoReplyConfig, setAutoReplyConfig] = useState({
    enabled: false,
    cooldownMinutes: 30,
    footer: 'للحجز المباشر تفضلي عبر الموقع: https://peekaboojor.com/book',
    fallbackReply:
      'أهلاً وسهلاً 🌷 وصلتنا رسالتك، وفريقنا سيرد عليك بأسرع وقت. إذا حابة، ارسلي (أسعار / موقع / ساعات العمل / عيد ميلاد / اشتراك).'
  });
  const [savingAutoReply, setSavingAutoReply] = useState(false);

  // Play pricing state
  const [playPricing, setPlayPricing] = useState({
    hourly_1hr: 7, hourly_2hr: 10, hourly_3hr: 13, hourly_extra_hr: 3,
    extra_companion: 3, sand_area_addon: 20, transport_one_way: 40
  });
  const [savingPlayPricing, setSavingPlayPricing] = useState(false);

  // Business info state (WhatsApp hours & location)
  const [businessInfo, setBusinessInfo] = useState({
    whatsapp_hours: 'الأحد-الخميس: 10:00 ص - 11:00 م، الجمعة-السبت: 10:00 ص - 12:00 ص',
    whatsapp_location: 'إربد - شارع أبو راشد، مجمع السيف التجاري، الطابق الثاني'
  });
  const [savingBusinessInfo, setSavingBusinessInfo] = useState(false);
  const [businessHours, setBusinessHours] = useState({
    opening_time: '10:00',
    closing_time: '23:00'
  });
  const [savingBusinessHours, setSavingBusinessHours] = useState(false);
  const [slotControlDate, setSlotControlDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [slotControlType, setSlotControlType] = useState('hourly');
  const [slotControls, setSlotControls] = useState([]);
  const [loadingSlotControls, setLoadingSlotControls] = useState(false);
  const [updatingSlotId, setUpdatingSlotId] = useState(null);

  // Daycare packages state
  const [daycarePackages, setDaycarePackages] = useState([]);
  const [editingDaycarePackage, setEditingDaycarePackage] = useState(null);
  const [savingDaycarePackage, setSavingDaycarePackage] = useState(false);
  const [newDaycarePackage, setNewDaycarePackage] = useState({ name: '', name_ar: '', price: 0, visits: 1, duration_hours: 0, duration_minutes: 0, time_slots: '', includes: '' });
  const [addingDaycarePackage, setAddingDaycarePackage] = useState(false);

  // Birthday packages state
  const [birthdayPackages, setBirthdayPackages] = useState([]);
  const [editingBirthdayPackage, setEditingBirthdayPackage] = useState(null);
  const [savingBirthdayPackage, setSavingBirthdayPackage] = useState(false);
  const [newBirthdayPackage, setNewBirthdayPackage] = useState({ name: '', name_ar: '', price: 0, kids_count: 10, play_hours: 2, meals: 10, stands: 0, gifts_per_kid: false, premium_gift: false });
  const [addingBirthdayPackage, setAddingBirthdayPackage] = useState(false);
  const [expandedParent, setExpandedParent] = useState(null);
  const [parentDetails, setParentDetails] = useState(null);
  const [loadingParent, setLoadingParent] = useState(false);
  const [nowMs, setNowMs] = useState(Date.now());
  const [activatingBookingId, setActivatingBookingId] = useState(null);
  const [loadedDataByTab, setLoadedDataByTab] = useState({
    dashboard: false,
    users: false,
    customers: false,
    hourly: false,
    birthday: false,
    subscriptions: false,
    products: false,
    templates: false,
    gallery: false,
    settings: false,
    pricing: false,
    whatsapp_settings: false,
    play_pricing: false,
    business_info: false,
    daycare_packages: false,
    birthday_packages: false
  });

  // Hero settings state
  const [heroSettings, setHeroSettings] = useState({
    hero_title: 'حيث يلعب الأطفال ويحتفلون 🎈',
    hero_subtitle: 'أفضل تجربة ملعب داخلي! احجز جلسات اللعب، أقم حفلات أعياد ميلاد لا تُنسى، ووفّر مع باقات الاشتراك',
    hero_cta_text: 'احجز جلسة',
    hero_cta_route: '/tickets',
    hero_image: ''
  });
  const [heroImagePreview, setHeroImagePreview] = useState(null);
  const [heroPreviewObjectUrl, setHeroPreviewObjectUrl] = useState(null);
  const [savingHero, setSavingHero] = useState(false);

  // Dialog states
  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [adjustPointsDialogOpen, setAdjustPointsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
  const [editingTheme, setEditingTheme] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [galleryPreview, setGalleryPreview] = useState(null);

  // Form states
  const [newTheme, setNewTheme] = useState({ name: '', name_ar: '', description: '', description_ar: '', price: '', image_url: '' });
  const [newPlan, setNewPlan] = useState({ name: '', name_ar: '', description: '', description_ar: '', visits: '', price: '' });
  const [newMedia, setNewMedia] = useState({ url: '', type: 'photo', title: '', file: null });
  const [pointsAdjustment, setPointsAdjustment] = useState({ points: 0, description: '' });

  // Customers state
  const [customers, setCustomers] = useState([]);
  const [customerSearch, setCustomerSearch] = useState('');
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [customerDetails, setCustomerDetails] = useState(null);
  const [products, setProducts] = useState([]);
  const [productForm, setProductForm] = useState({ nameAr: '', nameEn: '', sku: '', priceJD: '', imageUrl: '', active: true, stockQty: '' });
  const [customerDialogOpen, setCustomerDialogOpen] = useState(false);
  const [customerDetailsOpen, setCustomerDetailsOpen] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ name: '', email: '', phone: '' });
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [newChild, setNewChild] = useState({ name: '', birthday: '' });
  const [editingChild, setEditingChild] = useState(null);
  const [savingCustomer, setSavingCustomer] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [passwordForm, setPasswordForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });

  useEffect(() => {
    setLoading(false);
  }, []);

  useEffect(() => {
    return () => {
      if (heroPreviewObjectUrl) {
        URL.revokeObjectURL(heroPreviewObjectUrl);
      }
    };
  }, [heroPreviewObjectUrl]);

  useEffect(() => {
    if (isAdmin) {
      fetchDashboard();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  useEffect(() => {
    const hasActiveSession = hourlyBookings.some((booking) => booking.status === 'checked_in');
    if (activeTab !== 'hourly' || !hasActiveSession) {
      return undefined;
    }
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, [activeTab, hourlyBookings]);

  // Debounced search for customers
  useEffect(() => {
    if (activeTab !== 'customers') return;
    const timer = setTimeout(() => {
      fetchCustomers(customerSearch);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch, activeTab]);

  // Show 403 page if not admin
  if (!isAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Card className="max-w-md w-full border-2 rounded-3xl shadow-xl">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-4">
              <div className="h-20 w-20 rounded-full bg-red-100 flex items-center justify-center">
                <span className="text-4xl">🚫</span>
              </div>
            </div>
            <CardTitle className="text-2xl font-bold text-red-600">403 - Not Authorized</CardTitle>
            <CardDescription className="text-base mt-2">
              You do not have permission to access the admin panel.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm">
              <p className="font-semibold mb-2">Debug Info:</p>
              <p>Email: {user?.email || 'Not logged in'}</p>
              <p>Role: <span className="font-bold text-red-600">{user?.role || 'None'}</span></p>
              <p className="mt-2 text-xs text-muted-foreground">
                Required role: <span className="font-bold">admin</span>
              </p>
            </div>
            <div className="flex gap-3">
              <Button onClick={() => navigate('/')} variant="outline" className="flex-1 rounded-full">
                Go Home
              </Button>
              <Button onClick={() => navigate('/profile')} className="flex-1 rounded-full">
                My Profile
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const formatCurrency = (value) => {
    const safeValue = Number(value || 0);
    return `${safeValue.toLocaleString('en-US', { maximumFractionDigits: 2 })} JD`;
  };
  const sortByReceivedDate = (items = []) => [...items].sort((a, b) => {
    const aTime = new Date(a?.created_at || 0).getTime();
    const bTime = new Date(b?.created_at || 0).getTime();
    if (bTime !== aTime) return bTime - aTime;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });

  const fetchDashboard = async () => {
    setLoading(true);
    try {
      const [dashRes, settingsRes] = await Promise.all([
        api.get('/admin/dashboard'),
        api.get('/admin/settings'),
      ]);

      setStats(dashRes.data.stats || {});
      setSettings(settingsRes.data.settings || {});
      setLoadedDataByTab((prev) => ({ ...prev, dashboard: true }));
      
      // Load hero settings from settings
      const s = settingsRes.data.settings || {};
      if (s.hero_title || s.hero_subtitle || s.hero_image) {
        setHeroSettings({
          hero_title: s.hero_title || heroSettings.hero_title,
          hero_subtitle: s.hero_subtitle || heroSettings.hero_subtitle,
          hero_cta_text: s.hero_cta_text || heroSettings.hero_cta_text,
          hero_cta_route: s.hero_cta_route || heroSettings.hero_cta_route,
          hero_image: s.hero_image || ''
        });
      }
    } catch (error) {
      console.error('Failed to fetch admin data:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchUsers = async () => {
    try {
      const response = await api.get('/admin/users?role=parent');
      setUsers(response.data.users || []);
    } catch (error) {
      console.error('Failed to fetch users:', error);
    }
  };

  const fetchHourlyBookings = async () => {
    try {
      const response = await api.get('/admin/bookings/hourly');
      setHourlyBookings(sortByReceivedDate(response.data.bookings || []));
    } catch (error) {
      console.error('Failed to fetch hourly bookings:', error);
    }
  };

  const fetchBirthdayBookings = async () => {
    try {
      const response = await api.get('/admin/bookings/birthday');
      setBirthdayBookings(sortByReceivedDate(response.data.bookings || []));
    } catch (error) {
      console.error('Failed to fetch birthday bookings:', error);
    }
  };

  const fetchSubscriptions = async () => {
    try {
      const response = await api.get('/admin/subscriptions');
      setSubscriptions(sortByReceivedDate(response.data.subscriptions || []));
    } catch (error) {
      console.error('Failed to fetch subscriptions:', error);
    }
  };

  const refreshDashboardStats = async () => {
    try {
      const dashRes = await api.get('/admin/dashboard');
      setStats(dashRes.data.stats || {});
    } catch (error) {
      console.error('Failed to refresh admin stats:', error);
    }
  };

  const refreshTemplatesData = async () => {
    try {
      const [themesRes, plansRes] = await Promise.all([api.get('/themes'), api.get('/admin/plans')]);
      setThemes(themesRes.data.themes || []);
      setPlans(plansRes.data.plans || []);
      setLoadedDataByTab((prev) => ({ ...prev, templates: true }));
    } catch (error) {
      toast.error('فشل تحميل القوالب');
    }
  };

  const refreshGalleryData = async () => {
    try {
      const galleryRes = await api.get('/gallery');
      setGallery(galleryRes.data.media || []);
      setLoadedDataByTab((prev) => ({ ...prev, gallery: true }));
    } catch (error) {
      toast.error('فشل تحميل المعرض');
    }
  };


  const fetchWhatsAppAutoReplyConfig = async () => {
    try {
      const response = await api.get('/admin/whatsapp-auto-reply');
      setAutoReplyConfig(response.data.config || autoReplyConfig);
    } catch (error) {
      console.error('Failed to fetch WhatsApp auto-reply config:', error);
      toast.error('فشل تحميل إعدادات الرد الذكي');
    }
  };

  const saveWhatsAppAutoReplyConfig = async () => {
    setSavingAutoReply(true);
    try {
      const payload = {
        ...autoReplyConfig,
        cooldownMinutes: Number(autoReplyConfig.cooldownMinutes || 30)
      };
      const response = await api.put('/admin/whatsapp-auto-reply', payload);
      setAutoReplyConfig(response.data.config || payload);
      toast.success('تم حفظ إعدادات الرد الذكي');
    } catch (error) {
      console.error('Failed to save WhatsApp auto-reply config:', error);
      toast.error(error.response?.data?.error || 'فشل حفظ إعدادات الرد الذكي');
    } finally {
      setSavingAutoReply(false);
    }
  };

  // ==================== CUSTOMERS FUNCTIONS ====================
  const fetchCustomers = async (search = '') => {
    setLoadingCustomers(true);
    try {
      const response = await api.get(`/admin/customers?search=${encodeURIComponent(search)}`);
      setCustomers(response.data.customers || []);
    } catch (error) {
      console.error('Failed to fetch customers:', error);
      toast.error('فشل تحميل العملاء');
    } finally {
      setLoadingCustomers(false);
    }
  };

  const fetchCustomerDetails = async (customerId) => {
    try {
      const response = await api.get(`/admin/customers/${customerId}`);
      setCustomerDetails(response.data);
      setEditingCustomer({
        name: response.data.customer.name,
        email: response.data.customer.email,
        phone: response.data.customer.phone || ''
      });
      setCustomerDetailsOpen(true);
    } catch (error) {
      console.error('Failed to fetch customer details:', error);
      toast.error('فشل تحميل بيانات العميل');
    }
  };

  const handleCreateCustomer = async (e) => {
    e.preventDefault();
    setSavingCustomer(true);
    try {
      await api.post('/admin/customers', newCustomer);
      toast.success('تم إضافة العميل بنجاح');
      setCustomerDialogOpen(false);
      setNewCustomer({ name: '', email: '', phone: '' });
      fetchCustomers(customerSearch);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إضافة العميل');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleUpdateCustomer = async () => {
    if (!customerDetails?.customer?.id) return;
    setSavingCustomer(true);
    try {
      await api.put(`/admin/customers/${customerDetails.customer.id}`, editingCustomer);
      toast.success('تم تحديث بيانات العميل');
      fetchCustomers(customerSearch);
      // Refresh details
      fetchCustomerDetails(customerDetails.customer.id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تحديث بيانات العميل');
    } finally {
      setSavingCustomer(false);
    }
  };

  const handleToggleCustomerStatus = async (customerId) => {
    try {
      const response = await api.patch(`/admin/customers/${customerId}/disable`);
      toast.success(response.data.message === 'Customer disabled' ? 'تم تعطيل العميل' : 'تم تفعيل العميل');
      fetchCustomers(customerSearch);
      if (customerDetails?.customer?.id === customerId) {
        fetchCustomerDetails(customerId);
      }
    } catch (error) {
      toast.error('فشل تغيير حالة العميل');
    }
  };

  const handleAddChild = async (e) => {
    e.preventDefault();
    if (!customerDetails?.customer?.id) return;
    try {
      await api.post(`/admin/customers/${customerDetails.customer.id}/children`, newChild);
      toast.success('تم إضافة الطفل');
      setNewChild({ name: '', birthday: '' });
      fetchCustomerDetails(customerDetails.customer.id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إضافة الطفل');
    }
  };

  const handleDeleteCustomer = async (customerId) => {
    if (!window.confirm('هل أنت متأكد من حذف هذا العميل؟ لا يمكن التراجع.')) return;
    try {
      await api.delete(`/admin/customers/${customerId}`);
      toast.success('تم حذف العميل');
      fetchCustomers(customerSearch);

      if (customerDetails?.customer?.id === customerId) {
        setCustomerDetailsOpen(false);
        setCustomerDetails(null);
        setEditingCustomer(null);
      }
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل حذف العميل');
    }
  };

  const handleChangeAdminPassword = async (e) => {
    e.preventDefault();
    if (passwordForm.new_password.length < 8) {
      toast.error('كلمة المرور الجديدة يجب أن تكون 8 أحرف على الأقل');
      return;
    }
    if (passwordForm.new_password !== passwordForm.confirm_password) {
      toast.error('تأكيد كلمة المرور غير مطابق');
      return;
    }

    setChangingPassword(true);
    try {
      await api.put('/admin/change-password', {
        current_password: passwordForm.current_password,
        new_password: passwordForm.new_password
      });
      toast.success('تم تغيير كلمة مرور المدير بنجاح');
      setPasswordForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تغيير كلمة المرور');
    } finally {
      setChangingPassword(false);
    }
  };

  const handleUpdateChild = async (childId) => {
    if (!customerDetails?.customer?.id || !editingChild) return;
    try {
      await api.put(`/admin/customers/${customerDetails.customer.id}/children/${childId}`, editingChild);
      toast.success('تم تحديث بيانات الطفل');
      setEditingChild(null);
      fetchCustomerDetails(customerDetails.customer.id);
    } catch (error) {
      toast.error('فشل تحديث بيانات الطفل');
    }
  };

  const handleDeleteChild = async (childId) => {
    if (!customerDetails?.customer?.id) return;
    if (!window.confirm('هل أنت متأكد من حذف هذا الطفل؟')) return;
    try {
      await api.delete(`/admin/customers/${customerDetails.customer.id}/children/${childId}`);
      toast.success('تم حذف الطفل');
      fetchCustomerDetails(customerDetails.customer.id);
    } catch (error) {
      toast.error('فشل حذف الطفل');
    }
  };


  const fetchProducts = async () => {
    try {
      const response = await api.get('/admin/products');
      setProducts(response.data.products || []);
    } catch (error) {
      toast.error('فشل تحميل المنتجات');
    }
  };

  const handleCreateProduct = async (e) => {
    e.preventDefault();
    try {
      await api.post('/admin/products', {
        ...productForm,
        priceJD: Number(productForm.priceJD),
        stockQty: productForm.stockQty === '' ? undefined : Number(productForm.stockQty)
      });
      toast.success('تم إضافة المنتج');
      setProductForm({ nameAr: '', nameEn: '', sku: '', priceJD: '', imageUrl: '', active: true, stockQty: '' });
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إضافة المنتج');
    }
  };

  const handleUpdateProduct = async (product) => {
    try {
      await api.patch(`/admin/products/${product.id}`, {
        nameAr: product.nameAr,
        nameEn: product.nameEn,
        sku: product.sku,
        priceJD: Number(product.priceJD),
        imageUrl: product.imageUrl || '',
        active: product.active,
        stockQty: product.stockQty === '' || product.stockQty === null ? undefined : Number(product.stockQty)
      });
      toast.success('تم تحديث المنتج');
      fetchProducts();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تحديث المنتج');
    }
  };

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    setActiveFilter(null); // Reset filter when manually changing tabs
    if (tab === 'users' && !loadedDataByTab.users) {
      fetchUsers();
      setLoadedDataByTab((prev) => ({ ...prev, users: true }));
    }
    if (tab === 'customers' && !loadedDataByTab.customers) {
      fetchCustomers();
      setLoadedDataByTab((prev) => ({ ...prev, customers: true }));
    }
    if (tab === 'hourly' && !loadedDataByTab.hourly) {
      fetchHourlyBookings();
      setLoadedDataByTab((prev) => ({ ...prev, hourly: true }));
    }
    if (tab === 'birthday' && !loadedDataByTab.birthday) {
      fetchBirthdayBookings();
      setLoadedDataByTab((prev) => ({ ...prev, birthday: true }));
    }
    if (tab === 'subscriptions' && !loadedDataByTab.subscriptions) {
      fetchSubscriptions();
      setLoadedDataByTab((prev) => ({ ...prev, subscriptions: true }));
    }
    if (tab === 'products' && !loadedDataByTab.products) {
      fetchProducts();
      setLoadedDataByTab((prev) => ({ ...prev, products: true }));
    }
    if (tab === 'templates' && !loadedDataByTab.templates) {
      refreshTemplatesData();
    }
    if (tab === 'gallery' && !loadedDataByTab.gallery) {
      refreshGalleryData();
    }
    if (tab === 'settings' && !loadedDataByTab.settings) {
      Promise.all([
        api.get('/admin/settings'),
        fetchBusinessHours(),
        fetchSlotControls()
      ])
        .then(([settingsRes]) => {
          setSettings(settingsRes.data.settings || {});
          setLoadedDataByTab((prev) => ({ ...prev, settings: true }));
        })
        .catch(() => toast.error('فشل تحميل الإعدادات'));
    }
    if (tab === 'pricing' && !loadedDataByTab.pricing) {
      api.get('/admin/pricing')
        .then((pricingRes) => {
          setPricing(pricingRes.data.pricing || {});
          setLoadedDataByTab((prev) => ({ ...prev, pricing: true }));
        })
        .catch(() => toast.error('فشل تحميل الأسعار'));
    }
    if (tab === 'whatsapp_settings' && !loadedDataByTab.whatsapp_settings) {
      fetchWhatsAppAutoReplyConfig();
      setLoadedDataByTab((prev) => ({ ...prev, whatsapp_settings: true }));
    }
    if (tab === 'play_pricing' && !loadedDataByTab.play_pricing) {
      api.get('/admin/play-pricing')
        .then((playPricingRes) => {
          if (playPricingRes.data.pricing) setPlayPricing(playPricingRes.data.pricing);
          setLoadedDataByTab((prev) => ({ ...prev, play_pricing: true }));
        })
        .catch(() => toast.error('فشل تحميل أسعار اللعب'));
    }
    if (tab === 'business_info' && !loadedDataByTab.business_info) {
      api.get('/admin/business-info')
        .then((businessInfoRes) => {
          if (businessInfoRes.data.info) setBusinessInfo(businessInfoRes.data.info);
          setLoadedDataByTab((prev) => ({ ...prev, business_info: true }));
        })
        .catch(() => toast.error('فشل تحميل معلومات العمل'));
    }
    if (tab === 'daycare_packages' && !loadedDataByTab.daycare_packages) {
      api.get('/admin/daycare-packages')
        .then((daycareRes) => {
          if (daycareRes.data.packages) setDaycarePackages(daycareRes.data.packages);
          setLoadedDataByTab((prev) => ({ ...prev, daycare_packages: true }));
        })
        .catch(() => toast.error('فشل تحميل باقات الداي كير'));
    }
    if (tab === 'birthday_packages' && !loadedDataByTab.birthday_packages) {
      api.get('/admin/birthday-packages')
        .then((birthdayRes) => {
          if (birthdayRes.data.packages) setBirthdayPackages(birthdayRes.data.packages);
          setLoadedDataByTab((prev) => ({ ...prev, birthday_packages: true }));
        })
        .catch(() => toast.error('فشل تحميل باقات عيد الميلاد'));
    }
  };

  // Dashboard card click handlers
  const handleDashboardCardClick = (tab, filter = null) => {
    setActiveTab(tab);
    setActiveFilter(filter);
    if (tab === 'users') fetchUsers();
    if (tab === 'hourly') fetchHourlyBookings();
    if (tab === 'birthday') fetchBirthdayBookings();
    if (tab === 'subscriptions') fetchSubscriptions();
    if (tab === 'products') fetchProducts();
  };

  // Filter helpers
  const isToday = (dateStr) => {
    if (!dateStr) return false;
    const date = new Date(dateStr);
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const getFilteredHourlyBookings = () => {
    if (activeFilter === 'today') {
      return hourlyBookings.filter(b => isToday(b.booking_date || b.created_at));
    }
    return hourlyBookings;
  };

  const formatSessionTimer = (endTime) => {
    if (!endTime) return null;
    const remainingMs = new Date(endTime).getTime() - nowMs;
    if (Number.isNaN(remainingMs)) return null;

    const clamped = Math.max(0, remainingMs);
    const totalSeconds = Math.floor(clamped / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const paymentMethodLabel = {
    card: 'Card',
    cash: 'Cash',
    cliq: 'CliQ'
  };

  const handleActivateHourlySession = async (booking) => {
    if (!booking?.booking_code) {
      toast.error('Booking code is missing');
      return;
    }

    setActivatingBookingId(booking.id);
    try {
      await api.post('/staff/checkin', { booking_code: booking.booking_code });
      toast.success(`Session activated for ${booking.child?.name || 'child'}`);
      await fetchHourlyBookings();
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to activate session');
    } finally {
      setActivatingBookingId(null);
    }
  };

  const getFilteredBirthdayBookings = () => {
    if (activeFilter === 'today') {
      return birthdayBookings.filter(b => isToday(b.party_date || b.created_at));
    }
    if (activeFilter === 'custom_pending') {
      return birthdayBookings.filter(b => b.is_custom && b.status === 'custom_pending');
    }
    return birthdayBookings;
  };

  const getFilteredSubscriptions = () => {
    if (activeFilter === 'active') {
      return subscriptions.filter(s => s.status === 'active' && s.remaining_visits > 0);
    }
    return subscriptions;
  };

  const handleUpdateBirthdayBookingStatus = async (bookingId, status) => {
    try {
      const response = await api.put(`/admin/bookings/birthday/${bookingId}`, { status });
      const updatedBooking = response.data?.booking;

      if (updatedBooking) {
        setBirthdayBookings((prev) => prev.map((booking) => (
          booking.id === bookingId ? { ...booking, ...updatedBooking } : booking
        )));
      } else {
        fetchBirthdayBookings();
      }

      toast.success(status === 'confirmed' ? 'تم تأكيد الحجز بنجاح' : 'تم تحديث حالة الحجز');
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تحديث حالة الحجز');
    }
  };

  const handleCreateTheme = async (e) => {
    e.preventDefault();
    try {
      if (editingTheme) {
        await api.put(`/admin/themes/${editingTheme.id}`, {
          ...newTheme,
          price: parseFloat(newTheme.price)
        });
        toast.success('Theme updated!');
        setEditingTheme(null);
      } else {
        await api.post('/admin/themes', {
          ...newTheme,
          price: parseFloat(newTheme.price)
        });
        toast.success('Theme created!');
      }
      setThemeDialogOpen(false);
      setNewTheme({ name: '', name_ar: '', description: '', description_ar: '', price: '', image_url: '' });
      await Promise.all([refreshTemplatesData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error('Failed to save theme');
    }
  };

  const handleEditTheme = (theme) => {
    setEditingTheme(theme);
    setNewTheme({
      name: theme.name || '',
      name_ar: theme.name_ar || '',
      description: theme.description || '',
      description_ar: theme.description_ar || '',
      price: theme.price?.toString() || '',
      image_url: theme.image_url || ''
    });
    setThemeDialogOpen(true);
  };

  const handleDeleteTheme = async (id) => {
    if (!window.confirm('Delete this theme?')) return;
    try {
      await api.delete(`/admin/themes/${id}`);
      toast.success('Theme deleted');
      await Promise.all([refreshTemplatesData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error('Failed to delete theme');
    }
  };

  // Image upload handler
  const handleImageUpload = async (e, setter, field = 'image_url') => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file type
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('يجب أن تكون الصورة PNG أو JPG أو WebP');
      return;
    }
    
    // Validate file size
    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      toast.error(`حجم الصورة يجب أن يكون أقل من ${MAX_IMAGE_UPLOAD_MB}MB`);
      return;
    }
    
    setUploadingImage(true);
    try {
      const formData = new FormData();
      formData.append('image', file);
      
      const response = await api.post('/admin/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setter(prev => ({ ...prev, [field]: response.data.image_url }));
      toast.success('تم رفع الصورة');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل رفع الصورة'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleCreatePlan = async (e) => {
    e.preventDefault();
    try {
      if (editingPlan) {
        await api.put(`/admin/plans/${editingPlan.id}`, {
          ...newPlan,
          visits: parseInt(newPlan.visits),
          price: parseFloat(newPlan.price)
        });
        toast.success('Plan updated!');
        setEditingPlan(null);
      } else {
        await api.post('/admin/plans', {
          ...newPlan,
          visits: parseInt(newPlan.visits),
          price: parseFloat(newPlan.price)
        });
        toast.success('Plan created!');
      }
      setPlanDialogOpen(false);
      setNewPlan({ name: '', name_ar: '', description: '', description_ar: '', visits: '', price: '' });
      await Promise.all([refreshTemplatesData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error('Failed to save plan');
    }
  };

  const handleEditPlan = (plan) => {
    setEditingPlan(plan);
    setNewPlan({
      name: plan.name || '',
      name_ar: plan.name_ar || '',
      description: plan.description || '',
      description_ar: plan.description_ar || '',
      visits: plan.visits?.toString() || '',
      price: plan.price?.toString() || ''
    });
    setPlanDialogOpen(true);
  };

  const handleDeletePlan = async (id) => {
    if (!window.confirm('Delete this plan?')) return;
    try {
      await api.delete(`/admin/plans/${id}`);
      toast.success('Plan deleted');
      await Promise.all([refreshTemplatesData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error('Failed to delete plan');
    }
  };

  // Fetch parent details with kids
  const handleExpandParent = async (userId) => {
    if (expandedParent === userId) {
      setExpandedParent(null);
      setParentDetails(null);
      return;
    }
    setExpandedParent(userId);
    setLoadingParent(true);
    try {
      const res = await api.get(`/admin/users/${userId}`);
      setParentDetails(res.data);
    } catch (error) {
      toast.error('Failed to load details');
    } finally {
      setLoadingParent(false);
    }
  };

  // Gallery image upload handler
  const handleGalleryFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    if (!file.type.startsWith('image/')) {
      toast.error('يجب اختيار صورة');
      return;
    }
    
    // Show preview
    const reader = new FileReader();
    reader.onload = (ev) => setGalleryPreview(ev.target.result);
    reader.readAsDataURL(file);
    
    setNewMedia(prev => ({ ...prev, file }));
  };

  const handleAddMedia = async (e) => {
    e.preventDefault();
    try {
      let mediaUrl = newMedia.url;
      
      // If file selected, upload first
      if (newMedia.file) {
        setUploadingImage(true);
        const formData = new FormData();
        formData.append('image', newMedia.file);
        const uploadRes = await api.post('/admin/upload-image', formData, {
          headers: { 'Content-Type': 'multipart/form-data' }
        });
        mediaUrl = uploadRes.data.image_url;
      }
      
      if (!mediaUrl) {
        toast.error('يرجى اختيار صورة أو إدخال رابط');
        return;
      }
      
      await api.post('/gallery', { url: mediaUrl, type: newMedia.type, title: newMedia.title });
      toast.success('تمت الإضافة!');
      setMediaDialogOpen(false);
      setNewMedia({ url: '', type: 'photo', title: '', file: null });
      setGalleryPreview(null);
      await Promise.all([refreshGalleryData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشلت الإضافة'));
    } finally {
      setUploadingImage(false);
    }
  };

  const handleDeleteMedia = async (id) => {
    if (!window.confirm('Delete this media?')) return;
    try {
      await api.delete(`/gallery/${id}`);
      toast.success('Media deleted');
      await Promise.all([refreshGalleryData(), refreshDashboardStats()]);
    } catch (error) {
      toast.error('Failed to delete');
    }
  };

  const handleAdjustPoints = async (e) => {
    e.preventDefault();
    try {
      await api.post('/loyalty/adjust', {
        user_id: selectedUser.id,
        points: parseInt(pointsAdjustment.points),
        description: pointsAdjustment.description
      });
      toast.success('Points adjusted!');
      setAdjustPointsDialogOpen(false);
      setPointsAdjustment({ points: 0, description: '' });
      fetchUsers();
    } catch (error) {
      toast.error('Failed to adjust points');
    }
  };

  const handleUpdateSettings = async (key, value) => {
    try {
      await api.put('/admin/settings', { [key]: value });
      setSettings({ ...settings, [key]: value });
      toast.success('Setting updated');
    } catch (error) {
      toast.error('Failed to update setting');
    }
  };

  const handleUpdatePricing = async (e) => {
    e.preventDefault();
    try {
      await api.put('/admin/pricing', pricing);
      toast.success('تم تحديث الأسعار بنجاح / Pricing updated successfully!');
      await refreshDashboardStats();
    } catch (error) {
      toast.error('Failed to update pricing');
    }
  };

  const handleUpdatePlayPricing = async (e) => {
    e.preventDefault();
    setSavingPlayPricing(true);
    try {
      await api.put('/admin/play-pricing', playPricing);
      toast.success('تم تحديث أسعار اللعب بنجاح');
    } catch (error) {
      toast.error('فشل تحديث أسعار اللعب');
    } finally {
      setSavingPlayPricing(false);
    }
  };

  const handleUpdateBusinessInfo = async (e) => {
    e.preventDefault();
    setSavingBusinessInfo(true);
    try {
      await api.put('/admin/business-info', businessInfo);
      toast.success('تم تحديث معلومات العمل بنجاح');
    } catch (error) {
      toast.error('فشل تحديث معلومات العمل');
    } finally {
      setSavingBusinessInfo(false);
    }
  };

  const fetchBusinessHours = async () => {
    try {
      const response = await api.get('/admin/business-hours');
      setBusinessHours({
        opening_time: response.data?.opening_time || '10:00',
        closing_time: response.data?.closing_time || '23:00'
      });
    } catch (error) {
      toast.error('فشل تحميل ساعات العمل');
    }
  };

  const handleSaveBusinessHours = async (e) => {
    e.preventDefault();
    setSavingBusinessHours(true);
    try {
      await api.put('/admin/business-hours', businessHours);
      toast.success('تم تحديث ساعات العمل');
    } catch (error) {
      toast.error('فشل تحديث ساعات العمل');
    } finally {
      setSavingBusinessHours(false);
    }
  };

  const fetchSlotControls = async (date = slotControlDate, type = slotControlType) => {
    if (!date) return;
    setLoadingSlotControls(true);
    try {
      await api.get('/slots/available', { params: { date, slot_type: type } });
      const response = await api.get('/admin/slots', { params: { date, slot_type: type } });
      setSlotControls(response.data?.slots || []);
    } catch (error) {
      toast.error('فشل تحميل الأوقات');
    } finally {
      setLoadingSlotControls(false);
    }
  };

  const handleToggleSlotAvailability = async (slot, nextIsActive) => {
    setUpdatingSlotId(slot.id);
    try {
      await api.put(`/slots/${slot.id}`, { is_active: nextIsActive });
      setSlotControls((prev) => prev.map((item) => (
        item.id === slot.id ? { ...item, is_active: nextIsActive } : item
      )));
      toast.success(nextIsActive ? 'تم تفعيل الموعد' : 'تم إغلاق الموعد');
    } catch (error) {
      toast.error('فشل تحديث حالة الموعد');
    } finally {
      setUpdatingSlotId(null);
    }
  };

  const handleSaveDaycarePackage = async (pkg) => {
    setSavingDaycarePackage(true);
    try {
      await api.put(`/admin/daycare-packages/${pkg.id || pkg._id}`, pkg);
      toast.success('تم تحديث الباقة');
      setEditingDaycarePackage(null);
      const res = await api.get('/admin/daycare-packages');
      setDaycarePackages(res.data.packages || []);
    } catch (error) {
      toast.error('فشل تحديث الباقة');
    } finally {
      setSavingDaycarePackage(false);
    }
  };

  const handleAddDaycarePackage = async (e) => {
    e.preventDefault();
    setAddingDaycarePackage(true);
    try {
      const parseCommaSeparated = (val) =>
        typeof val === 'string' ? val.split(',').map(s => s.trim()).filter(Boolean) : [];
      const payload = {
        ...newDaycarePackage,
        time_slots: parseCommaSeparated(newDaycarePackage.time_slots),
        includes: parseCommaSeparated(newDaycarePackage.includes)
      };
      await api.post('/admin/daycare-packages', payload);
      toast.success('تمت إضافة باقة الداي كير');
      setNewDaycarePackage({ name: '', name_ar: '', price: 0, visits: 1, duration_hours: 0, duration_minutes: 0, time_slots: '', includes: '' });
      const res = await api.get('/admin/daycare-packages');
      setDaycarePackages(res.data.packages || []);
    } catch (error) {
      toast.error('فشل إضافة الباقة');
    } finally {
      setAddingDaycarePackage(false);
    }
  };

  const handleSaveBirthdayPackage = async (pkg) => {
    setSavingBirthdayPackage(true);
    try {
      const { kids_count, play_hours, meals, stands, gifts_per_kid, premium_gift, ...rest } = pkg;
      await api.put(`/admin/birthday-packages/${pkg.id || pkg._id}`, {
        ...rest,
        includes: { kids_count: Number(kids_count), play_hours: Number(play_hours), meals: Number(meals), stands: Number(stands), gifts_per_kid: Boolean(gifts_per_kid), premium_gift: Boolean(premium_gift) }
      });
      toast.success('تم تحديث باقة عيد الميلاد');
      setEditingBirthdayPackage(null);
      const res = await api.get('/admin/birthday-packages');
      setBirthdayPackages(res.data.packages || []);
    } catch (error) {
      toast.error('فشل تحديث الباقة');
    } finally {
      setSavingBirthdayPackage(false);
    }
  };

  const handleAddBirthdayPackage = async (e) => {
    e.preventDefault();
    setAddingBirthdayPackage(true);
    try {
      const { kids_count, play_hours, meals, stands, gifts_per_kid, premium_gift, ...rest } = newBirthdayPackage;
      await api.post('/admin/birthday-packages', {
        ...rest,
        includes: { kids_count: Number(kids_count), play_hours: Number(play_hours), meals: Number(meals), stands: Number(stands), gifts_per_kid: Boolean(gifts_per_kid), premium_gift: Boolean(premium_gift) }
      });
      toast.success('تمت إضافة باقة عيد الميلاد');
      setNewBirthdayPackage({ name: '', name_ar: '', price: 0, kids_count: 10, play_hours: 2, meals: 10, stands: 0, gifts_per_kid: false, premium_gift: false });
      const res = await api.get('/admin/birthday-packages');
      setBirthdayPackages(res.data.packages || []);
    } catch (error) {
      toast.error('فشل إضافة الباقة');
    } finally {
      setAddingBirthdayPackage(false);
    }
  };

  // Hero settings handlers
  const handleHeroImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const maxSizeBytes = MAX_IMAGE_UPLOAD_BYTES;

    if (!allowedTypes.includes(file.type)) {
      toast.error('صيغة الصورة غير مدعومة. استخدم PNG أو JPG أو WEBP');
      e.target.value = '';
      return;
    }

    if (file.size > maxSizeBytes) {
      toast.error(`حجم الصورة كبير جداً. الحد الأقصى ${MAX_IMAGE_UPLOAD_MB}MB`);
      e.target.value = '';
      return;
    }

    // Preview (object URL is lighter than base64 for large photos)
    try {
      if (heroPreviewObjectUrl) {
        URL.revokeObjectURL(heroPreviewObjectUrl);
      }
      const objectUrl = URL.createObjectURL(file);
      setHeroPreviewObjectUrl(objectUrl);
      setHeroImagePreview(objectUrl);
    } catch {
      toast.error('تعذر تجهيز معاينة الصورة');
    }

    // Upload
    const formData = new FormData();
    formData.append('image', file);
    
    try {
      setUploadingImage(true);
      const uploadRes = await api.post('/admin/upload-image', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });

      if (!uploadRes?.data?.image_url) {
        throw new Error('Invalid upload response');
      }

      const uploadedImageUrl = uploadRes.data.image_url;
      setHeroSettings((prev) => ({ ...prev, hero_image: uploadedImageUrl }));

      // Persist hero image immediately so admin doesn't lose it if they leave before clicking save.
      await api.put('/admin/settings', { hero_image: uploadedImageUrl });
      toast.success('تم رفع الصورة وحفظها');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل رفع الصورة'));
      if (heroPreviewObjectUrl) {
        URL.revokeObjectURL(heroPreviewObjectUrl);
        setHeroPreviewObjectUrl(null);
      }
      setHeroImagePreview(null);
    } finally {
      setUploadingImage(false);
    }
  };

  const handleSaveHero = async () => {
    setSavingHero(true);
    try {
      // Add cache-bust to hero image URL if it exists
      let imageUrl = heroSettings.hero_image;
      if (imageUrl && !imageUrl.includes('?v=')) {
        imageUrl = `${imageUrl}?v=${Date.now()}`;
      } else if (imageUrl) {
        imageUrl = imageUrl.replace(/\?v=\d+/, `?v=${Date.now()}`);
      }
      
      await api.put('/admin/settings', {
        hero_title: heroSettings.hero_title,
        hero_subtitle: heroSettings.hero_subtitle,
        hero_cta_text: heroSettings.hero_cta_text,
        hero_cta_route: heroSettings.hero_cta_route,
        hero_image: imageUrl
      });
      toast.success('تم حفظ إعدادات الصفحة الرئيسية');
    } catch (error) {
      toast.error('فشل حفظ الإعدادات');
    } finally {
      setSavingHero(false);
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
      expired: 'bg-red-100 text-red-700'
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
          <div className="flex items-center gap-3">
            <img src={mascotImg} alt="" className="h-12 w-12 rounded-full border-2 border-[var(--peekaboo-green)] shadow" />
            <h1 className="font-heading text-2xl sm:text-3xl font-bold" data-testid="admin-title">
              Admin Panel
            </h1>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => navigate('/reception')} className="rounded-full gap-2 bg-[var(--peekaboo-green)] hover:bg-[var(--peekaboo-green)]/90">
              <QrCode className="h-4 w-4" /> Reception Scanner
            </Button>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={handleTabChange}>
          <div className="flex flex-col lg:flex-row gap-6">

            {/* Sidebar */}
            <div className="w-full lg:w-56 flex-shrink-0">
              <div className="lg:sticky lg:top-8 flex lg:flex-col flex-row flex-wrap gap-1 overflow-x-auto pb-2 lg:pb-0">

                {/* Dashboard */}
                <button
                  onClick={() => handleTabChange('dashboard')}
                  className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === 'dashboard' ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}
                >
                  <LayoutDashboard className="h-4 w-4 flex-shrink-0" /> لوحة التحكم
                </button>

                {/* Sales Group */}
                <div className="hidden lg:block pt-3 w-full">
                  <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">المبيعات</p>
                </div>
                {[
                  { value: 'hourly', label: 'حجوزات بالساعة', icon: <Clock className="h-4 w-4" /> },
                  { value: 'birthday', label: 'حفلات أعياد ميلاد', icon: <Cake className="h-4 w-4" /> },
                  { value: 'subscriptions', label: 'الاشتراكات', icon: <Star className="h-4 w-4" /> },
                  { value: 'pricing', label: 'الأسعار', icon: <DollarSign className="h-4 w-4" /> },
                ].map(item => (
                  <button key={item.value} onClick={() => handleTabChange(item.value)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === item.value ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {item.icon} {item.label}
                  </button>
                ))}

                {/* Customers Group */}
                <div className="hidden lg:block pt-3 w-full">
                  <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">العملاء</p>
                </div>
                {[
                  { value: 'users', label: 'الآباء', icon: <Users className="h-4 w-4" /> },
                  { value: 'customers', label: 'الأطفال', icon: <Users className="h-4 w-4" /> },
                ].map(item => (
                  <button key={item.value} onClick={() => handleTabChange(item.value)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === item.value ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {item.icon} {item.label}
                  </button>
                ))}

                {/* Marketing Group */}
                <div className="hidden lg:block pt-3 w-full">
                  <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">التسويق</p>
                </div>
                {[
                  { value: 'whatsapp_inbox', label: 'صندوق الوارد', icon: <MessageSquare className="h-4 w-4" />, external: '/staff?tab=inbox' },
                  { value: 'whatsapp_campaigns', label: 'الحملات', icon: <Megaphone className="h-4 w-4" />, external: '/staff?tab=campaigns' },
                  { value: 'templates', label: 'القوالب', icon: <FileText className="h-4 w-4" /> },
                  { value: 'quick_replies_admin', label: 'الردود السريعة', icon: <MessageSquare className="h-4 w-4" /> },
                  { value: 'whatsapp_settings', label: 'إعدادات الواتساب', icon: <Settings className="h-4 w-4" /> },
                  { value: 'bot_data', label: 'بيانات البوت', icon: <MessageSquare className="h-4 w-4" /> },
                ].map(item => (
                  <button key={item.value}
                    onClick={() => item.external ? navigate(item.external) : handleTabChange(item.value)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === item.value ? 'bg-[#66A9E9] text-white shadow-sm' : 'text-gray-600 hover:bg-[#66A9E9]/10'}`}>
                    {item.icon} {item.label}
                  </button>
                ))}

                {/* Settings Group */}
                <div className="hidden lg:block pt-3 w-full">
                  <p className="px-4 text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">الإعدادات</p>
                </div>
                {[
                  { value: 'themes', label: 'الثيمات', icon: <Palette className="h-4 w-4" /> },
                  { value: 'products', label: 'المنتجات', icon: <Gift className="h-4 w-4" /> },
                  { value: 'gallery', label: 'المعرض', icon: <Image className="h-4 w-4" /> },
                  { value: 'homepage', label: 'الصفحة الرئيسية', icon: <Home className="h-4 w-4" /> },
                  { value: 'settings', label: 'الإعدادات', icon: <Settings className="h-4 w-4" /> },
                ].map(item => (
                  <button key={item.value} onClick={() => handleTabChange(item.value)}
                    className={`flex items-center gap-3 px-4 py-2.5 rounded-xl text-sm font-medium transition-all whitespace-nowrap ${activeTab === item.value ? 'bg-primary text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
                    {item.icon} {item.label}
                  </button>
                ))}

              </div>
            </div>

            {/* Main content area */}
            <div className="flex-1 min-w-0">

          {/* Dashboard */}
          <TabsContent value="dashboard">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly', 'today')}>
                <CardContent className="p-4 text-center">
                  <DollarSign className="h-8 w-8 text-emerald-600 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{formatCurrency(stats.revenue_today)}</p>
                  <p className="text-sm text-muted-foreground">إيراد اليوم</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
                <CardContent className="p-4 text-center">
                  <DollarSign className="h-8 w-8 text-green-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{formatCurrency(stats.revenue_month)}</p>
                  <p className="text-sm text-muted-foreground">إيراد الشهر</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
                <CardContent className="p-4 text-center">
                  <Clock className="h-8 w-8 text-blue-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.active_sessions_now || 0}</p>
                  <p className="text-sm text-muted-foreground">الجلسات النشطة الآن</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly', 'today')}>
                <CardContent className="p-4 text-center">
                  <Check className="h-8 w-8 text-sky-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.total_checkins_today || 0}</p>
                  <p className="text-sm text-muted-foreground">إجمالي Check-ins اليوم</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('hourly')}>
                <CardContent className="p-4 text-center">
                  <Clock className="h-8 w-8 text-amber-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.open_overtime_unpaid_orders || 0}</p>
                  <p className="text-sm text-muted-foreground">Overtime / Unpaid المفتوحة</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('subscriptions', 'active')}>
                <CardContent className="p-4 text-center">
                  <Star className="h-8 w-8 text-secondary mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.active_subscriptions || 0}</p>
                  <p className="text-sm text-muted-foreground">الاشتراكات النشطة</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('users')}>
                <CardContent className="p-4 text-center">
                  <Users className="h-8 w-8 text-primary mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground mb-1">الآباء / Parents</p>
                  <p className="text-2xl font-bold">{stats.total_parents || 0}</p>
                  <div className="my-2 border-t border-border" />
                  <p className="text-sm text-muted-foreground mb-1">الأطفال / Children</p>
                  <p className="text-2xl font-bold">{stats.total_children || 0}</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('birthday', 'today')}>
                <CardContent className="p-4 text-center">
                  <Cake className="h-8 w-8 text-pink-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.today_birthday_bookings || 0}</p>
                  <p className="text-sm text-muted-foreground">Today Birthday</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('subscriptions', 'active')}>
                <CardContent className="p-4 text-center">
                  <Star className="h-8 w-8 text-secondary mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.active_subscriptions || 0}</p>
                  <p className="text-sm text-muted-foreground">Active Subs</p>
                </CardContent>
              </Card>
              <Card className="rounded-2xl cursor-pointer hover:shadow-lg hover:border-primary transition-all" onClick={() => handleDashboardCardClick('birthday', 'custom_pending')}>
                <CardContent className="p-4 text-center">
                  <Cake className="h-8 w-8 text-purple-500 mx-auto mb-2" />
                  <p className="text-2xl font-bold">{stats.pending_custom_parties || 0}</p>
                  <p className="text-sm text-muted-foreground">Custom Pending</p>
                </CardContent>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-lg">ملخص الإشغال حسب الفترة</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(stats.zones_occupancy || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">لا توجد جلسات نشطة حالياً</p>
                  ) : (
                    (stats.zones_occupancy || []).map((zone) => (
                      <div key={zone.zone} className="flex items-center justify-between rounded-xl border p-3">
                        <div>
                          <p className="font-semibold">{zone.zone}</p>
                          <p className="text-xs text-muted-foreground">{zone.active_sessions || 0} جلسة</p>
                        </div>
                        <Badge variant="secondary">{zone.occupancy_share_pct || 0}%</Badge>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="text-lg">ملخص الفروع</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {(stats.branch_summary || []).length === 0 ? (
                    <p className="text-sm text-muted-foreground">No branch data available</p>
                  ) : (
                    (stats.branch_summary || []).map((branch) => (
                      <div key={branch.branch} className="rounded-xl border p-3 space-y-1">
                        <p className="font-semibold">{branch.branch}</p>
                        <p className="text-sm text-muted-foreground">طلبات: {branch.total_orders || 0}</p>
                        <p className="text-sm text-muted-foreground">إيراد مدفوع: {formatCurrency(branch.paid_revenue)}</p>
                        <p className="text-sm text-muted-foreground">طلبات غير مدفوعة: {branch.unpaid_orders || 0}</p>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          {/* Pricing Management */}
          <TabsContent value="pricing">
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
                {/* Hourly Pricing */}
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

                {/* Subscription Plans */}
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
                            <Badge className="mt-2 bg-purple-100 text-purple-700">
                              باقة يومية / Daily Pass
                            </Badge>
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

                {/* Birthday Themes */}
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
          </TabsContent>

          {/* Users/Parents */}
          <TabsContent value="users">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>Parents</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {users.map((user) => (
                    <div key={user.id} className="rounded-xl bg-muted/50 overflow-hidden">
                      <div 
                        className="flex justify-between items-center p-3 cursor-pointer hover:bg-muted/70"
                        onClick={() => handleExpandParent(user.id)}
                      >
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${expandedParent === user.id ? 'bg-primary' : 'bg-muted-foreground'}`} />
                          <div>
                            <p className="font-semibold">{user.name}</p>
                            <p className="text-sm text-muted-foreground">{user.email}</p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <div className="text-right">
                            <p className="font-bold text-secondary">{user.loyalty_points} pts</p>
                          </div>
                          <Button 
                            variant="outline" 
                            size="sm" 
                            className="rounded-full"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedUser(user);
                              setAdjustPointsDialogOpen(true);
                            }}
                          >
                            <Gift className="h-4 w-4 mr-1" /> Adjust
                          </Button>
                        </div>
                      </div>
                      
                      {/* Expandable Details */}
                      {expandedParent === user.id && (
                        <div className="p-4 border-t bg-white">
                          {loadingParent ? (
                            <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
                          ) : parentDetails ? (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div>
                                <h4 className="font-bold mb-2">معلومات الوالد / Parent Info</h4>
                                <p className="text-sm"><span className="text-muted-foreground">الاسم:</span> {parentDetails.user?.name}</p>
                                <p className="text-sm"><span className="text-muted-foreground">البريد:</span> {parentDetails.user?.email}</p>
                                <p className="text-sm"><span className="text-muted-foreground">تاريخ التسجيل:</span> {parentDetails.user?.created_at ? new Date(parentDetails.user.created_at).toLocaleDateString('ar') : '-'}</p>
                                <p className="text-sm mt-2"><span className="text-muted-foreground">الحجوزات:</span> {(parentDetails.hourly_bookings?.length || 0) + (parentDetails.birthday_bookings?.length || 0)}</p>
                                <p className="text-sm"><span className="text-muted-foreground">الاشتراكات:</span> {parentDetails.subscriptions?.length || 0}</p>
                              </div>
                              <div>
                                <h4 className="font-bold mb-2">الأطفال / Children ({parentDetails.children?.length || 0})</h4>
                                {parentDetails.children?.length > 0 ? (
                                  <div className="space-y-2">
                                    {parentDetails.children.map(child => (
                                      <div key={child.id} className="p-2 rounded bg-muted/50 text-sm">
                                        <p className="font-semibold">{child.name}</p>
                                        {child.date_of_birth && <p className="text-muted-foreground">العمر: {new Date().getFullYear() - new Date(child.date_of_birth).getFullYear()} سنة</p>}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <p className="text-sm text-muted-foreground">لا يوجد أطفال مسجلين</p>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Customers Management */}
          <TabsContent value="customers">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
                  <div>
                    <CardTitle className="text-xl">إدارة العملاء</CardTitle>
                    <p className="text-sm text-muted-foreground mt-1">عرض وتعديل وإدارة بيانات العملاء</p>
                  </div>
                  <Dialog open={customerDialogOpen} onOpenChange={setCustomerDialogOpen}>
                    <DialogTrigger asChild>
                      <Button className="w-full sm:w-auto rounded-full gap-2">
                        <UserPlus className="h-4 w-4" /> إضافة عميل
                      </Button>
                    </DialogTrigger>
                    <DialogContent dir="rtl">
                      <DialogHeader>
                        <DialogTitle>إضافة عميل جديد</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreateCustomer} className="space-y-4">
                        <div>
                          <Label>الاسم *</Label>
                          <Input
                            value={newCustomer.name}
                            onChange={(e) => setNewCustomer({...newCustomer, name: e.target.value})}
                            className="rounded-xl mt-1"
                            required
                          />
                        </div>
                        <div>
                          <Label>البريد الإلكتروني *</Label>
                          <Input
                            type="email"
                            value={newCustomer.email}
                            onChange={(e) => setNewCustomer({...newCustomer, email: e.target.value})}
                            className="rounded-xl mt-1"
                            required
                          />
                        </div>
                        <div>
                          <Label>الهاتف</Label>
                          <Input
                            value={newCustomer.phone}
                            onChange={(e) => setNewCustomer({...newCustomer, phone: e.target.value})}
                            className="rounded-xl mt-1"
                            dir="ltr"
                          />
                        </div>
                        <Button type="submit" className="w-full rounded-full" disabled={savingCustomer}>
                          {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                          إضافة العميل
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Search */}
                <div className="relative">
                  <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="بحث بالاسم أو البريد أو الهاتف..."
                    value={customerSearch}
                    onChange={(e) => setCustomerSearch(e.target.value)}
                    className="pr-10 rounded-xl text-sm sm:text-base"
                  />
                </div>

                {/* Customers Table */}
                {loadingCustomers ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : customers.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    لا يوجد عملاء
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[640px] text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-right py-3 px-2 font-medium">الاسم</th>
                          <th className="text-right py-3 px-2 font-medium">الهاتف</th>
                          <th className="text-right py-3 px-2 font-medium">البريد</th>
                          <th className="text-center py-3 px-2 font-medium">الأطفال</th>
                          <th className="text-center py-3 px-2 font-medium">الحالة</th>
                          <th className="text-center py-3 px-2 font-medium">إجراءات</th>
                        </tr>
                      </thead>
                      <tbody>
                        {customers.map((customer) => (
                          <tr key={customer.id} className="border-b hover:bg-muted/50">
                            <td className="py-3 px-2">{customer.name}</td>
                            <td className="py-3 px-2" dir="ltr">{customer.phone || '-'}</td>
                            <td className="py-3 px-2 text-xs">{customer.email}</td>
                            <td className="py-3 px-2 text-center">{customer.children_count}</td>
                            <td className="py-3 px-2 text-center">
                              <Badge variant={customer.is_disabled ? 'destructive' : 'default'} className="text-xs">
                                {customer.is_disabled ? 'معطّل' : 'نشط'}
                              </Badge>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <div className="flex justify-center gap-1">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0"
                                  onClick={() => { setSelectedCustomer(customer); fetchCustomerDetails(customer.id); }}
                                >
                                  <Eye className="h-4 w-4" />
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className={`h-8 w-8 p-0 ${customer.is_disabled ? 'text-green-600' : 'text-red-600'}`}
                                  onClick={() => handleToggleCustomerStatus(customer.id)}
                                >
                                  {customer.is_disabled ? <Check className="h-4 w-4" /> : <Ban className="h-4 w-4" />}
                                </Button>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 w-8 p-0 text-red-600"
                                  onClick={() => handleDeleteCustomer(customer.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Customer Details Dialog */}
            <Dialog open={customerDetailsOpen} onOpenChange={(open) => { setCustomerDetailsOpen(open); if (!open) { setCustomerDetails(null); setEditingChild(null); } }}>
              <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
                <DialogHeader>
                  <DialogTitle>تفاصيل العميل</DialogTitle>
                </DialogHeader>
                {customerDetails && (
                  <div className="space-y-6">
                    {/* Customer Info */}
                    <div className="space-y-4 p-4 bg-muted/30 rounded-xl">
                      <h3 className="font-bold text-sm mb-3">بيانات العميل</h3>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <Label>الاسم</Label>
                          <Input
                            value={editingCustomer?.name || ''}
                            onChange={(e) => setEditingCustomer({...editingCustomer, name: e.target.value})}
                            className="rounded-xl mt-1"
                          />
                        </div>
                        <div>
                          <Label>الهاتف</Label>
                          <Input
                            value={editingCustomer?.phone || ''}
                            onChange={(e) => setEditingCustomer({...editingCustomer, phone: e.target.value})}
                            className="rounded-xl mt-1"
                            dir="ltr"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <Label>البريد الإلكتروني</Label>
                          <Input
                            type="email"
                            value={editingCustomer?.email || ''}
                            onChange={(e) => setEditingCustomer({...editingCustomer, email: e.target.value})}
                            className="rounded-xl mt-1"
                          />
                        </div>
                      </div>
                      <div className="flex gap-2 pt-2">
                        <Button onClick={handleUpdateCustomer} className="rounded-full" disabled={savingCustomer}>
                          {savingCustomer ? <Loader2 className="h-4 w-4 animate-spin ml-2" /> : null}
                          حفظ التغييرات
                        </Button>
                        <Button
                          variant={customerDetails.customer.is_disabled ? 'default' : 'destructive'}
                          onClick={() => handleToggleCustomerStatus(customerDetails.customer.id)}
                          className="rounded-full"
                        >
                          {customerDetails.customer.is_disabled ? 'تفعيل' : 'تعطيل'}
                        </Button>
                        <Button
                          variant="destructive"
                          onClick={() => handleDeleteCustomer(customerDetails.customer.id)}
                          className="rounded-full"
                        >
                          <Trash2 className="h-4 w-4 ml-1" /> حذف العميل
                        </Button>
                      </div>
                    </div>

                    {/* Bookings Summary */}
                    <div className="p-4 bg-blue-50 rounded-xl">
                      <h3 className="font-bold text-sm mb-3">ملخص الحجوزات</h3>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                        <div className="bg-white p-3 rounded-lg">
                          <div className="text-2xl font-bold text-blue-600">{customerDetails.bookings_summary?.hourly_count || 0}</div>
                          <div className="text-xs text-muted-foreground">حجوزات ساعية</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg">
                          <div className="text-2xl font-bold text-pink-600">{customerDetails.bookings_summary?.birthday_count || 0}</div>
                          <div className="text-xs text-muted-foreground">حفلات</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg">
                          <div className="text-2xl font-bold text-green-600">{customerDetails.bookings_summary?.active_subscriptions || 0}</div>
                          <div className="text-xs text-muted-foreground">اشتراكات نشطة</div>
                        </div>
                        <div className="bg-white p-3 rounded-lg">
                          <div className="text-2xl font-bold text-yellow-600">{customerDetails.customer?.loyalty_points || 0}</div>
                          <div className="text-xs text-muted-foreground">نقاط الولاء</div>
                        </div>
                      </div>
                      {customerDetails.bookings_summary?.last_booking_date && (
                        <p className="text-xs text-muted-foreground mt-3">
                          آخر حجز: {format(new Date(customerDetails.bookings_summary.last_booking_date), 'yyyy-MM-dd')}
                        </p>
                      )}
                    </div>

                    {/* Children */}
                    <div className="p-4 bg-yellow-50 rounded-xl">
                      <h3 className="font-bold text-sm mb-3">الأطفال ({customerDetails.children?.length || 0})</h3>
                      <div className="space-y-2">
                        {customerDetails.children?.map((child) => (
                          <div key={child.id} className="flex items-center justify-between bg-white p-3 rounded-lg">
                            {editingChild?.id === child.id ? (
                              <div className="flex-1 flex items-center gap-2">
                                <Input
                                  value={editingChild.name}
                                  onChange={(e) => setEditingChild({...editingChild, name: e.target.value})}
                                  className="rounded-lg h-8 text-sm"
                                  placeholder="الاسم"
                                />
                                <Input
                                  type="date"
                                  value={editingChild.birthday?.split('T')[0] || ''}
                                  onChange={(e) => setEditingChild({...editingChild, birthday: e.target.value})}
                                  className="rounded-lg h-8 text-sm w-36"
                                />
                                <Button size="sm" className="h-8" onClick={() => handleUpdateChild(child.id)}>
                                  <Check className="h-3 w-3" />
                                </Button>
                                <Button size="sm" variant="ghost" className="h-8" onClick={() => setEditingChild(null)}>
                                  <X className="h-3 w-3" />
                                </Button>
                              </div>
                            ) : (
                              <>
                                <div>
                                  <span className="font-medium">{child.name}</span>
                                  <span className="text-xs text-muted-foreground mr-2">
                                    ({format(new Date(child.birthday), 'yyyy-MM-dd')})
                                  </span>
                                </div>
                                <div className="flex gap-1">
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setEditingChild({ id: child.id, name: child.name, birthday: child.birthday })}>
                                    <Edit className="h-3 w-3" />
                                  </Button>
                                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-red-600" onClick={() => handleDeleteChild(child.id)}>
                                    <Trash2 className="h-3 w-3" />
                                  </Button>
                                </div>
                              </>
                            )}
                          </div>
                        ))}
                      </div>
                      {/* Add Child Form */}
                      <form onSubmit={handleAddChild} className="mt-3 flex items-end gap-2">
                        <div className="flex-1">
                          <Label className="text-xs">اسم الطفل</Label>
                          <Input
                            value={newChild.name}
                            onChange={(e) => setNewChild({...newChild, name: e.target.value})}
                            className="rounded-lg h-9 text-sm"
                            placeholder="اسم الطفل"
                            required
                          />
                        </div>
                        <div>
                          <Label className="text-xs">تاريخ الميلاد</Label>
                          <Input
                            type="date"
                            value={newChild.birthday}
                            onChange={(e) => setNewChild({...newChild, birthday: e.target.value})}
                            className="rounded-lg h-9 text-sm w-36"
                            required
                          />
                        </div>
                        <Button type="submit" size="sm" className="h-9 rounded-lg">
                          <Plus className="h-4 w-4" />
                        </Button>
                      </form>
                    </div>
                  </div>
                )}
              </DialogContent>
            </Dialog>
          </TabsContent>

          {/* Hourly Bookings */}
          <TabsContent value="hourly">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>Hourly Bookings {activeFilter === 'today' && <Badge className="ml-2 bg-blue-500">Today</Badge>}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {getFilteredHourlyBookings().map((booking) => (
                    <div key={booking.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{booking.booking_code}</span>
                          <Badge className={getStatusBadge(booking.status)}>{booking.status}</Badge>
                          {booking.status === 'checked_in' && (
                            <Badge className="bg-blue-600 text-white">
                              Running: {formatSessionTimer(booking.session_end_time) || '--:--'}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {booking.slot?.date} at {booking.slot?.start_time} - {booking.child?.name}
                        </p>
                        <p className="text-sm text-muted-foreground">{booking.user?.email}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Payment: {paymentMethodLabel[booking.payment_method] || booking.payment_method || 'N/A'} ({booking.payment_status || 'N/A'})
                        </p>
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="font-bold">${booking.amount}</p>
                        {booking.status === 'confirmed' && booking.payment_method && booking.payment_method !== 'card' && (
                          <Button
                            size="sm"
                            className="h-8 rounded-full"
                            onClick={() => handleActivateHourlySession(booking)}
                            disabled={activatingBookingId === booking.id}
                          >
                            {activatingBookingId === booking.id ? 'Activating...' : 'Activate Session'}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Birthday Bookings */}
          <TabsContent value="birthday">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>Birthday Bookings {activeFilter === 'today' && <Badge className="ml-2 bg-pink-500">Today</Badge>}{activeFilter === 'custom_pending' && <Badge className="ml-2 bg-purple-500">Custom Pending</Badge>}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {getFilteredBirthdayBookings().map((booking) => (
                    <div key={booking.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{booking.booking_code}</span>
                          <Badge className={getStatusBadge(booking.status)}>{booking.status.replace('_', ' ')}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {booking.slot?.date} - {booking.is_custom ? 'Custom Theme' : booking.theme?.name}
                        </p>
                        <p className="text-sm text-muted-foreground">{booking.user?.email}</p>
                        {booking.is_custom && (
                          <p className="text-sm text-purple-600 mt-1">Request: {booking.custom_request}</p>
                        )}
                      </div>
                      <div className="flex flex-col items-end gap-2">
                        <p className="font-bold">{booking.amount ? `$${booking.amount}` : 'Pending'}</p>
                        {(booking.status === 'custom_pending' || booking.status === 'pending') && (
                          <Button
                            size="sm"
                            className="h-8 rounded-full"
                            onClick={() => handleUpdateBirthdayBookingStatus(booking.id, 'confirmed')}
                          >
                            Confirm Order
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Subscriptions */}
          <TabsContent value="subscriptions">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">باقات الاشتراك / Subscription Plans</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">إدارة باقات الزيارات للعملاء</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {plans.map((plan) => (
                    <Card key={plan.id} className="rounded-xl">
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-heading font-bold">{plan.name}</h3>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditPlan(plan)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeletePlan(plan.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {plan.name_ar && <p className="text-sm text-muted-foreground" dir="rtl">{plan.name_ar}</p>}
                        <p className="text-sm text-muted-foreground">{plan.description}</p>
                        <div className="mt-2 flex justify-between">
                          <span className="text-secondary font-bold">{plan.visits} visits</span>
                          <span className="font-bold">{plan.price} JD</span>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                
                {/* Bottom Action Bar */}
                <div className="pt-6 border-t mt-6 flex justify-end">
                  <Dialog open={planDialogOpen} onOpenChange={(open) => { setPlanDialogOpen(open); if (!open) { setEditingPlan(null); setNewPlan({ name: '', name_ar: '', description: '', description_ar: '', visits: '', price: '' }); } }}>
                    <DialogTrigger asChild>
                      <Button className="rounded-full gap-2 px-6">
                        <Plus className="h-4 w-4" /> إضافة باقة / Add Plan
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingPlan ? 'تعديل الباقة / Edit Plan' : 'إنشاء باقة / Create Plan'}</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreatePlan} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>الاسم (EN)</Label>
                            <Input value={newPlan.name} onChange={(e) => setNewPlan({...newPlan, name: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>الاسم (AR)</Label>
                            <Input value={newPlan.name_ar} onChange={(e) => setNewPlan({...newPlan, name_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>الوصف (EN)</Label>
                            <Textarea value={newPlan.description} onChange={(e) => setNewPlan({...newPlan, description: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>الوصف (AR)</Label>
                            <Textarea value={newPlan.description_ar} onChange={(e) => setNewPlan({...newPlan, description_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>عدد الزيارات</Label>
                            <Input type="number" value={newPlan.visits} onChange={(e) => setNewPlan({...newPlan, visits: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>السعر (JD)</Label>
                            <Input type="number" step="0.01" value={newPlan.price} onChange={(e) => setNewPlan({...newPlan, price: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                        </div>
                        <Button type="submit" className="w-full rounded-full">{editingPlan ? 'تحديث / Update' : 'إنشاء / Create'}</Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>

                <h3 className="font-heading font-bold mb-4 mt-8">الاشتراكات النشطة / Active Subscriptions {activeFilter === 'active' && <Badge className="ml-2 bg-green-500">Active Only</Badge>}</h3>
                <div className="space-y-3">
                  {getFilteredSubscriptions().map((sub) => (
                    <div key={sub.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold">{sub.plan?.name}</span>
                          <Badge className={getStatusBadge(sub.status)}>{sub.status}</Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{sub.user?.email} - {sub.child?.name}</p>
                      </div>
                      <div className="text-right">
                        <p className="font-bold text-secondary">{sub.remaining_visits} left</p>
                        <p className="text-sm text-muted-foreground">
                          Expires {format(new Date(sub.expires_at), 'MMM d')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Themes */}
          <TabsContent value="themes">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">ثيمات أعياد الميلاد / Birthday Themes</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">إدارة ثيمات الحفلات المتاحة للعملاء</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {themes.map((theme) => (
                    <Card key={theme.id} className="rounded-xl overflow-hidden">
                      {theme.image_url && (
                        <img src={theme.image_url} alt={theme.name} className="w-full h-32 object-cover" />
                      )}
                      <CardContent className="p-4">
                        <div className="flex justify-between items-start mb-2">
                          <h3 className="font-heading font-bold">{theme.name}</h3>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleEditTheme(theme)}>
                              <Edit className="h-4 w-4" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteTheme(theme.id)}>
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                        {theme.name_ar && <p className="text-sm text-muted-foreground" dir="rtl">{theme.name_ar}</p>}
                        <p className="text-sm text-muted-foreground line-clamp-2">{theme.description}</p>
                        <p className="text-accent font-bold mt-2">{theme.price} JD</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
                
                {/* Bottom Action Bar */}
                <div className="pt-6 border-t flex justify-end">
                  <Dialog open={themeDialogOpen} onOpenChange={(open) => { setThemeDialogOpen(open); if (!open) { setEditingTheme(null); setNewTheme({ name: '', name_ar: '', description: '', description_ar: '', price: '', image_url: '' }); } }}>
                    <DialogTrigger asChild>
                      <Button className="rounded-full gap-2 px-6">
                        <Plus className="h-4 w-4" /> إضافة ثيم / Add Theme
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{editingTheme ? 'تعديل الثيم / Edit Theme' : 'إنشاء ثيم / Create Theme'}</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleCreateTheme} className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>الاسم (EN)</Label>
                            <Input value={newTheme.name} onChange={(e) => setNewTheme({...newTheme, name: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>الاسم (AR)</Label>
                            <Input value={newTheme.name_ar} onChange={(e) => setNewTheme({...newTheme, name_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>الوصف (EN)</Label>
                            <Textarea value={newTheme.description} onChange={(e) => setNewTheme({...newTheme, description: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>الوصف (AR)</Label>
                            <Textarea value={newTheme.description_ar} onChange={(e) => setNewTheme({...newTheme, description_ar: e.target.value})} className="rounded-xl mt-1" dir="rtl" />
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label>السعر (JD)</Label>
                            <Input type="number" step="0.01" value={newTheme.price} onChange={(e) => setNewTheme({...newTheme, price: e.target.value})} className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>صورة الثيم</Label>
                            <Input 
                              type="file" 
                              accept="image/png,image/jpeg,image/webp"
                              onChange={(e) => handleImageUpload(e, setNewTheme)}
                              className="rounded-xl mt-1"
                              disabled={uploadingImage}
                            />
                            {newTheme.image_url && (
                              <img src={newTheme.image_url} alt="Preview" className="mt-2 h-20 w-20 object-cover rounded-lg" />
                            )}
                          </div>
                        </div>
                        <Button type="submit" className="w-full rounded-full" disabled={uploadingImage}>
                          {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          {editingTheme ? 'تحديث / Update' : 'إنشاء / Create'}
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Gallery */}

          <TabsContent value="products">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle>إدارة الإضافات (الجوارب)</CardTitle>
                <CardDescription>أنشئ وعدّل منتجات الإضافات المعروضة في صفحة الحجز.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <form onSubmit={handleCreateProduct} className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <Input placeholder="الاسم عربي" value={productForm.nameAr} onChange={(e) => setProductForm({ ...productForm, nameAr: e.target.value })} />
                  <Input placeholder="Name EN" value={productForm.nameEn} onChange={(e) => setProductForm({ ...productForm, nameEn: e.target.value })} />
                  <Input placeholder="SKU" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} />
                  <Input type="number" step="0.01" placeholder="السعر" value={productForm.priceJD} onChange={(e) => setProductForm({ ...productForm, priceJD: e.target.value })} />
                  <Input placeholder="Image URL" value={productForm.imageUrl} onChange={(e) => setProductForm({ ...productForm, imageUrl: e.target.value })} />
                  <Input type="number" placeholder="الكمية (اختياري)" value={productForm.stockQty} onChange={(e) => setProductForm({ ...productForm, stockQty: e.target.value })} />
                  <div className="md:col-span-3 flex items-center justify-between">
                    <label className="flex items-center gap-2 text-sm">
                      <input type="checkbox" checked={productForm.active} onChange={(e) => setProductForm({ ...productForm, active: e.target.checked })} />
                      فعال
                    </label>
                    <Button type="submit" className="rounded-full">إضافة منتج</Button>
                  </div>
                </form>

                <div className="space-y-3">
                  {products.map((product) => (
                    <div key={product.id} className="grid grid-cols-1 md:grid-cols-6 gap-2 border rounded-xl p-3">
                      <Input value={product.nameAr || ''} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, nameAr: e.target.value } : p))} />
                      <Input value={product.nameEn || ''} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, nameEn: e.target.value } : p))} />
                      <Input value={product.sku || ''} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, sku: e.target.value } : p))} />
                      <Input type="number" step="0.01" value={product.priceJD ?? ''} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, priceJD: e.target.value } : p))} />
                      <label className="flex items-center gap-2 text-sm">
                        <input type="checkbox" checked={!!product.active} onChange={(e) => setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, active: e.target.checked } : p))} />
                        فعال
                      </label>
                      <Button type="button" variant="outline" onClick={() => handleUpdateProduct(product)}>حفظ</Button>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="gallery">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">معرض الصور / Homepage Gallery</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">صور تظهر في الصفحة الرئيسية للعملاء</p>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {gallery.map((item) => (
                    <div key={item.id} className="relative rounded-xl overflow-hidden group">
                      {item.type === 'photo' ? (
                        <img src={item.url} alt={item.title} className="w-full h-32 object-cover" />
                      ) : (
                        <video src={item.url} className="w-full h-32 object-cover" />
                      )}
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <Button variant="destructive" size="icon" onClick={() => handleDeleteMedia(item.id)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Bottom Action Bar */}
                <div className="pt-6 border-t flex justify-end">
                  <Dialog open={mediaDialogOpen} onOpenChange={(open) => { setMediaDialogOpen(open); if (!open) { setGalleryPreview(null); setNewMedia({ url: '', type: 'photo', title: '', file: null }); } }}>
                    <DialogTrigger asChild>
                      <Button className="rounded-full gap-2 px-6">
                        <Plus className="h-4 w-4" /> إضافة صورة / Add Media
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>إضافة صورة / Add Gallery Media</DialogTitle>
                      </DialogHeader>
                      <form onSubmit={handleAddMedia} className="space-y-4">
                        <div>
                          <Label>رفع صورة / Upload Image</Label>
                          <Input 
                            type="file" 
                            accept="image/*"
                            onChange={handleGalleryFileChange}
                            className="rounded-xl mt-1"
                            disabled={uploadingImage}
                          />
                          {galleryPreview && (
                            <img src={galleryPreview} alt="Preview" className="mt-2 h-32 w-full object-cover rounded-lg" />
                          )}
                        </div>
                        <div className="text-center text-sm text-muted-foreground">- أو / OR -</div>
                        <div>
                          <Label>رابط الصورة / URL (اختياري)</Label>
                          <Input value={newMedia.url} onChange={(e) => setNewMedia({...newMedia, url: e.target.value})} className="rounded-xl mt-1" placeholder="https://..." disabled={!!newMedia.file} />
                        </div>
                        <div>
                          <Label>النوع / Type</Label>
                          <Select value={newMedia.type} onValueChange={(v) => setNewMedia({...newMedia, type: v})}>
                            <SelectTrigger className="rounded-xl mt-1">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="photo">صورة / Photo</SelectItem>
                              <SelectItem value="video">فيديو / Video</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div>
                          <Label>العنوان / Title (اختياري)</Label>
                          <Input value={newMedia.title} onChange={(e) => setNewMedia({...newMedia, title: e.target.value})} className="rounded-xl mt-1" />
                        </div>
                        <Button type="submit" className="w-full rounded-full" disabled={uploadingImage}>
                          {uploadingImage ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                          إضافة / Add Media
                        </Button>
                      </form>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Homepage Hero Settings */}
          <TabsContent value="homepage">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl flex items-center gap-2">
                  <Home className="h-5 w-5" />
                  الصفحة الرئيسية / Homepage Hero
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">تعديل محتوى وصورة البانر الرئيسي</p>
              </CardHeader>
              <CardContent className="space-y-6">
                {/* Hero Image Upload */}
                <div className="space-y-3">
                  <Label className="text-base font-semibold">صورة البانر / Hero Image</Label>
                  <div className="flex items-start gap-4">
                    <div className="w-64 h-40 rounded-xl border-2 border-dashed border-border overflow-hidden bg-muted flex items-center justify-center">
                      {heroImagePreview || heroSettings.hero_image ? (
                        <img 
                          src={heroImagePreview || resolveMediaUrl(heroSettings.hero_image)} 
                          alt="Hero preview" 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="text-center text-muted-foreground">
                          <Image className="h-10 w-10 mx-auto mb-2 opacity-50" />
                          <p className="text-sm">لا توجد صورة</p>
                        </div>
                      )}
                    </div>
                    <div className="flex-1">
                      <Input
                        type="file"
                        accept="image/*"
                        onChange={handleHeroImageChange}
                        className="rounded-xl"
                        disabled={uploadingImage}
                      />
                      <p className="text-xs text-muted-foreground mt-2">يُفضل صورة بحجم 1200×800 بكسل</p>
                    </div>
                  </div>
                </div>

                {/* Hero Text Fields */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <Label>العنوان الرئيسي / Hero Title</Label>
                    <Input
                      value={heroSettings.hero_title}
                      onChange={(e) => setHeroSettings({...heroSettings, hero_title: e.target.value})}
                      className="rounded-xl"
                      dir="rtl"
                      placeholder="حيث يلعب الأطفال ويحتفلون"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>نص الزر / CTA Button Text</Label>
                    <Input
                      value={heroSettings.hero_cta_text}
                      onChange={(e) => setHeroSettings({...heroSettings, hero_cta_text: e.target.value})}
                      className="rounded-xl"
                      dir="rtl"
                      placeholder="احجز جلسة"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>الوصف / Hero Subtitle</Label>
                  <Textarea
                    value={heroSettings.hero_subtitle}
                    onChange={(e) => setHeroSettings({...heroSettings, hero_subtitle: e.target.value})}
                    className="rounded-xl min-h-[80px]"
                    dir="rtl"
                    placeholder="أفضل تجربة ملعب داخلي..."
                  />
                </div>

                <div className="space-y-2">
                  <Label>رابط الزر / CTA Route</Label>
                  <Select 
                    value={heroSettings.hero_cta_route} 
                    onValueChange={(v) => setHeroSettings({...heroSettings, hero_cta_route: v})}
                  >
                    <SelectTrigger className="rounded-xl w-full md:w-64">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="/tickets">تذاكر بالساعة (/tickets)</SelectItem>
                      <SelectItem value="/birthday">حفلات أعياد الميلاد (/birthday)</SelectItem>
                      <SelectItem value="/subscriptions">الاشتراكات (/subscriptions)</SelectItem>
                      <SelectItem value="/register">إنشاء حساب (/register)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Save Button */}
                <div className="pt-4 border-t">
                  <Button 
                    onClick={handleSaveHero}
                    disabled={savingHero}
                    className="rounded-full gap-2 bg-primary"
                  >
                    {savingHero ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        جاري الحفظ...
                      </>
                    ) : (
                      <>
                        <Edit className="h-4 w-4" />
                        حفظ التغييرات / Save Changes
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Settings */}
          <TabsContent value="settings">
            <Card className="rounded-2xl">
              <CardHeader className="pb-2">
                <CardTitle className="text-xl">الإعدادات / Pricing & Capacity Settings</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">إعدادات الأسعار والسعة</p>
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
          </TabsContent>

            {/* Templates tab */}
            <TabsContent value="templates">
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
                        toast.error('فشل المزامنة — تحقق من WHATSAPP_WABA_ID');
                      }
                    }}
                    className="rounded-full gap-2 mb-4"
                  >
                    <RefreshCw className="h-4 w-4" /> مزامنة القوالب من Meta
                  </Button>
                  <p className="text-sm text-muted-foreground">بعد المزامنة ستظهر القوالب هنا. يمكنك استخدامها في الحملات.</p>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="quick_replies_admin">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MessageSquare className="h-5 w-5 text-[#66A9E9]" /> إدارة الردود السريعة
                  </CardTitle>
                  <CardDescription>الردود السريعة المستخدمة في صندوق الوارد</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-4">يمكن إدارة الردود السريعة مباشرة من صندوق الوارد عند فتح أي محادثة.</p>
                  <Button onClick={() => navigate('/staff?tab=inbox')} className="rounded-full gap-2">
                    <MessageSquare className="h-4 w-4" /> فتح صندوق الوارد
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="whatsapp_settings">
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
                          toast.error('فشل المزامنة');
                        }
                      }}
                      className="rounded-full gap-2"
                    >
                      <RefreshCw className="h-4 w-4" /> مزامنة القوالب
                    </Button>
                  </div>

                  <div className="p-4 rounded-xl bg-green-50 border border-green-200 space-y-3">
                    <p className="text-sm font-semibold text-green-800 mb-1">الرد الذكي التلقائي</p>
                    <p className="text-xs text-green-700">يرد تلقائيًا على رسائل العملاء حسب الكلمات المفتاحية مثل الأسعار، الموقع، الحجز، والاشتراكات.</p>

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
                    </div>

                    <div>
                      <Label className="text-sm">نص تذييل الرد</Label>
                      <Input
                        value={autoReplyConfig.footer || ''}
                        onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, footer: e.target.value }))}
                        className="rounded-xl mt-1 bg-white"
                        placeholder="مثال: للحجز عبر الموقع ..."
                      />
                    </div>

                    <div>
                      <Label className="text-sm">الرد الافتراضي (عند عدم مطابقة كلمات)</Label>
                      <Textarea
                        value={autoReplyConfig.fallbackReply || ''}
                        onChange={(e) => setAutoReplyConfig(prev => ({ ...prev, fallbackReply: e.target.value }))}
                        className="rounded-xl mt-1 bg-white"
                        rows={3}
                      />
                    </div>

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
            </TabsContent>

            {/* ═══════════════════════════════════════ BOT DATA ═══════════════════════════════════════ */}
            <TabsContent value="bot_data">
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

                    {/* Add new daycare package */}
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

                    {/* Add new birthday package */}
                    <form onSubmit={handleAddBirthdayPackage} className="p-3 rounded-xl border border-dashed bg-muted/30 space-y-2">
                      <p className="text-sm font-medium text-muted-foreground">إضافة باقة عيد ميلاد جديدة</p>
                      <Input value={newBirthdayPackage.name_ar} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, name_ar: e.target.value }))} placeholder="الاسم بالعربي *" className="rounded-xl bg-white text-sm" required />
                      <Input value={newBirthdayPackage.name} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, name: e.target.value }))} placeholder="Name (English) *" className="rounded-xl bg-white text-sm" required />
                      <Input type="number" value={newBirthdayPackage.price} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, price: e.target.value }))} placeholder="السعر (د.أ) *" className="rounded-xl bg-white text-sm" required />
                      <div className="grid grid-cols-2 gap-2">
                        <Input type="number" value={newBirthdayPackage.kids_count} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, kids_count: e.target.value }))} placeholder="عدد الأطفال" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={newBirthdayPackage.play_hours} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, play_hours: e.target.value }))} placeholder="ساعات اللعب" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={newBirthdayPackage.meals} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, meals: e.target.value }))} placeholder="عدد الوجبات" className="rounded-xl bg-white text-sm" />
                        <Input type="number" value={newBirthdayPackage.stands} onChange={e => setNewBirthdayPackage(prev => ({ ...prev, stands: e.target.value }))} placeholder="عدد الستاندات" className="rounded-xl bg-white text-sm" />
                      </div>
                      <Button type="submit" size="sm" disabled={addingBirthdayPackage} className="rounded-full gap-1">
                        {addingBirthdayPackage ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />} إضافة
                      </Button>
                    </form>
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            </div>
          </div>
        </Tabs>

        {/* Adjust Points Dialog */}
        <Dialog open={adjustPointsDialogOpen} onOpenChange={setAdjustPointsDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Adjust Loyalty Points</DialogTitle>
            </DialogHeader>
            {selectedUser && (
              <form onSubmit={handleAdjustPoints} className="space-y-4">
                <p>Adjusting points for: <strong>{selectedUser.name}</strong></p>
                <p>Current balance: <strong>{selectedUser.loyalty_points} points</strong></p>
                <div>
                  <Label>Points (use negative to deduct)</Label>
                  <Input 
                    type="number"
                    value={pointsAdjustment.points}
                    onChange={(e) => setPointsAdjustment({...pointsAdjustment, points: e.target.value})}
                    className="rounded-xl mt-1"
                  />
                </div>
                <div>
                  <Label>Reason</Label>
                  <Textarea 
                    value={pointsAdjustment.description}
                    onChange={(e) => setPointsAdjustment({...pointsAdjustment, description: e.target.value})}
                    className="rounded-xl mt-1"
                    placeholder="Reason for adjustment..."
                  />
                </div>
                <Button type="submit" className="w-full rounded-full">Adjust Points</Button>
              </form>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
