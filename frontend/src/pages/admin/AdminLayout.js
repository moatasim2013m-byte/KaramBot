import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../components/ui/card';
import { Input } from '../../components/ui/input';
import { Label } from '../../components/ui/label';
import { Textarea } from '../../components/ui/textarea';
import { Badge } from '../../components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select';
import { toast } from 'sonner';
import { format } from 'date-fns';
import {
  LayoutDashboard, Users, Clock, Cake, Star, Settings, Image,
  Plus, Edit, Trash2, Loader2, Gift, Calendar, DollarSign, Home, Upload, Search, UserPlus, Eye, Ban, Check, X, MessageSquare,
  Megaphone, FileText, Palette, RefreshCw, QrCode,
  CalendarDays, UserCog, LogOut
} from 'lucide-react';
import logoImg from '../../assets/logo.png';
import OverviewTab from './tabs/OverviewTab';
import BookingsTab from './tabs/BookingsTab';
import VisitorsTab from './tabs/VisitorsTab';
import ContentTab from './tabs/ContentTab';
import StaffTab from './tabs/StaffTab';
import SettingsTab from './tabs/SettingsTab';
import ThemesTab from './tabs/ThemesTab';

const RAW_BACKEND_URL = (process.env.REACT_APP_BACKEND_URL || '').trim();
const BACKEND_ORIGIN =
  !RAW_BACKEND_URL || RAW_BACKEND_URL === 'undefined' || RAW_BACKEND_URL === 'null'
    ? ''
    : RAW_BACKEND_URL.replace(/\/+$/, '');

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

export default function AdminLayout() {
  const { api, isAdmin, user, logout } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('dashboard');
  const [currentTab, setCurrentTab] = useState('overview');
  const [activeFilter, setActiveFilter] = useState(null);
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

  const [playPricing, setPlayPricing] = useState({
    hourly_1hr: 7, hourly_2hr: 10, hourly_3hr: 13, hourly_extra_hr: 3,
    extra_companion: 3, sand_area_addon: 20, transport_one_way: 40
  });
  const [savingPlayPricing, setSavingPlayPricing] = useState(false);

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

  const [daycarePackages, setDaycarePackages] = useState([]);
  const [editingDaycarePackage, setEditingDaycarePackage] = useState(null);
  const [savingDaycarePackage, setSavingDaycarePackage] = useState(false);
  const [newDaycarePackage, setNewDaycarePackage] = useState({ name: '', name_ar: '', price: 0, visits: 1, duration_hours: 0, duration_minutes: 0, time_slots: '', includes: '' });
  const [addingDaycarePackage, setAddingDaycarePackage] = useState(false);

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

  const [themeDialogOpen, setThemeDialogOpen] = useState(false);
  const [planDialogOpen, setPlanDialogOpen] = useState(false);
  const [mediaDialogOpen, setMediaDialogOpen] = useState(false);
  const [adjustPointsDialogOpen, setAdjustPointsDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [editingPlan, setEditingPlan] = useState(null);
  const [editingTheme, setEditingTheme] = useState(null);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [galleryPreview, setGalleryPreview] = useState(null);

  const [newTheme, setNewTheme] = useState({ name: '', name_ar: '', description: '', description_ar: '', price: '', image_url: '' });
  const [newPlan, setNewPlan] = useState({ name: '', name_ar: '', description: '', description_ar: '', visits: '', price: '' });
  const [newMedia, setNewMedia] = useState({ url: '', type: 'photo', title: '', file: null });
  const [pointsAdjustment, setPointsAdjustment] = useState({ points: 0, description: '' });

  const [staffMembers, setStaffMembers] = useState([]);

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

  useEffect(() => {
    if (activeTab !== 'customers') return;
    const timer = setTimeout(() => {
      fetchCustomers(customerSearch);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customerSearch, activeTab]);

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

      const s = settingsRes.data.settings || {};
      if (s.hero_title || s.hero_subtitle || s.hero_image) {
        setHeroSettings((prev) => ({
          hero_title: s.hero_title || prev.hero_title,
          hero_subtitle: s.hero_subtitle || prev.hero_subtitle,
          hero_cta_text: s.hero_cta_text || prev.hero_cta_text,
          hero_cta_route: s.hero_cta_route || prev.hero_cta_route,
          hero_image: s.hero_image || ''
        }));
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

  const fetchStaffMembers = async () => {
    try {
      const [staffRes, adminRes] = await Promise.all([
        api.get('/admin/users?role=staff'),
        api.get('/admin/users?role=admin'),
      ]);
      const combined = [
        ...(staffRes.data.users || []),
        ...(adminRes.data.users || []),
      ];
      combined.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      setStaffMembers(combined);
    } catch (error) {
      console.error('Failed to fetch staff members:', error);
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
    setActiveFilter(null);

    // Map old tab names to new sidebar currentTab
    if (tab === 'dashboard') setCurrentTab('overview');
    else if (['hourly', 'birthday', 'subscriptions'].includes(tab)) setCurrentTab('bookings');
    else if (['users', 'customers'].includes(tab)) setCurrentTab('visitors');
    else if (['gallery', 'homepage'].includes(tab)) setCurrentTab('content');
    else if (['pricing', 'settings', 'templates', 'whatsapp_settings', 'bot_data', 'play_pricing', 'business_info', 'daycare_packages', 'birthday_packages'].includes(tab)) setCurrentTab('settings');

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

  const handleDashboardCardClick = (tab, filter = null) => {
    setActiveTab(tab);
    setActiveFilter(filter);
    if (tab === 'users') fetchUsers();
    if (tab === 'hourly') fetchHourlyBookings();
    if (tab === 'birthday') fetchBirthdayBookings();
    if (tab === 'subscriptions') fetchSubscriptions();
    if (tab === 'products') fetchProducts();
  };

  const handleSidebarTabChange = (tabId) => {
    setCurrentTab(tabId);
    if (tabId === 'staff') {
      fetchStaffMembers();
    }
    if (tabId === 'themes' && !loadedDataByTab.templates) {
      refreshTemplatesData();
    }
  };

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

  const handleImageUpload = async (e, setter, field = 'image_url') => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
      toast.error('يجب أن تكون الصورة PNG أو JPG أو WebP');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('حجم الصورة يجب أن يكون أقل من 10MB');
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
      toast.error('فشل رفع الصورة');
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

  const handleGalleryFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      toast.error('يجب اختيار صورة');
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => setGalleryPreview(ev.target.result);
    reader.readAsDataURL(file);
    setNewMedia(prev => ({ ...prev, file }));
  };

  const handleAddMedia = async (e) => {
    e.preventDefault();
    try {
      let mediaUrl = newMedia.url;
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
      toast.error('فشلت الإضافة');
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
        includes: {
          kids_count: Number(kids_count),
          play_hours: Number(play_hours),
          meals: Number(meals),
          stands: Number(stands),
          gifts_per_kid: Boolean(gifts_per_kid),
          premium_gift: Boolean(premium_gift)
        }
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
        includes: {
          kids_count: Number(kids_count),
          play_hours: Number(play_hours),
          meals: Number(meals),
          stands: Number(stands),
          gifts_per_kid: Boolean(gifts_per_kid),
          premium_gift: Boolean(premium_gift)
        }
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

  const handleHeroImageChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
    const maxSizeBytes = 10 * 1024 * 1024;

    if (!allowedTypes.includes(file.type)) {
      toast.error('صيغة الصورة غير مدعومة. استخدم PNG أو JPG أو WEBP');
      e.target.value = '';
      return;
    }
    if (file.size > maxSizeBytes) {
      toast.error('حجم الصورة كبير جداً. الحد الأقصى 10MB');
      e.target.value = '';
      return;
    }

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
      await api.put('/admin/settings', { hero_image: uploadedImageUrl });
      toast.success('تم رفع الصورة وحفظها');
    } catch (error) {
      const backendMessage = error?.response?.data?.error;
      toast.error(backendMessage || 'فشل رفع الصورة');
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

  const allProps = {
    // State
    loading, activeTab, activeFilter, stats, users, hourlyBookings, birthdayBookings,
    subscriptions, themes, plans, gallery, settings, pricing, autoReplyConfig,
    savingAutoReply, playPricing, savingPlayPricing, businessInfo, savingBusinessInfo,
    businessHours, savingBusinessHours, slotControlDate, slotControlType, slotControls,
    loadingSlotControls, updatingSlotId, daycarePackages, editingDaycarePackage,
    savingDaycarePackage, newDaycarePackage, addingDaycarePackage, birthdayPackages,
    editingBirthdayPackage, savingBirthdayPackage, newBirthdayPackage, addingBirthdayPackage,
    expandedParent, parentDetails, loadingParent, nowMs, activatingBookingId, loadedDataByTab,
    heroSettings, heroImagePreview, heroPreviewObjectUrl, savingHero, themeDialogOpen,
    planDialogOpen, mediaDialogOpen, adjustPointsDialogOpen, selectedUser, editingPlan,
    editingTheme, uploadingImage, galleryPreview, newTheme, newPlan, newMedia,
    pointsAdjustment, customers, customerSearch, loadingCustomers, selectedCustomer,
    customerDetails, products, productForm, customerDialogOpen, customerDetailsOpen,
    newCustomer, editingCustomer, newChild, editingChild, savingCustomer, changingPassword,
    passwordForm, currentTab, paymentMethodLabel, staffMembers,
    // State setters
    setActiveTab, setActiveFilter, setStats, setUsers, setHourlyBookings, setBirthdayBookings,
    setSubscriptions, setThemes, setPlans, setGallery, setSettings, setPricing,
    setAutoReplyConfig, setSavingAutoReply, setPlayPricing, setSavingPlayPricing,
    setBusinessInfo, setSavingBusinessInfo, setBusinessHours, setSavingBusinessHours,
    setSlotControlDate, setSlotControlType, setSlotControls, setLoadingSlotControls,
    setUpdatingSlotId, setDaycarePackages, setEditingDaycarePackage, setSavingDaycarePackage,
    setNewDaycarePackage, setAddingDaycarePackage, setBirthdayPackages,
    setEditingBirthdayPackage, setSavingBirthdayPackage, setNewBirthdayPackage,
    setAddingBirthdayPackage, setExpandedParent, setParentDetails, setNowMs,
    setActivatingBookingId, setLoadedDataByTab, setHeroSettings, setHeroImagePreview,
    setHeroPreviewObjectUrl, setSavingHero, setThemeDialogOpen, setPlanDialogOpen,
    setMediaDialogOpen, setAdjustPointsDialogOpen, setSelectedUser, setEditingPlan,
    setEditingTheme, setUploadingImage, setGalleryPreview, setNewTheme, setNewPlan,
    setNewMedia, setPointsAdjustment, setCustomers, setCustomerSearch, setLoadingCustomers,
    setSelectedCustomer, setCustomerDetails, setProducts, setProductForm,
    setCustomerDialogOpen, setCustomerDetailsOpen, setNewCustomer, setEditingCustomer,
    setNewChild, setEditingChild, setSavingCustomer, setChangingPassword, setPasswordForm,
    setCurrentTab, setStaffMembers,
    // Handlers
    handleTabChange, handleDashboardCardClick, handleSidebarTabChange, fetchDashboard, fetchUsers, fetchHourlyBookings,
    fetchBirthdayBookings, fetchSubscriptions, fetchStaffMembers, refreshDashboardStats, refreshTemplatesData,
    refreshGalleryData, fetchWhatsAppAutoReplyConfig, saveWhatsAppAutoReplyConfig,
    fetchCustomers, fetchCustomerDetails, handleCreateCustomer, handleUpdateCustomer,
    handleToggleCustomerStatus, handleAddChild, handleDeleteCustomer, handleChangeAdminPassword,
    handleUpdateChild, handleDeleteChild, fetchProducts, handleCreateProduct, handleUpdateProduct,
    handleCreateTheme, handleEditTheme, handleDeleteTheme, handleImageUpload,
    handleCreatePlan, handleEditPlan, handleDeletePlan, handleExpandParent,
    handleGalleryFileChange, handleAddMedia, handleDeleteMedia, handleAdjustPoints,
    handleUpdateSettings, handleUpdatePricing, handleUpdatePlayPricing, handleUpdateBusinessInfo,
    fetchBusinessHours, handleSaveBusinessHours, fetchSlotControls, handleToggleSlotAvailability,
    handleSaveDaycarePackage, handleAddDaycarePackage, handleSaveBirthdayPackage,
    handleAddBirthdayPackage, handleHeroImageChange, handleSaveHero, getStatusBadge,
    getFilteredHourlyBookings, getFilteredBirthdayBookings, getFilteredSubscriptions,
    formatSessionTimer, formatCurrency, sortByReceivedDate, resolveMediaUrl,
    handleActivateHourlySession, isToday,
    // Auth
    api, user,
  };

  return (
    <div className="min-h-screen flex" dir="rtl">
      {/* Desktop Sidebar (RTL: on the right) */}
      <aside
        className="hidden md:flex flex-col w-60 flex-shrink-0 bg-white border-l border-border"
        style={{ boxShadow: '-4px 0 24px rgba(0,0,0,0.04)', position: 'sticky', top: 0, height: '100vh', overflowY: 'auto' }}
      >
        {/* Logo */}
        <div className="p-5 border-b border-border flex items-center gap-3">
          <img src={logoImg} alt="Peekaboo" className="h-10 w-auto" />
        </div>

        {/* Nav Items */}
        <nav className="flex-1 p-3 space-y-1">
          {[
            { id: 'overview', label: 'نظرة عامة', icon: <LayoutDashboard className="h-4 w-4" /> },
            { id: 'bookings', label: 'الحجوزات', icon: <CalendarDays className="h-4 w-4" /> },
            { id: 'visitors', label: 'الزوار', icon: <Users className="h-4 w-4" /> },
            { id: 'themes', label: 'الثيمات', icon: <Palette className="h-4 w-4" /> },
            { id: 'content', label: 'المحتوى', icon: <Image className="h-4 w-4" /> },
            { id: 'staff', label: 'الموظفون', icon: <UserCog className="h-4 w-4" /> },
            { id: 'settings', label: 'الإعدادات', icon: <Settings className="h-4 w-4" /> },
          ].map(item => (
            <button
              key={item.id}
              onClick={() => handleSidebarTabChange(item.id)}
              className={`admin-sidebar-nav-item w-full text-right ${currentTab === item.id ? 'active' : ''}`}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>

        {/* Bottom: Logout */}
        <div className="p-3 border-t border-border">
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="admin-sidebar-nav-item w-full text-right text-red-500 hover:bg-red-50"
          >
            <LogOut className="h-4 w-4" />
            <span>تسجيل الخروج</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main
        className="flex-1 overflow-y-auto"
        style={{ background: 'hsl(var(--muted) / 0.3)', padding: '32px', minHeight: '100vh' }}
      >
        {/* Mobile header */}
        <div className="md:hidden flex items-center justify-between mb-6">
          <img src={logoImg} alt="Peekaboo" className="h-8 w-auto" />
          <h1 className="font-bold text-lg">Admin Panel</h1>
        </div>

        {/* Tab content */}
        {currentTab === 'overview' && <OverviewTab {...allProps} />}
        {currentTab === 'bookings' && <BookingsTab {...allProps} />}
        {currentTab === 'visitors' && <VisitorsTab {...allProps} />}
        {currentTab === 'themes' && <ThemesTab themes={allProps.themes} setThemes={allProps.setThemes} api={allProps.api} />}
        {currentTab === 'content' && <ContentTab {...allProps} />}
        {currentTab === 'staff' && <StaffTab {...allProps} />}
        {currentTab === 'settings' && <SettingsTab {...allProps} />}
      </main>

      {/* Mobile Bottom Tab Bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-white border-t border-border shadow-lg flex justify-around py-2 z-50">
        {[
          { id: 'overview', icon: <LayoutDashboard className="h-5 w-5" /> },
          { id: 'bookings', icon: <CalendarDays className="h-5 w-5" /> },
          { id: 'visitors', icon: <Users className="h-5 w-5" /> },
          { id: 'themes', icon: <Palette className="h-5 w-5" /> },
          { id: 'content', icon: <Image className="h-5 w-5" /> },
          { id: 'staff', icon: <UserCog className="h-5 w-5" /> },
          { id: 'settings', icon: <Settings className="h-5 w-5" /> },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => handleSidebarTabChange(item.id)}
            className={`p-2 ${currentTab === item.id ? 'text-primary' : 'text-muted-foreground'}`}
          >
            {item.icon}
          </button>
        ))}
      </nav>

      {/* Adjust Points Dialog (global) */}
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
                  onChange={(e) => setPointsAdjustment({ ...pointsAdjustment, points: e.target.value })}
                  className="rounded-xl mt-1"
                />
              </div>
              <div>
                <Label>Reason</Label>
                <Textarea
                  value={pointsAdjustment.description}
                  onChange={(e) => setPointsAdjustment({ ...pointsAdjustment, description: e.target.value })}
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
  );
}
