import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent } from '../components/ui/tabs';
import { toast } from 'sonner';
import {
  QrCode, Clock, Star, Cake, Search, CheckCircle, XCircle, 
  Loader2, AlertTriangle, Users, RefreshCw, MessageSquare, Send,
  Plus, Edit2, Trash2, X, Filter, Megaphone, BarChart2,
  PlayCircle, PauseCircle, ChevronDown, ChevronUp, FileText,
  Image as ImageIcon, Bot, User, Gift
} from 'lucide-react';
import { DashboardLayout } from '../components/admin/DashboardLayout';
import QrScanner from '../components/staff/QrScanner';
import logoImg from '../assets/logo.png';
import InstallPWAButton from '../components/InstallPWAButton';

const getApiErrorMessage = (error, fallback = 'حدث خطأ') =>
  error?.response?.data?.details ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;
const getMediaSrc = (mediaUrl, token = '') => {
  if (!mediaUrl) return '';
  const appendTokenIfNeeded = (url) => {
    if (!token || !url.startsWith('/api/')) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}access_token=${encodeURIComponent(token)}`;
  };
  if (mediaUrl.startsWith('/')) return appendTokenIfNeeded(mediaUrl);
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) return mediaUrl;
  return appendTokenIfNeeded(`/api/staff/inbox/media/${mediaUrl}`);
};

const getRelativeTime = (timestamp) => {
  const now = new Date();
  const msgTime = new Date(timestamp);
  const diffMs = now - msgTime;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);
  if (diffSecs < 60) return 'just now';
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return msgTime.toLocaleDateString();
};

const CAMPAIGN_FORM_INITIAL = {
  name: '',
  message_type: 'free_form',
  free_form_message: '',
  template_name: '',
  template_language: 'ar',
  ttl_hours: '',
  audience_filters: {
    has_booking: false,
    has_active_subscription: false,
    last_message_after: '',
    last_message_before: ''
  }
};

export default function StaffPage() {
  const { api, user, token, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('scanner');
  const [bookingCode, setBookingCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  // Phase 2: QR scanner state
  const [qrValidation, setQrValidation] = useState(null); // { success, booking, message, reasonCode }
  const [qrValidating, setQrValidating] = useState(false);
  const [qrCheckingIn, setQrCheckingIn] = useState(false);
  // Phase 9 — selected booking from the activation queue. Activation MUST be
  // gated on this selection + a successful QR/code validation that matches it.
  const [activatingBooking, setActivatingBooking] = useState(null);
  const [activeSessions, setActiveSessions] = useState([]);
  const [pendingCheckins, setPendingCheckins] = useState([]);
  const [childSearch, setChildSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childSubscription, setChildSubscription] = useState(null);
  const [consuming, setConsuming] = useState(false);
  const [todayParties, setTodayParties] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messages, setMessages] = useState([]);
  const [customerProfile, setCustomerProfile] = useState(null);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxStats, setInboxStats] = useState(null);
  const [quickReplies, setQuickReplies] = useState([]);
  const [showQuickReplies, setShowQuickReplies] = useState(false);
  const [inboxSearch, setInboxSearch] = useState('');
  const [showUnreadOnly, setShowUnreadOnly] = useState(false);
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const autoScrollEnabledRef = useRef(true);
  const previousMessageCountRef = useRef(0);
  const previousConversationWaIdRef = useRef(null);
  const [mobileShowThread, setMobileShowThread] = useState(false);
  const [showQRManager, setShowQRManager] = useState(false);
  const [qrForm, setQrForm] = useState({ label: '', message: '', category: 'other' });
  const [qrEditId, setQrEditId] = useState(null);
  const [qrSaving, setQrSaving] = useState(false);
  const [campaigns, setCampaigns] = useState([]);
  const [campaignsLoading, setCampaignsLoading] = useState(false);
  const [showCampaignForm, setShowCampaignForm] = useState(false);
  const [campaignForm, setCampaignForm] = useState(CAMPAIGN_FORM_INITIAL);
  const [campaignSaving, setCampaignSaving] = useState(false);
  const [executingId, setExecutingId] = useState(null);
  const [pausingId, setPausingId] = useState(null);
  const [expandedCampaignId, setExpandedCampaignId] = useState(null);
  const [campaignStats, setCampaignStats] = useState({});
  const [campaignRecipients, setCampaignRecipients] = useState({});
  const [loadingRecipientsId, setLoadingRecipientsId] = useState(null);
  const [removingRecipientKey, setRemovingRecipientKey] = useState('');
  const [audiencePreview, setAudiencePreview] = useState(null);
  const [audienceCostEstimate, setAudienceCostEstimate] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [savingLabel, setSavingLabel] = useState(false);
  const [labelInput, setLabelInput] = useState('');
  const [showNewChat, setShowNewChat] = useState(false);
  const [newChatPhone, setNewChatPhone] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [startingChat, setStartingChat] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [sendingTemplate, setSendingTemplate] = useState(false);
  const [mediaFiles, setMediaFiles] = useState([]);
  const [mediaPreview, setMediaPreview] = useState([]);
  const [sendingMedia, setSendingMedia] = useState(false);
  const [togglingOptOut, setTogglingOptOut] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState('');
  const [autoReplyConfig, setAutoReplyConfig] = useState(null);
  const [loadingAgentMode, setLoadingAgentMode] = useState(false);
  const [savingAgentMode, setSavingAgentMode] = useState(false);
  const imageInputRef = useRef(null);
  const replyTextareaRef = useRef(null);
  const inboxEventsRef = useRef(null);

  // Bulk Send state
  const [showBulkSend, setShowBulkSend] = useState(false);
  const [bulkTemplateName, setBulkTemplateName] = useState('');
  const [bulkLanguageCode, setBulkLanguageCode] = useState('ar');
  const [bulkVarValues, setBulkVarValues] = useState({});
  const [bulkAdvancedJson, setBulkAdvancedJson] = useState('');
  const [showBulkAdvanced, setShowBulkAdvanced] = useState(false);
  const [bulkTtlHours, setBulkTtlHours] = useState('');
  const [bulkHeaderImageUrl, setBulkHeaderImageUrl] = useState('');
  const [bulkPhones, setBulkPhones] = useState('');
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkResults, setBulkResults] = useState(null);
  const [approvedTemplates, setApprovedTemplates] = useState([]);
  const staffPermissions = useMemo(() => ({
    access_staff_tools: user?.role === 'admin'
      ? true
      : user?.staff_permissions ? Boolean(user?.staff_permissions?.access_staff_tools) : true,
    access_whatsapp_inbox: user?.role === 'admin'
      ? true
      : user?.staff_permissions ? Boolean(user?.staff_permissions?.access_whatsapp_inbox) : true,
    access_whatsapp_campaigns: user?.role === 'admin'
      ? true
      : user?.staff_permissions ? Boolean(user?.staff_permissions?.access_whatsapp_campaigns) : true
  }), [user]);

  const allowedTabs = useMemo(() => {
    const tabs = [];
    if (staffPermissions.access_staff_tools) tabs.push('scanner', 'sessions', 'subscriptions', 'birthdays');
    if (staffPermissions.access_whatsapp_inbox) tabs.push('inbox');
    if (staffPermissions.access_whatsapp_campaigns) tabs.push('campaigns');
    return tabs;
  }, [staffPermissions]);

  const navItems = useMemo(() => {
    const items = [];
    if (staffPermissions.access_staff_tools) {
      items.push({
        id: 'scanner',
        label: 'تفعيل الجلسات',
        icon: <QrCode className="h-4 w-4" />,
      });
      items.push({
        id: 'sessions',
        label: 'Active Sessions',
        icon: <Clock className="h-4 w-4" />,
        badge: activeSessions.length,
      });
      items.push({
        id: 'subscriptions',
        label: 'Subscriptions',
        icon: <Star className="h-4 w-4" />,
      });
      items.push({
        id: 'birthdays',
        label: "Today's Parties",
        icon: <Cake className="h-4 w-4" />,
        badge: todayParties.length,
      });
    }
    if (staffPermissions.access_whatsapp_inbox) {
      items.push({
        id: 'inbox',
        label: 'Inbox',
        icon: <MessageSquare className="h-4 w-4" />,
        badge: inboxStats?.unread_messages || 0,
        badgeVariant: 'danger',
      });
    }
    if (staffPermissions.access_whatsapp_campaigns) {
      items.push({
        id: 'campaigns',
        label: 'Campaigns',
        icon: <Megaphone className="h-4 w-4" />,
      });
    }
    return items;
  }, [
    staffPermissions,
    activeSessions.length,
    todayParties.length,
    inboxStats?.unread_messages,
  ]);

  // Slim 3-item mobile bottom nav (spec: Home / Bookings / Inbox).
  // The full menu remains reachable via the hamburger drawer in <Header />.
  // This is permission-aware: items only appear if the user has access.
  const mobileNavItems = useMemo(() => {
    const byId = (id) => navItems.find((n) => n.id === id);
    const slim = [];
    const home =
      byId('scanner') || byId('sessions') || byId('inbox') || navItems[0];
    if (home) slim.push(home);
    const bookings = byId('birthdays') || byId('subscriptions');
    if (bookings && bookings.id !== home?.id) slim.push(bookings);
    const inbox = byId('inbox');
    if (inbox && inbox.id !== home?.id && inbox.id !== bookings?.id) slim.push(inbox);
    return slim;
  }, [navItems]);

  const handleLogout = useCallback(() => {
    logout();
    navigate('/staff/login');
  }, [logout, navigate]);

  const handleRefresh = useCallback(() => {
    if (staffPermissions.access_staff_tools) {
      fetchActiveSessions();
      fetchPendingCheckins();
      fetchTodayParties();
    }
    if (staffPermissions.access_whatsapp_inbox) fetchInboxStats();
    if (staffPermissions.access_whatsapp_campaigns) fetchCampaigns();
  }, [staffPermissions]); // eslint-disable-line react-hooks/exhaustive-deps

  const createAuthedEventSource = useCallback((path) => {
    if (!token) return null;
    const separator = path.includes('?') ? '&' : '?';
    return new EventSource(`${path}${separator}access_token=${encodeURIComponent(token)}`);
  }, [token]);

  useEffect(() => {
    if (user && user.role !== 'staff' && user.role !== 'admin') navigate('/');
    setLoading(false);
  }, [user, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    if (requestedTab && allowedTabs.includes(requestedTab)) {
      setActiveTab(requestedTab);
    }
  }, [location.search, allowedTabs]);

  useEffect(() => {
    if (allowedTabs.length === 0) return;
    if (!allowedTabs.includes(activeTab)) {
      setActiveTab(allowedTabs[0]);
    }
  }, [activeTab, allowedTabs]);

  useEffect(() => {
    if (!previewImageSrc) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setPreviewImageSrc('');
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [previewImageSrc]);

  useEffect(() => {
    const textarea = replyTextareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const nextHeight = Math.min(textarea.scrollHeight, 160);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 160 ? 'auto' : 'hidden';
  }, [replyText, selectedConversation?.wa_id]);

  const fetchActiveSessions = useCallback(async () => {
    try {
      const response = await api.get('/staff/active-sessions');
      setActiveSessions(response.data.sessions || []);
    } catch (error) { console.error('Failed to fetch active sessions:', error); }
  }, [api]);

  const fetchPendingCheckins = useCallback(async () => {
    try {
      const response = await api.get('/staff/pending-checkins');
      setPendingCheckins(response.data.bookings || []);
    } catch (error) { console.error('Failed to fetch pending check-ins:', error); }
  }, [api]);

  const fetchTodayParties = useCallback(async () => {
    try {
      const response = await api.get('/staff/today-birthdays');
      setTodayParties(response.data.parties || []);
    } catch (error) { console.error('Failed to fetch birthday parties:', error); }
  }, [api]);

  useEffect(() => {
    if (!staffPermissions.access_staff_tools) return undefined;
    fetchActiveSessions();
    fetchPendingCheckins();
    fetchTodayParties();
    return undefined;
  }, [fetchActiveSessions, fetchPendingCheckins, fetchTodayParties, staffPermissions.access_staff_tools]);

  useEffect(() => {
    if (!staffPermissions.access_staff_tools) return undefined;
    const activeSessionsStream = createAuthedEventSource('/api/staff/stream/active-sessions');
    if (!activeSessionsStream) return undefined;

    activeSessionsStream.addEventListener('active_sessions', (event) => {
      try {
        const payload = JSON.parse(event.data);
        setActiveSessions(payload.sessions || []);
      } catch (error) {
        console.error('Failed to parse active sessions stream:', error);
      }
    });
    activeSessionsStream.onerror = () => {
      // EventSource auto-reconnects
    };
    return () => activeSessionsStream.close();
  }, [createAuthedEventSource, staffPermissions.access_staff_tools]);

  const handleCheckin = async (e) => {
    e.preventDefault();
    if (!bookingCode.trim()) { toast.error('Please enter a booking code'); return; }
    setScanning(true);
    setScanResult(null);
    try {
      const response = await api.post('/staff/checkin', { booking_code: bookingCode.toUpperCase().trim() });
      setScanResult({ success: true, data: response.data });
      toast.success('Check-in successful!');
      setBookingCode('');
      fetchActiveSessions();
      fetchPendingCheckins();
    } catch (error) {
      setScanResult({ success: false, error: error.response?.data?.error || 'Check-in failed' });
      toast.error(error.response?.data?.error || 'Check-in failed');
    } finally { setScanning(false); }
  };

  // Phase 2 — QR scanner: validate first, then explicitly check-in.
  // Accepts a scanned string (qr_token) or manually-typed booking_code.
  const handleQrScan = async (scannedValue) => {
    const value = String(scannedValue || '').trim();
    if (!value) return;
    setQrValidating(true);
    setQrValidation(null);
    try {
      const response = await api.post('/staff/qr/validate', { qr_token: value });
      const payload = response.data || {};
      setQrValidation({
        success: true,
        scanned: value,
        canCheckin: !!payload.can_checkin,
        reasonCode: payload.reason_code,
        message: payload.message,
        booking: payload.booking
      });
    } catch (error) {
      const data = error.response?.data || {};
      setQrValidation({
        success: false,
        scanned: value,
        canCheckin: false,
        reasonCode: data.error_code || 'error',
        message: data.error || 'تعذّر التحقق من الرمز',
        booking: data.booking || null
      });
      toast.error(data.error || 'تعذّر التحقق من الرمز');
    } finally {
      setQrValidating(false);
    }
  };

  const handleQrActivate = async () => {
    if (!qrValidation?.scanned || qrCheckingIn) return;
    // Phase 9 guard — staff must have selected a booking from the queue and
    // the validated QR/code must belong to that exact booking. UI also
    // disables the button under the same conditions; this is defense-in-depth.
    if (!activatingBooking) {
      toast.error('يرجى اختيار حجز من القائمة أولاً');
      return;
    }
    const validatedCode = qrValidation.booking?.booking_code;
    if (!validatedCode || validatedCode !== activatingBooking.booking_code) {
      toast.error('الرمز لا يطابق الحجز المحدد');
      return;
    }
    setQrCheckingIn(true);
    try {
      const response = await api.post('/staff/qr/checkin', { qr_token: qrValidation.scanned });
      const payload = response.data || {};
      setQrValidation({
        success: true,
        scanned: qrValidation.scanned,
        canCheckin: false,
        reasonCode: 'completed',
        message: payload.message || 'تم تفعيل الجلسة بنجاح',
        booking: payload.booking,
        loyalty: payload.loyalty || null,
        activated: true
      });
      toast.success(payload.message || 'تم تفعيل الجلسة بنجاح');
      fetchActiveSessions();
      fetchPendingCheckins();
    } catch (error) {
      const data = error.response?.data || {};
      setQrValidation({
        success: false,
        scanned: qrValidation.scanned,
        canCheckin: false,
        reasonCode: data.error_code || 'error',
        message: data.error || 'فشل تفعيل الجلسة',
        booking: data.booking || qrValidation.booking
      });
      toast.error(data.error || 'فشل تفعيل الجلسة');
    } finally {
      setQrCheckingIn(false);
    }
  };

  // Phase 5 — map backend loyalty skip reasons to Arabic for staff.
  const getLoyaltyReasonText = (reason) => {
    switch (reason) {
      case 'already_awarded':
      case 'already_awarded_marker':
        return 'تم احتساب نقاط هذا الحجز مسبقاً';
      case 'loyalty_disabled':
        return 'نظام نقاط الولاء غير مفعّل حالياً';
      case 'no_user':
        return 'لا يمكن منح النقاط لحجز بدون حساب';
      case 'zero_points':
      case 'not_checked_in':
      case 'missing_reference':
      case 'award_failed':
      case 'not_attempted':
      case 'no_booking':
        return 'الحجز غير مؤهل لنقاط الولاء';
      default:
        return '';
    }
  };

  // Phase 9 — pick a booking from the activation queue to start the
  // QR-first activation flow. Always reset any prior validation state so the
  // staff member starts cleanly on the newly-selected booking.
  const handleSelectActivation = (booking) => {
    setActivatingBooking(booking);
    setQrValidation(null);
  };

  // Phase 9 — leave the per-booking activation panel and return to the queue.
  // Refresh the pending list so just-activated bookings disappear and any
  // active sessions appear in the sessions tab.
  const handleExitActivation = () => {
    setActivatingBooking(null);
    setQrValidation(null);
    fetchPendingCheckins();
    fetchActiveSessions();
  };

  const handleQrReset = () => {
    setQrValidation(null);
    setQrCheckingIn(false);
  };

  const handleChildSearch = async (value) => {
    setChildSearch(value);
    setSelectedChild(null);
    setChildSubscription(null);
    if (value.length < 2) { setSearchResults([]); return; }
    try {
      const response = await api.get(`/staff/search-child?name=${encodeURIComponent(value)}`);
      setSearchResults(response.data.children || []);
    } catch (error) { console.error('Search failed:', error); }
  };

  const handleSelectChild = async (child) => {
    setSelectedChild(child);
    setSearchResults([]);
    setChildSearch(child.name);
    try {
      const response = await api.get(`/staff/subscription/${child.id}`);
      setChildSubscription(response.data.subscription);
    } catch (error) {
      setChildSubscription(null);
      if (error.response?.status !== 404) toast.error('Failed to fetch subscription');
    }
  };

  const handleConsumeVisit = async () => {
    if (!selectedChild) return;
    setConsuming(true);
    try {
      const response = await api.post('/staff/consume-visit', { child_id: selectedChild.id });
      toast.success(`Visit consumed! ${response.data.remaining_visits} visits remaining`);
      const subResponse = await api.get(`/staff/subscription/${selectedChild.id}`);
      setChildSubscription(subResponse.data.subscription);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to consume visit');
    } finally { setConsuming(false); }
  };

  const fetchInboxStats = useCallback(async () => {
    try {
      const response = await api.get('/staff/inbox/stats');
      setInboxStats(response.data);
    } catch (error) { console.error('Failed to fetch inbox stats:', error); }
  }, [api]);

  const fetchConversations = useCallback(async (isInitialLoad = false) => {
    try {
      if (isInitialLoad) setInboxLoading(true);
      const params = new URLSearchParams();
      if (inboxSearch) params.append('search', inboxSearch);
      if (showUnreadOnly) params.append('unread_only', 'true');
      const response = await api.get(`/staff/inbox/conversations?${params}`);
      setConversations(response.data.conversations || []);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      toast.error(getApiErrorMessage(error, 'فشل تحميل المحادثات'));
    } finally { if (isInitialLoad) setInboxLoading(false); }
  }, [api, inboxSearch, showUnreadOnly]);

  const fetchMessages = useCallback(async (waId) => {
    try {
      const response = await api.get(`/staff/inbox/messages/${waId}`);
      setMessages(response.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      toast.error(getApiErrorMessage(error, 'فشل تحميل الرسائل'));
    }
  }, [api]);

  const fetchCustomerProfile = useCallback(async (waId) => {
    try {
      const response = await api.get(`/staff/inbox/customer-profile/${waId}`);
      setCustomerProfile(response.data);
    } catch (error) { console.error('Failed to fetch customer profile:', error); }
  }, [api]);

  const fetchQuickReplies = useCallback(async () => {
    try {
      const response = await api.get('/staff/inbox/quick-replies?platform=whatsapp');
      setQuickReplies(response.data.quick_replies || []);
    } catch (error) { console.error('Failed to fetch quick replies:', error); }
  }, [api]);

  const fetchTemplates = useCallback(async () => {
    try {
      const response = await api.get('/templates?status=approved&limit=50');
      setTemplates(response.data.templates || []);
    } catch (error) { console.error('Failed to fetch templates:', error); }
  }, [api]);

  const fetchAutoReplyConfig = useCallback(async () => {
    if (user?.role !== 'admin') return;
    setLoadingAgentMode(true);
    try {
      const response = await api.get('/admin/whatsapp-auto-reply');
      setAutoReplyConfig(response.data?.config || null);
    } catch (error) {
      console.error('Failed to fetch WhatsApp auto-reply config:', error);
      toast.error(getApiErrorMessage(error, 'فشل تحميل وضع الوكيل'));
    } finally {
      setLoadingAgentMode(false);
    }
  }, [api, user?.role]);

  const handleSwitchAgentMode = async (enabled) => {
    if (user?.role !== 'admin' || !autoReplyConfig) return;
    setSavingAgentMode(true);
    try {
      const payload = {
        ...autoReplyConfig,
        enabled,
        cooldownMinutes: Number(autoReplyConfig.cooldownMinutes || 30),
        useAiFallback: Boolean(autoReplyConfig.useAiFallback),
        aiConfidenceThreshold: Number(autoReplyConfig.aiConfidenceThreshold ?? 0.7),
        aiMaxReplyChars: Number(autoReplyConfig.aiMaxReplyChars || 500)
      };
      const response = await api.put('/admin/whatsapp-auto-reply', payload);
      setAutoReplyConfig(response.data?.config || payload);
      toast.success(enabled ? 'تم التحويل إلى الوكيل الذكي' : 'تم التحويل إلى الوكيل البشري');
    } catch (error) {
      console.error('Failed to switch agent mode:', error);
      toast.error(getApiErrorMessage(error, 'فشل تغيير وضع الوكيل'));
    } finally {
      setSavingAgentMode(false);
    }
  };

  const handleConversationSelect = (conv) => {
    setConversations(prev => prev.map(c => c.wa_id === conv.wa_id ? { ...c, unread_count: 0 } : c));
    autoScrollEnabledRef.current = true;
    setSelectedConversation(conv);
    setMessages([]);
    setCustomerProfile(null);
    setMobileShowThread(true);
    fetchMessages(conv.wa_id);
    fetchCustomerProfile(conv.wa_id);
  };

  const handleSendMessage = async () => {
    if (!replyText.trim() || !selectedConversation) return;
    setSending(true);
    try {
      await api.post('/staff/inbox/send', { wa_id: selectedConversation.wa_id, message: replyText });
      toast.success('تم إرسال الرسالة');
      setReplyText('');
      await fetchMessages(selectedConversation.wa_id);
      await fetchConversations(false);
      await fetchInboxStats();
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error(getApiErrorMessage(error, 'فشل إرسال الرسالة'));
    } finally { setSending(false); }
  };

  const handleQuickReplySelect = (quickReply) => {
    setReplyText(quickReply.message);
    setShowQuickReplies(false);
    api.post(`/staff/inbox/quick-replies/${quickReply.id}/use`).catch(console.error);
  };

  const handleSaveQuickReply = async () => {
    setQrSaving(true);
    try {
      if (qrEditId) {
        await api.put(`/staff/inbox/quick-replies/${qrEditId}`, qrForm);
      } else {
        await api.post('/staff/inbox/quick-replies', { ...qrForm, platform: 'whatsapp' });
      }
      await fetchQuickReplies();
      setQrForm({ label: '', message: '', category: 'other' });
      setQrEditId(null);
      toast.success('تم حفظ الرد السريع');
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل حفظ الرد السريع'));
    } finally { setQrSaving(false); }
  };

  const handleEditQuickReply = (qr) => {
    setQrEditId(qr.id);
    setQrForm({ label: qr.label, message: qr.message, category: qr.category });
    setShowQRManager(true);
  };

  const handleDeleteQuickReply = async (id) => {
    try {
      await api.delete(`/staff/inbox/quick-replies/${id}`);
      await fetchQuickReplies();
      toast.success('تم حذف الرد السريع');
    } catch (error) { toast.error(getApiErrorMessage(error, 'فشل حذف الرد السريع')); }
  };

  const handleSaveLabel = async () => {
    if (!selectedConversation || !labelInput.trim()) return;
    setSavingLabel(true);
    try {
      await api.post('/staff/inbox/contact-label', {
        wa_id: selectedConversation.wa_id,
        label: labelInput.trim()
      });
      toast.success('تم حفظ الاسم');
      setLabelInput('');
      await fetchConversations(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل حفظ الاسم'));
    } finally {
      setSavingLabel(false);
    }
  };

  const handleToggleOptOut = async (optOut) => {
    if (!selectedConversation) return;
    setTogglingOptOut(true);
    try {
      await api.post('/staff/inbox/opt-out', {
        wa_id: selectedConversation.wa_id,
        opt_out: optOut
      });
      toast.success(optOut ? 'تم إيقاف الرسائل التسويقية' : 'تم تفعيل الرسائل التسويقية');
      await fetchCustomerProfile(selectedConversation.wa_id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تحديث حالة الاشتراك');
    } finally {
      setTogglingOptOut(false);
    }
  };

  const handleRecordMarketingConsent = async () => {
    if (!selectedConversation) return;
    if (!window.confirm('هل تؤكد أن العميل وافق صراحةً على استلام الرسائل التسويقية عبر واتساب؟ سيتم تسجيل الموافقة مع التاريخ والمصدر.')) return;
    setTogglingOptOut(true);
    try {
      await api.post('/staff/inbox/opt-in', {
        wa_id: selectedConversation.wa_id
      });
      toast.success('تم تسجيل الموافقة التسويقية');
      await fetchCustomerProfile(selectedConversation.wa_id);
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل تسجيل الموافقة');
    } finally {
      setTogglingOptOut(false);
    }
  };

  const handleStartConversation = async () => {
    if (!newChatPhone.trim() || !newChatMessage.trim()) return;
    setStartingChat(true);
    try {
      await api.post('/staff/inbox/start-conversation', {
        wa_id: newChatPhone.trim(),
        message: newChatMessage.trim()
      });
      toast.success('تم إرسال الرسالة');
      setNewChatPhone('');
      setNewChatMessage('');
      setShowNewChat(false);
      await fetchConversations(false);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل بدء المحادثة'));
    } finally {
      setStartingChat(false);
    }
  };

  const handleSendTemplate = async (template) => {
    if (!selectedConversation) return;
    setSendingTemplate(true);
    try {
      await api.post('/staff/inbox/send-template', {
        wa_id: selectedConversation.wa_id,
        template_name: template.name,
        language_code: template.language || 'ar',
        components: []
      });
      toast.success(`تم إرسال القالب: ${template.name}`);
      setShowTemplatePicker(false);
      await fetchMessages(selectedConversation.wa_id);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'فشل إرسال القالب'));
    } finally { setSendingTemplate(false); }
  };

  const compressImage = (file, maxSizeMB = 4) => {
    return new Promise((resolve) => {
      const maxBytes = maxSizeMB * 1024 * 1024;
      if (file.size <= maxBytes) {
        resolve(file);
        return;
      }
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const canvas = document.createElement('canvas');
        let { width, height } = img;
        const MAX_DIM = 1920;
        if (width > MAX_DIM || height > MAX_DIM) {
          if (width > height) {
            height = Math.round(height * MAX_DIM / width);
            width = MAX_DIM;
          } else {
            width = Math.round(width * MAX_DIM / height);
            height = MAX_DIM;
          }
        }
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        let quality = 0.85;
        const tryCompress = () => {
          canvas.toBlob((blob) => {
            if (!blob) { resolve(file); return; }
            if (blob.size <= maxBytes || quality <= 0.4) {
              const compressed = new File([blob], file.name.replace(/\.[^.]+$/, '.jpg'), { type: 'image/jpeg' });
              resolve(compressed);
            } else {
              quality -= 0.1;
              tryCompress();
            }
          }, 'image/jpeg', quality);
        };
        tryCompress();
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  };

  const handleMediaSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/3gpp', 'video/quicktime'];
    if (files.some((file) => !allowedTypes.includes(file.type))) {
      toast.error('يسمح فقط بملفات الصور (JPG/PNG/WEBP) أو الفيديو (MP4/MOV/3GPP)');
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }
    setMediaFiles(files);
    const previews = files.map((file) => ({
      file,
      url: URL.createObjectURL(file),
      type: file.type.startsWith('video/') ? 'video' : 'image'
    }));
    setMediaPreview(previews);
  };

  const handleSendMedia = async () => {
    const files = Array.isArray(mediaFiles) ? mediaFiles : mediaFiles ? [mediaFiles] : [];
    if (!files.length || !selectedConversation) return;
    setSendingMedia(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        const isImage = file.type.startsWith('image/');
        const finalFile = isImage ? await compressImage(file) : file;
        formData.append(isImage ? 'image' : 'video', finalFile);
        formData.append('wa_id', selectedConversation.wa_id);
        if (i === 0 && replyText.trim()) formData.append('caption', replyText.trim());
        await api.post(isImage ? '/staff/inbox/send-image' : '/staff/inbox/send-video', formData);
      }
      toast.success(files.length > 1 ? `تم إرسال ${files.length} ملفات` : 'تم إرسال الملف');
      setMediaFiles([]);
      setMediaPreview([]);
      setReplyText('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      await fetchMessages(selectedConversation.wa_id);
    } catch (error) {
      const errMsg = error.response?.data?.error || error.response?.data?.details || 'فشل إرسال المرفق';
      toast.error(errMsg);
    } finally { setSendingMedia(false); }
  };

  const handleMessagesScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    autoScrollEnabledRef.current = distanceFromBottom <= 120;
  }, []);

  useEffect(() => {
    const currentConversationWaId = selectedConversation?.wa_id || null;
    const isConversationChanged = previousConversationWaIdRef.current !== currentConversationWaId;
    const hasNewMessages = messages.length > previousMessageCountRef.current;

    if (isConversationChanged) {
      autoScrollEnabledRef.current = true;
    }

    if (autoScrollEnabledRef.current && (isConversationChanged || hasNewMessages)) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
    }

    previousMessageCountRef.current = messages.length;
    previousConversationWaIdRef.current = currentConversationWaId;
  }, [messages, selectedConversation?.wa_id]);

  useEffect(() => {
    if (activeTab === 'inbox' && staffPermissions.access_whatsapp_inbox) {
      fetchInboxStats();
      fetchConversations(true);
      fetchQuickReplies();
      fetchTemplates();
      fetchAutoReplyConfig();
      const convParams = new URLSearchParams();
      if (inboxSearch) convParams.append('search', inboxSearch);
      if (showUnreadOnly) convParams.append('unread_only', 'true');

      const conversationsStream = createAuthedEventSource(`/api/staff/inbox/stream/conversations?${convParams.toString()}`);
      const statsStream = createAuthedEventSource('/api/staff/inbox/stream/stats');
      const messagesStream = selectedConversation
        ? createAuthedEventSource(`/api/staff/inbox/stream/messages/${selectedConversation.wa_id}`)
        : null;

      conversationsStream?.addEventListener('conversations', (event) => {
        try {
          const payload = JSON.parse(event.data);
          setConversations(payload.conversations || []);
        } catch (error) {
          console.error('Failed to parse conversations stream:', error);
        }
      });
      statsStream?.addEventListener('stats', (event) => {
        try {
          setInboxStats(JSON.parse(event.data));
        } catch (error) {
          console.error('Failed to parse stats stream:', error);
        }
      });
      messagesStream?.addEventListener('messages', (event) => {
        try {
          const payload = JSON.parse(event.data);
          setMessages(payload.messages || []);
        } catch (error) {
          console.error('Failed to parse messages stream:', error);
        }
      });

      return () => {
        conversationsStream?.close();
        statsStream?.close();
        messagesStream?.close();
      };
    }
    return undefined;
  }, [
    activeTab,
    staffPermissions.access_whatsapp_inbox,
    fetchInboxStats,
    fetchConversations,
    fetchQuickReplies,
    fetchTemplates,
    fetchAutoReplyConfig,
    selectedConversation,
    createAuthedEventSource,
    inboxSearch,
    showUnreadOnly
  ]);

  const fetchCampaigns = useCallback(async () => {
    setCampaignsLoading(true);
    try {
      const response = await api.get('/staff/campaigns');
      setCampaigns(response.data.campaigns || []);
    } catch (error) { console.error('Failed to fetch campaigns:', error); }
    finally { setCampaignsLoading(false); }
  }, [api]);

  const handleCreateCampaign = async () => {
    setCampaignSaving(true);
    try {
      const payload = {
        name: campaignForm.name,
        message_type: campaignForm.message_type,
        audience_filters: campaignForm.audience_filters,
        ...(campaignForm.message_type === 'free_form'
          ? { free_form_message: campaignForm.free_form_message }
          : {
              template_name: campaignForm.template_name,
              template_language: campaignForm.template_language,
              ...(campaignForm.ttl_hours ? { ttl_hours: parseInt(campaignForm.ttl_hours) } : {})
            }
        )
      };
      await api.post('/staff/campaigns', payload);
      toast.success('تم إنشاء الحملة');
      setCampaignForm(CAMPAIGN_FORM_INITIAL);
      setShowCampaignForm(false);
      setAudiencePreview(null);
      await fetchCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إنشاء الحملة');
    } finally { setCampaignSaving(false); }
  };

  const fetchAudiencePreview = async () => {
    setPreviewLoading(true);
    try {
      const params = new URLSearchParams();
      if (campaignForm.audience_filters.has_booking) params.append('has_booking', 'true');
      if (campaignForm.audience_filters.has_active_subscription) params.append('has_active_subscription', 'true');
      if (campaignForm.audience_filters.last_message_after) params.append('last_message_after', campaignForm.audience_filters.last_message_after);
      if (campaignForm.audience_filters.last_message_before) params.append('last_message_before', campaignForm.audience_filters.last_message_before);
      const response = await api.get(`/staff/campaigns/preview?${params}`);
      setAudiencePreview(response.data.estimated_recipients);
      setAudienceCostEstimate(response.data.estimated_cost_jod);
    } catch (error) {
      console.error('Preview failed:', error);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleExecuteCampaign = async (id) => {
    setExecutingId(id);
    try {
      const response = await api.post(`/staff/campaigns/${id}/execute`);
      toast.success(`تم إطلاق الحملة · ${response.data.recipient_count} مستلم`);
      await fetchCampaigns();
    } catch (error) {
      toast.error(error.response?.data?.error || 'فشل إطلاق الحملة');
    } finally { setExecutingId(null); }
  };

  const handlePauseCampaign = async (id) => {
    setPausingId(id);
    try {
      await api.post(`/staff/campaigns/${id}/pause`);
      toast.success('تم إيقاف الحملة');
      await fetchCampaigns();
    } catch (error) {
      toast.error('فشل إيقاف الحملة');
    } finally { setPausingId(null); }
  };

  const handleToggleCampaignStats = async (id) => {
    if (expandedCampaignId === id) { setExpandedCampaignId(null); return; }
    setExpandedCampaignId(id);
    setLoadingRecipientsId(id);
    try {
      const [statsResponse, recipientsResponse] = await Promise.all([
        api.get(`/staff/campaigns/${id}/stats`),
        api.get(`/staff/campaigns/${id}/recipients`)
      ]);
      setCampaignStats(prev => ({ ...prev, [id]: statsResponse.data.stats }));
      setCampaignRecipients(prev => ({
        ...prev,
        [id]: recipientsResponse.data
      }));
    } catch (error) { console.error('Failed to fetch campaign stats:', error); }
    finally { setLoadingRecipientsId(null); }
  };

  const handleRemoveRecipientFromCampaign = async (campaignId, waId) => {
    const key = `${campaignId}:${waId}`;
    setRemovingRecipientKey(key);
    try {
      await api.delete(`/staff/campaigns/${campaignId}/recipients/${encodeURIComponent(waId)}`);
      toast.success('تم استبعاد الرقم من الحملة');
      const recipientsResponse = await api.get(`/staff/campaigns/${campaignId}/recipients`);
      setCampaignRecipients(prev => ({
        ...prev,
        [campaignId]: recipientsResponse.data
      }));
    } catch (error) {
      toast.error(error.response?.data?.error || 'تعذر استبعاد الرقم من الحملة');
    } finally {
      setRemovingRecipientKey('');
    }
  };

  useEffect(() => {
    if (activeTab === 'campaigns' && staffPermissions.access_whatsapp_campaigns) fetchCampaigns();
  }, [activeTab, fetchCampaigns, staffPermissions.access_whatsapp_campaigns]);

  // Fetch approved templates for bulk send
  const fetchApprovedTemplates = useCallback(async () => {
    try {
      const response = await api.get('/templates?status=approved&limit=100');
      setApprovedTemplates(response.data.templates || []);
    } catch (err) { console.error('Failed to fetch approved templates:', err); }
  }, [api]);

  const [syncingTemplates, setSyncingTemplates] = useState(false);
  const handleSyncTemplates = async () => {
    setSyncingTemplates(true);
    try {
      const response = await api.post('/templates/sync');
      const synced = response.data.synced_count || 0;
      toast.success(`تمت مزامنة ${synced} قالب من Meta`);
      await fetchApprovedTemplates();
    } catch (err) {
      toast.error(err.response?.data?.error || 'فشلت مزامنة القوالب');
    } finally { setSyncingTemplates(false); }
  };

  useEffect(() => {
    if (showBulkSend && approvedTemplates.length === 0) fetchApprovedTemplates();
  }, [showBulkSend, approvedTemplates.length, fetchApprovedTemplates]);

  const handleBulkSend = async () => {
    if (!bulkTemplateName.trim()) { toast.error('اسم القالب مطلوب'); return; }
    const phoneLines = bulkPhones.split('\n').map(l => l.trim()).filter(Boolean);
    if (phoneLines.length === 0) { toast.error('أدخل أرقام الهواتف'); return; }
    if (phoneLines.length > 1000) { toast.error('الحد الأقصى 1000 رقم لكل إرسال'); return; }

    // Build components payload from variable inputs or advanced JSON
    let parsedComponents = [];
    if (showBulkAdvanced && bulkAdvancedJson.trim()) {
      try { parsedComponents = JSON.parse(bulkAdvancedJson); }
      catch { toast.error('صيغة JSON غير صحيحة لمعلمات القالب'); return; }
    } else {
      const selectedTpl = approvedTemplates.find(t => t.name === bulkTemplateName.trim());
      let vars = selectedTpl?.variables || [];
      // Fallback: detect {N} or {{N}} placeholders from body_text
      if (vars.length === 0 && selectedTpl?.body_text) {
        const matches = selectedTpl.body_text.match(/\{\{?\d+\}?\}/g);
        if (matches) {
          const indices = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''), 10)))].sort((a, b) => a - b);
          vars = indices.map(n => ({ name: `var_${n}` }));
        }
      }
      const filledVars = vars.map((v, idx) => (bulkVarValues[idx] || '').trim()).filter(Boolean);
      if (filledVars.length > 0) {
        parsedComponents = [{ type: 'body', parameters: filledVars.map(text => ({ type: 'text', text })) }];
      }
      // Add header image component if URL provided
      if (bulkHeaderImageUrl.trim()) {
        parsedComponents.unshift({ type: 'header', parameters: [{ type: 'image', image: { link: bulkHeaderImageUrl.trim() } }] });
      }
    }

    if (!window.confirm(`هل تريد إرسال القالب "${bulkTemplateName}" إلى ${phoneLines.length} مستلم؟`)) return;

    setBulkSending(true);
    setBulkResults(null);
    try {
      const response = await api.post('/staff/campaigns/bulk-send', {
        template_name: bulkTemplateName.trim(),
        language_code: bulkLanguageCode || 'ar',
        components: parsedComponents,
        ttl_hours: bulkTtlHours ? Number(bulkTtlHours) : undefined,
        recipients: phoneLines
      }, { timeout: 600000 });
      setBulkResults(response.data);
      toast.success(`تم الإرسال: ${response.data.summary?.sent || 0} من ${response.data.summary?.total || 0}`);
    } catch (error) {
      const errMsg = error.response?.data?.error || error.message || 'فشل الإرسال الجماعي';
      toast.error(errMsg);
      if (error.response?.data?.results) setBulkResults(error.response.data);
    } finally { setBulkSending(false); }
  };

  const statusBadgeClass = (status) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-700';
      case 'running': return 'bg-blue-100 text-blue-700 animate-pulse';
      case 'completed': return 'bg-green-100 text-green-700';
      case 'failed': return 'bg-red-100 text-red-700';
      case 'paused': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-700';
    }
  };

  const statusLabel = (status) => {
    const map = { draft: 'مسودة', running: 'جارية', completed: 'مكتملة', failed: 'فشلت', paused: 'موقوفة' };
    return map[status] || status;
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="h-12 w-12 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <DashboardLayout
      title="Staff Panel"
      logoSrc={logoImg}
      navItems={navItems}
      mobileNavItems={mobileNavItems}
      activeTab={activeTab}
      onTabChange={setActiveTab}
      onLogout={handleLogout}
      headerActions={
        <div className="flex items-center gap-2">
          <InstallPWAButton />
          {allowedTabs.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              className="rounded-full gap-2"
              data-testid="staff-refresh-btn"
            >
              <RefreshCw className="h-4 w-4" />
              <span className="hidden sm:inline">تحديث</span>
            </Button>
          )}
        </div>
      }
    >
      <div className="max-w-6xl mx-auto w-full">
        {allowedTabs.length === 0 && (
          <Card className="rounded-2xl">
            <CardContent className="py-10 text-center text-muted-foreground">
              لا يوجد لديك صلاحيات وصول حالياً. الرجاء التواصل مع الإدارة.
            </CardContent>
          </Card>
        )}

        {allowedTabs.length > 0 && (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsContent value="scanner">
            {/* Phase 9 — QR-first session activation. The pending bookings
                list IS the activation queue. Selecting a booking opens a
                dedicated activation panel that gates the "Activate Session"
                button on a successful QR/code validation that belongs to
                the selected booking. */}
            {!activatingBooking ? (
              /* ───── Activation queue (no booking selected yet) ───── */
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="font-heading flex items-center gap-2">
                    <QrCode className="h-5 w-5 text-primary" /> تفعيل الجلسات
                  </CardTitle>
                  <CardDescription>
                    اختر حجزاً من قائمة الحجوزات بانتظار التفعيل لإكمال التحقق وتفعيل الجلسة
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div
                    className="mb-4 flex items-start gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-sm text-blue-900"
                    data-testid="activation-rule-banner"
                  >
                    <AlertTriangle className="h-4 w-4 flex-shrink-0 mt-0.5" />
                    <span>يجب التحقق من رمز QR أو رمز الحجز قبل تفعيل أي جلسة.</span>
                  </div>
                  <h3 className="font-heading font-bold mb-2">الحجوزات بانتظار التفعيل</h3>
                  {pendingCheckins.length === 0 ? (
                    <div
                      className="text-center py-12 text-muted-foreground"
                      data-testid="activation-queue-empty"
                    >
                      <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
                      <p>لا توجد حجوزات بانتظار التفعيل</p>
                    </div>
                  ) : (
                    <div className="space-y-3" data-testid="activation-queue">
                      {pendingCheckins.map((booking) => (
                        <button
                          key={booking.id}
                          type="button"
                          onClick={() => handleSelectActivation(booking)}
                          className="w-full text-right flex items-center justify-between gap-3 p-4 rounded-2xl border-2 border-transparent bg-muted/50 hover:bg-muted hover:border-primary/40 active:scale-[0.99] transition"
                          data-testid={`activation-queue-item-${booking.booking_code}`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-base truncate">{booking.child_name}</p>
                            <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                              <Clock className="h-3.5 w-3.5" /> {booking.slot_time || '—'}
                            </p>
                            <code className="text-xs bg-white px-2 py-0.5 rounded mt-1 inline-block">
                              {booking.booking_code}
                            </code>
                          </div>
                          <div className="flex flex-col items-end gap-1 flex-shrink-0">
                            <span
                              className={`text-xs px-2 py-1 rounded-full font-semibold ${
                                booking.qr_status === 'unused'
                                  ? 'bg-blue-100 text-blue-700'
                                  : booking.qr_status === 'checked_in'
                                    ? 'bg-green-100 text-green-700'
                                    : booking.qr_status === 'cancelled'
                                      ? 'bg-red-100 text-red-700'
                                      : 'bg-slate-100 text-slate-600'
                              }`}
                              data-testid={`activation-queue-status-${booking.booking_code}`}
                            >
                              {booking.qr_status === 'unused' && 'بانتظار التفعيل'}
                              {booking.qr_status === 'checked_in' && 'تم التفعيل'}
                              {booking.qr_status === 'cancelled' && 'ملغي'}
                              {booking.qr_status === 'expired' && 'منتهي'}
                              {!['unused', 'checked_in', 'cancelled', 'expired'].includes(booking.qr_status) &&
                                (booking.qr_status || '—')}
                            </span>
                            <span className="text-xs text-primary font-semibold">ابدأ التفعيل ←</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            ) : (
              /* ───── Per-booking activation panel ───── */
              <Card className="rounded-2xl" data-testid="activation-panel">
                <CardHeader>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <CardTitle className="font-heading flex items-center gap-2">
                        <QrCode className="h-5 w-5 text-primary" />
                        تفعيل جلسة: {activatingBooking.child_name}
                      </CardTitle>
                      <CardDescription>
                        يجب التحقق من رمز QR أو رمز الحجز قبل تفعيل الجلسة
                      </CardDescription>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={handleExitActivation}
                      className="flex-shrink-0"
                      data-testid="activation-back-btn"
                    >
                      ← العودة
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Selected booking summary */}
                  <div
                    className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-sm space-y-1"
                    data-testid="activation-selected-booking"
                  >
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">رمز الحجز:</span>
                      <code className="font-mono bg-white px-2 py-0.5 rounded">
                        {activatingBooking.booking_code}
                      </code>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">اسم الطفل:</span>
                      <span className="font-semibold">{activatingBooking.child_name}</span>
                    </div>
                    <div className="flex justify-between gap-4">
                      <span className="text-muted-foreground">الوقت:</span>
                      <span>{activatingBooking.slot_time || '—'}</span>
                    </div>
                  </div>

                  {/* Verification step (only until activation succeeds) */}
                  {!qrValidation?.activated && (
                    <>
                      <div className="flex items-center gap-2 pt-1">
                        <QrCode className="h-4 w-4 text-primary" />
                        <h3 className="font-heading text-sm font-bold">التحقق من رمز الحجز</h3>
                      </div>
                      <QrScanner onScan={handleQrScan} busy={qrValidating} />

                      {/* Validation feedback */}
                      {qrValidation && (() => {
                        const matched =
                          qrValidation.canCheckin &&
                          qrValidation.booking?.booking_code === activatingBooking.booking_code;
                        const wrongBooking =
                          qrValidation.canCheckin &&
                          qrValidation.booking?.booking_code &&
                          qrValidation.booking.booking_code !== activatingBooking.booking_code;
                        return (
                          <div
                            className={`rounded-xl border-2 p-3 ${
                              matched
                                ? 'bg-green-50 border-green-300'
                                : 'bg-red-50 border-red-300'
                            }`}
                            data-testid="qr-validation-result"
                          >
                            <div className="flex items-start gap-2">
                              {matched ? (
                                <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
                              ) : (
                                <XCircle className="h-5 w-5 text-red-600 flex-shrink-0" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p
                                  className={`font-bold text-sm ${
                                    matched ? 'text-green-700' : 'text-red-700'
                                  }`}
                                  data-testid="qr-validation-message"
                                >
                                  {matched
                                    ? 'تم التحقق من الرمز ✓'
                                    : wrongBooking
                                      ? 'الرمز لا يطابق الحجز المحدد'
                                      : qrValidation.message || 'الرمز غير صالح'}
                                </p>
                                {wrongBooking && (
                                  <p className="text-xs text-red-700 mt-1">
                                    الرمز الممسوح يخص:{' '}
                                    <code className="font-mono bg-white px-1 rounded">
                                      {qrValidation.booking.booking_code}
                                    </code>
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {/* Activation success message */}
                  {qrValidation?.activated && (
                    <div
                      className="rounded-xl border-2 border-green-300 bg-green-50 p-4 flex items-start gap-3"
                      data-testid="activation-success"
                    >
                      <CheckCircle className="h-6 w-6 text-green-600 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-green-700">
                          {qrValidation.message || 'تم تفعيل الجلسة بنجاح'}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Phase 5 — loyalty award result (only after a successful activation) */}
                  {qrValidation?.activated && qrValidation.loyalty && (
                    <div
                      className={`rounded-xl border p-3 flex items-start gap-3 ${
                        qrValidation.loyalty.awarded
                          ? 'bg-amber-50 border-amber-300'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                      data-testid="qr-loyalty-result"
                    >
                      <Gift
                        className={`h-6 w-6 flex-shrink-0 ${
                          qrValidation.loyalty.awarded ? 'text-amber-600' : 'text-slate-500'
                        }`}
                      />
                      <div className="flex-1 min-w-0">
                        <p
                          className={`font-bold text-sm ${
                            qrValidation.loyalty.awarded ? 'text-amber-700' : 'text-slate-700'
                          }`}
                          data-testid="qr-loyalty-message"
                        >
                          {qrValidation.loyalty.awarded
                            ? `تمت إضافة ${qrValidation.loyalty.points} نقاط ولاء`
                            : 'لم يتم إضافة نقاط ولاء'}
                        </p>
                        {!qrValidation.loyalty.awarded && getLoyaltyReasonText(qrValidation.loyalty.reason) && (
                          <p className="text-xs text-slate-600 mt-0.5" data-testid="qr-loyalty-reason">
                            {getLoyaltyReasonText(qrValidation.loyalty.reason)}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Action buttons */}
                  <div className="flex gap-2 pt-1">
                    {!qrValidation?.activated ? (
                      <>
                        <Button
                          onClick={handleQrActivate}
                          disabled={
                            qrCheckingIn ||
                            !qrValidation?.canCheckin ||
                            qrValidation.booking?.booking_code !== activatingBooking.booking_code
                          }
                          className="flex-1 rounded-full h-12 bg-green-600 hover:bg-green-700"
                          data-testid="qr-activate-btn"
                        >
                          {qrCheckingIn ? (
                            <Loader2 className="h-5 w-5 ml-2 animate-spin" />
                          ) : (
                            <CheckCircle className="h-5 w-5 ml-2" />
                          )}
                          تفعيل الجلسة
                        </Button>
                        {qrValidation && (
                          <Button
                            variant="outline"
                            onClick={handleQrReset}
                            className="rounded-full h-12 px-4"
                            data-testid="qr-reset-btn"
                          >
                            مسح آخر
                          </Button>
                        )}
                      </>
                    ) : (
                      <Button
                        onClick={handleExitActivation}
                        className="flex-1 rounded-full h-12"
                        data-testid="activation-done-btn"
                      >
                        العودة إلى القائمة
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="sessions">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> الجلسات النشطة</CardTitle>
                <CardDescription>الأطفال الموجودون حاليًا — الوقت المتبقي لكل جلسة</CardDescription>
              </CardHeader>
              <CardContent>
                {activeSessions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-12">لا توجد جلسات نشطة حالياً</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeSessions.map((session) => (
                      <Card key={session.id} className={`rounded-xl ${session.warning ? 'border-2 border-destructive' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold">{session.child_name}</p>
                              <p className="text-sm text-muted-foreground">بدأت: {session.slot_time}</p>
                            </div>
                            <div className={`text-right ${session.warning ? 'text-destructive' : ''}`}>
                              <p className="text-2xl font-bold">{session.remaining_minutes}</p>
                              <p className="text-xs">دقيقة متبقية</p>
                            </div>
                          </div>
                          {session.warning && (
                            <div className="flex items-center gap-1 text-destructive mt-2 text-sm">
                              <AlertTriangle className="h-4 w-4" /> الجلسة على وشك الانتهاء!
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="subscriptions">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2"><Star className="h-5 w-5 text-secondary" /> Subscription Visit Consumption</CardTitle>
                <CardDescription>Search for a child and consume a subscription visit</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label>Search Child by Name</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input value={childSearch} onChange={(e) => handleChildSearch(e.target.value)} placeholder="Type child's name..." className="pl-10 rounded-xl h-12" data-testid="child-search-input" />
                  </div>
                  {searchResults.length > 0 && (
                    <div className="mt-2 border rounded-xl overflow-hidden">
                      {searchResults.map((child) => (
                        <button key={child.id} onClick={() => handleSelectChild(child)} className="w-full px-4 py-3 text-left hover:bg-muted transition-colors border-b last:border-b-0">{child.name}</button>
                      ))}
                    </div>
                  )}
                </div>
                {selectedChild && (
                  <div className="p-4 rounded-xl bg-muted/50">
                    <p className="font-semibold mb-2">Selected: {selectedChild.name}</p>
                    {childSubscription ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-4 text-sm">
                          <div><p className="text-muted-foreground">Plan</p><p className="font-semibold">{childSubscription.plan_name}</p></div>
                          <div><p className="text-muted-foreground">Status</p>
                            <Badge className={childSubscription.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                              {childSubscription.status === 'pending' ? 'Not activated' : childSubscription.status}
                            </Badge>
                          </div>
                          <div><p className="text-muted-foreground">Remaining</p><p className="font-semibold text-2xl text-secondary">{childSubscription.remaining_visits}</p></div>
                          <div><p className="text-muted-foreground">Expires</p><p className="font-semibold">{childSubscription.expires_at ? new Date(childSubscription.expires_at).toLocaleDateString() : 'After first use'}</p></div>
                        </div>
                        <Button onClick={handleConsumeVisit} disabled={consuming || childSubscription.remaining_visits === 0} className="w-full rounded-full bg-secondary hover:bg-secondary/90" data-testid="consume-visit-btn">
                          {consuming ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <Star className="h-5 w-5 mr-2" />}
                          Consume 1 Visit
                        </Button>
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No active subscription found for this child</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="birthdays">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2"><Cake className="h-5 w-5 text-accent" /> Today's Birthday Parties</CardTitle>
                <CardDescription>Read-only view of scheduled parties</CardDescription>
              </CardHeader>
              <CardContent>
                {todayParties.length === 0 ? (
                  <p className="text-muted-foreground text-center py-12">No birthday parties scheduled today</p>
                ) : (
                  <div className="space-y-4">
                    {todayParties.map((party) => (
                      <Card key={party.id} className="rounded-xl border-accent/30">
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <div className="flex items-center gap-2">
                                <p className="font-semibold text-lg">{party.child_name}'s Party</p>
                                <Badge className={party.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}>{party.status.replace('_', ' ')}</Badge>
                              </div>
                              <p className="text-muted-foreground">Theme: {party.theme}</p>
                              <p className="text-sm text-muted-foreground">Guests: {party.guest_count}</p>
                              {party.special_notes && <p className="text-sm text-accent mt-2">Notes: {party.special_notes}</p>}
                            </div>
                            <div className="text-right">
                              <p className="text-2xl font-heading font-bold">{party.slot_time}</p>
                              <p className="text-sm text-muted-foreground">2 hour duration</p>
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

          <TabsContent value="inbox" className="min-h-0">
            <div className="staff-page-inbox-shell grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 h-[calc(100dvh-190px)] sm:h-[calc(100dvh-210px)] lg:h-[calc(100dvh-185px)] min-h-[560px] max-h-[980px]">
              <div className={`lg:col-span-5 xl:col-span-4 2xl:col-span-3 flex flex-col min-h-0 ${mobileShowThread ? 'hidden lg:flex' : 'flex'}`}>
                <div className="rounded-2xl border bg-white shadow-sm flex-1 flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b bg-gradient-to-r from-[#66A9E9]/10 to-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#66A9E9] flex items-center justify-center"><MessageSquare className="h-4 w-4 text-white" /></div>
                      <span className="font-semibold text-sm">Conversations</span>
                      {inboxStats?.unread_messages > 0 && <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#D9232E] text-white text-xs font-bold pulse-badge">{inboxStats.unread_messages}</span>}
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => setShowNewChat(!showNewChat)}
                        className="w-7 h-7 rounded-full hover:bg-[#66A9E9]/10 flex items-center justify-center transition-colors"
                        title="محادثة جديدة"
                      >
                        <Plus className="h-4 w-4 text-[#66A9E9]" />
                      </button>
                      <button onClick={() => { fetchConversations(); fetchInboxStats(); }} className="w-7 h-7 rounded-full hover:bg-[#66A9E9]/10 flex items-center justify-center transition-colors">
                        <RefreshCw className="h-4 w-4 text-[#66A9E9]" />
                      </button>
                    </div>
                  </div>
                  {showNewChat && (
                    <div className="px-3 py-2 space-y-2 border-b bg-blue-50">
                      <p className="text-xs font-semibold text-[#3a7fc1]">محادثة جديدة</p>
                      <input
                        value={newChatPhone}
                        onChange={(e) => setNewChatPhone(e.target.value)}
                        placeholder="رقم الهاتف (مثال: 962791234567)"
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-[#66A9E9]"
                      />
                      <textarea
                        value={newChatMessage}
                        onChange={(e) => setNewChatMessage(e.target.value)}
                        placeholder="نص الرسالة..."
                        rows={2}
                        className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 resize-none focus:outline-none focus:ring-1 focus:ring-[#66A9E9]"
                      />
                      <button
                        onClick={handleStartConversation}
                        disabled={startingChat || !newChatPhone.trim() || !newChatMessage.trim()}
                        className="w-full text-xs bg-[#66A9E9] text-white py-1.5 rounded-lg disabled:opacity-50"
                      >
                        {startingChat ? 'جاري الإرسال...' : 'إرسال'}
                      </button>
                    </div>
                  )}
                  <div className="px-3 py-2 space-y-2 border-b bg-gray-50">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input value={inboxSearch} onChange={(e) => setInboxSearch(e.target.value)} placeholder="Search conversations..." className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#66A9E9]/40 focus:border-[#66A9E9]" />
                    </div>
                    <button onClick={() => setShowUnreadOnly(!showUnreadOnly)} className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${showUnreadOnly ? 'bg-[#D9232E] text-white shadow-sm' : 'bg-white border border-gray-200 text-gray-600 hover:border-[#D9232E] hover:text-[#D9232E]'}`}>
                      <Filter className="h-3 w-3" />{showUnreadOnly ? 'Show All' : 'Unread Only'}
                    </button>
                  </div>
                  <div className="flex-1 overflow-y-auto inbox-scroll">
                    {inboxLoading ? (
                      <div className="flex justify-center items-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#66A9E9]" /></div>
                    ) : conversations.length === 0 ? (
                      <div className="text-center py-12 text-gray-400"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-20" /><p className="text-sm">No conversations</p></div>
                    ) : (
                      conversations.map((conv) => (
                        <button key={conv.wa_id} onClick={() => handleConversationSelect(conv)} className={`w-full text-left px-4 py-3 border-b transition-all hover:bg-[#66A9E9]/5 ${selectedConversation?.wa_id === conv.wa_id ? 'bg-[#66A9E9]/10 border-l-4 border-l-[#66A9E9]' : 'border-l-4 border-l-transparent'}`}>
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#66A9E9] to-[#4a8fd4] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">{(conv.profile_name || conv.wa_id).charAt(0).toUpperCase()}</div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-semibold text-sm truncate text-gray-800">{conv.profile_name || 'Unknown'}</span>
                                <span className="text-xs text-gray-400 flex-shrink-0 ml-1">{getRelativeTime(conv.last_message.timestamp)}</span>
                              </div>
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-gray-500 truncate">{conv.last_message.direction === 'inbound' ? '' : '↑ '}{conv.last_message.text || '[Media]'}</p>
                                {conv.unread_count > 0 && <span className="ml-1 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#D9232E] text-white text-xs font-bold pulse-badge px-1">{conv.unread_count}</span>}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className={`lg:col-span-7 xl:col-span-8 2xl:col-span-9 flex flex-col min-h-0 ${mobileShowThread ? 'flex' : 'hidden lg:flex'}`}>
                {!selectedConversation ? (
                  <div className="rounded-2xl border bg-white shadow-sm flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="w-20 h-20 rounded-full bg-[#66A9E9]/10 flex items-center justify-center mx-auto mb-4"><MessageSquare className="h-10 w-10 text-[#66A9E9]/40" /></div>
                      <p className="font-medium text-gray-500">Select a conversation</p>
                      <p className="text-sm mt-1 text-gray-400">Choose a chat from the list to start replying</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border bg-white shadow-sm flex-1 flex flex-col overflow-hidden">
                    <div className="px-5 py-3 border-b bg-gradient-to-r from-[#66A9E9]/10 to-white flex items-center justify-between flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <button onClick={() => setMobileShowThread(false)} className="lg:hidden w-8 h-8 rounded-full hover:bg-[#66A9E9]/10 flex items-center justify-center transition-colors flex-shrink-0" aria-label="العودة للمحادثات">
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#66A9E9]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </button>
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#66A9E9] to-[#4a8fd4] flex items-center justify-center text-white font-bold flex-shrink-0">{(selectedConversation.profile_name || selectedConversation.wa_id).charAt(0).toUpperCase()}</div>
                        <div>
                          <p className="font-semibold text-gray-800 leading-tight">{selectedConversation.profile_name || 'Unknown'}</p>
                          <p className="text-xs text-gray-400">+{selectedConversation.wa_id}</p>
                          {customerProfile?.found && (
                            <div className="flex gap-1.5 mt-1">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2E533]/30 text-yellow-800 border border-[#F2E533]/60">{customerProfile.user.name}</span>
                              {customerProfile.children?.length > 0 && <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#66A9E9]/15 text-[#3a7fc1] border border-[#66A9E9]/30">{customerProfile.children.length} {customerProfile.children.length === 1 ? 'child' : 'children'}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {user?.role === 'admin' && (
                          <div className="flex items-center gap-1 p-1 rounded-full border border-[#66A9E9]/30 bg-white">
                            <button
                              type="button"
                              onClick={() => handleSwitchAgentMode(false)}
                              disabled={loadingAgentMode || savingAgentMode || !autoReplyConfig}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                                autoReplyConfig?.enabled === false ? 'bg-[#66A9E9] text-white shadow-sm' : 'text-[#3a7fc1] hover:bg-[#66A9E9]/10'
                              } disabled:opacity-50`}
                              title="الرد بواسطة وكيل بشري"
                            >
                              <User className="h-3 w-3" />
                              Human
                            </button>
                            <button
                              type="button"
                              onClick={() => handleSwitchAgentMode(true)}
                              disabled={loadingAgentMode || savingAgentMode || !autoReplyConfig}
                              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                                autoReplyConfig?.enabled ? 'bg-[#66A9E9] text-white shadow-sm' : 'text-[#3a7fc1] hover:bg-[#66A9E9]/10'
                              } disabled:opacity-50`}
                              title="الرد بواسطة وكيل ذكي"
                            >
                              <Bot className="h-3 w-3" />
                              AI
                            </button>
                          </div>
                        )}
                        <button onClick={() => setShowQuickReplies(!showQuickReplies)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${showQuickReplies ? 'bg-[#66A9E9] text-white border-[#66A9E9]' : 'bg-white text-[#66A9E9] border-[#66A9E9]/40 hover:bg-[#66A9E9]/10'}`}>
                          <MessageSquare className="h-3.5 w-3.5" /> Quick Replies
                        </button>
                      </div>
                    </div>

                    <div
                      ref={messagesContainerRef}
                      onScroll={handleMessagesScroll}
                      className="flex-1 overflow-y-auto p-3 sm:p-4 lg:p-5 space-y-3 inbox-messages-bg inbox-scroll"
                    >
                      {messages.length === 0 ? (
                        <div className="text-center text-gray-400 py-12"><p className="text-sm">No messages yet</p></div>
                      ) : (
                        messages.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'} message-animated`}>
                            <div className={`max-w-[88%] sm:max-w-[80%] lg:max-w-[72%] xl:max-w-[66%] rounded-2xl px-4 py-2.5 shadow-sm ${msg.direction === 'outbound' ? 'bg-[#66A9E9] text-white rounded-tr-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'}`}>
                              {msg.message_type === 'text' ? (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap" dir="auto">{msg.text_body}</p>
                              ) : msg.message_type === 'image' && msg.media_url ? (
                                <div className="space-y-1">
                                  {(() => {
                                    const mediaSrc = getMediaSrc(msg.media_proxy_url || msg.media_url, token);
                                    return (
                                  <img
                                    src={mediaSrc}
                                    alt="صورة"
                                    className="w-[220px] max-w-full max-h-[280px] object-cover rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                                    onClick={() => setPreviewImageSrc(mediaSrc)}
                                    onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
                                  />
                                    );
                                  })()}
                                  <p className="text-xs italic opacity-70 hidden">📷 تعذر عرض الصورة</p>
                                  {msg.text_body ? <p className="text-sm mt-1" dir="auto">{msg.text_body}</p> : null}
                                </div>
                              ) : msg.message_type === 'video' && msg.media_url ? (
                                <div className="space-y-1">
                                  {(() => {
                                    const mediaSrc = getMediaSrc(msg.media_proxy_url || msg.media_url, token);
                                    return (
                                      <>
                                        <video
                                          src={mediaSrc}
                                          controls
                                          playsInline
                                          preload="metadata"
                                          className="w-[220px] max-w-full max-h-[280px] rounded-xl bg-black object-cover"
                                        />
                                        <a
                                          href={mediaSrc}
                                          target="_blank"
                                          rel="noreferrer"
                                          className="text-xs underline opacity-80 hover:opacity-100"
                                        >
                                          فتح الفيديو في نافذة جديدة
                                        </a>
                                      </>
                                    );
                                  })()}
                                  {msg.text_body ? <p className="text-sm mt-1" dir="auto">{msg.text_body}</p> : null}
                                </div>
                              ) : msg.message_type === 'audio' && msg.media_url ? (
                                <audio src={getMediaSrc(msg.media_proxy_url || msg.media_url, token)} controls className="max-w-[220px]" />
                              ) : msg.message_type === 'document' && msg.media_url ? (
                                <a
                                  href={getMediaSrc(msg.media_proxy_url || msg.media_url, token)}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 text-sm underline"
                                >
                                  📄 {msg.text_body || 'مستند'}
                                </a>
                              ) : msg.message_type === 'sticker' && msg.media_url ? (
                                <img
                                  src={getMediaSrc(msg.media_proxy_url || msg.media_url, token)}
                                  alt="ملصق"
                                  className="max-w-[100px]"
                                />
                              ) : (
                                <p className="text-sm italic opacity-70">
                                  {msg.message_type === 'location' ? msg.text_body
                                    : msg.message_type === 'reaction' ? `${msg.text_body || '👍'} رد فعل`
                                    : msg.message_type === 'button' ? `↩️ ${msg.text_body || 'رد سريع'}`
                                    : msg.message_type === 'interactive' ? `↩️ ${msg.text_body || 'رد تفاعلي'}`
                                    : msg.message_type === 'unsupported' ? '(غير مدعوم)'
                                    : `[${msg.message_type}]`}
                                </p>
                              )}
                              <div className={`flex items-center gap-1.5 mt-1 text-xs ${msg.direction === 'outbound' ? 'text-white/70 justify-end' : 'text-gray-400'}`}>
                                <span>{new Date(msg.timestamp).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' })}</span>
                                {msg.direction === 'outbound' && msg.status && (
                                  <span className="ml-1">
                                    {msg.status === 'read' ? (
                                      <span className="text-blue-300 font-bold">✓✓</span>
                                    ) : msg.status === 'delivered' ? (
                                      <span className="text-white/70 font-bold">✓✓</span>
                                    ) : msg.status === 'sent' ? (
                                      <span className="text-white/50 font-bold">✓</span>
                                    ) : msg.status === 'failed' ? (
                                      <span className="text-red-300 font-bold">✗</span>
                                    ) : null}
                                  </span>
                                )}
                                {msg.sent_by_staff && <span>· {msg.sent_by_staff.name}</span>}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                      <div ref={messagesEndRef} />
                    </div>

                    {customerProfile?.found && (
                      <div className="border-t flex-shrink-0 bg-[#F9FBFF]">
                        <details className="group">
                          <summary className="flex items-center justify-between px-4 py-2 cursor-pointer select-none list-none">
                            <span className="text-xs font-semibold text-[#3a7fc1] flex items-center gap-1.5">
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" /></svg>
                              ملف العميل · {customerProfile.user.name}
                            </span>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-400 group-open:rotate-180 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                          </summary>
                          <div className="px-4 pb-3 space-y-3">
                            <div className="grid grid-cols-2 gap-2 text-xs">
                              <div className="bg-white rounded-lg p-2 border border-gray-100"><p className="text-gray-400 mb-0.5">الهاتف</p><p className="font-medium text-gray-700">{customerProfile.user.phone || '—'}</p></div>
                              <div className="bg-white rounded-lg p-2 border border-gray-100"><p className="text-gray-400 mb-0.5">عضو منذ</p><p className="font-medium text-gray-700">{customerProfile.user.created_at ? new Date(customerProfile.user.created_at).toLocaleDateString('ar-JO') : '—'}</p></div>
                            </div>
                            {customerProfile.children?.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-400 mb-1">الأطفال</p>
                                <div className="flex flex-wrap gap-1.5">
                                  {customerProfile.children.map(child => (
                                    <span key={child.id} className="inline-flex items-center gap-1 bg-[#66A9E9]/10 text-[#3a7fc1] text-xs px-2 py-0.5 rounded-full border border-[#66A9E9]/20">
                                      {child.name}{child.birthday && <span className="text-gray-400">· {new Date(child.birthday).toLocaleDateString('ar-JO', { month: 'short', day: 'numeric' })}</span>}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {customerProfile.subscriptions?.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-400 mb-1">الاشتراكات النشطة</p>
                                <div className="space-y-1">
                                  {customerProfile.subscriptions.map(sub => (
                                    <div key={sub.id} className="flex items-center justify-between bg-green-50 border border-green-100 rounded-lg px-2 py-1">
                                      <span className="text-xs font-medium text-green-800">{sub.plan_name}</span>
                                      <span className="text-xs text-green-600">{sub.remaining_visits} زيارة متبقية</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            {customerProfile.recent_bookings?.hourly?.length > 0 && (
                              <div>
                                <p className="text-xs text-gray-400 mb-1">آخر الحجوزات</p>
                                <div className="space-y-1">
                                  {customerProfile.recent_bookings.hourly.slice(0, 3).map(b => (
                                    <div key={b.id} className="flex items-center justify-between bg-white border border-gray-100 rounded-lg px-2 py-1">
                                      <span className="text-xs text-gray-600">{b.child_name} · {b.slot_date}</span>
                                      <span className={`text-xs font-medium px-1.5 py-0.5 rounded-full ${b.status === 'confirmed' ? 'bg-blue-50 text-blue-700' : b.status === 'checked_in' ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>{b.status}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                            <div>
                              <p className="text-xs text-gray-400 mb-1">حفظ اسم مخصص</p>
                              <div className="flex gap-2">
                                <input
                                  value={labelInput}
                                  onChange={(e) => setLabelInput(e.target.value)}
                                  placeholder="اكتب اسم العميل..."
                                  className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-1 focus:ring-[#66A9E9]"
                                />
                                <button
                                  onClick={handleSaveLabel}
                                  disabled={savingLabel || !labelInput.trim()}
                                  className="text-xs bg-[#66A9E9] text-white px-3 py-1 rounded-lg disabled:opacity-50"
                                >
                                  {savingLabel ? '...' : 'حفظ'}
                                </button>
                              </div>
                            </div>
                            {customerProfile?.user && (
                              <div className="border-t pt-2 mt-1 space-y-2">
                                {customerProfile.user.whatsapp_opted_out_at ? (
                                  <div className="space-y-1">
                                    <p className="text-xs text-red-500 font-medium">⛔ تم إيقاف الرسائل التسويقية</p>
                                    <button
                                      onClick={() => handleToggleOptOut(false)}
                                      disabled={togglingOptOut}
                                      className="w-full text-xs bg-green-600 text-white py-1.5 rounded-lg disabled:opacity-50"
                                    >
                                      {togglingOptOut ? '...' : 'إعادة تفعيل الرسائل'}
                                    </button>
                                  </div>
                                ) : (
                                  <button
                                    onClick={() => handleToggleOptOut(true)}
                                    disabled={togglingOptOut}
                                    className="w-full text-xs border border-red-300 text-red-500 py-1.5 rounded-lg hover:bg-red-50 disabled:opacity-50"
                                  >
                                    {togglingOptOut ? '...' : '⛔ إيقاف الرسائل التسويقية'}
                                  </button>
                                )}
                                {!customerProfile.user.whatsapp_opted_out_at && (
                                  customerProfile.user.whatsapp_marketing_consent ? (
                                    <p className="text-[11px] text-green-700 bg-green-50 border border-green-200 rounded-lg px-2 py-1">
                                      ✅ موافقة تسويقية مسجّلة
                                      {customerProfile.user.whatsapp_consent_date ? ` · ${new Date(customerProfile.user.whatsapp_consent_date).toLocaleDateString('ar-JO')}` : ''}
                                      {customerProfile.user.whatsapp_consent_source ? ` · ${customerProfile.user.whatsapp_consent_source}` : ''}
                                    </p>
                                  ) : (
                                    <button
                                      onClick={handleRecordMarketingConsent}
                                      disabled={togglingOptOut}
                                      className="w-full text-xs bg-amber-500 text-white py-1.5 rounded-lg hover:bg-amber-600 disabled:opacity-50"
                                    >
                                      {togglingOptOut ? '...' : '✅ تسجيل موافقة تسويقية'}
                                    </button>
                                  )
                                )}
                              </div>
                            )}
                          </div>
                        </details>
                      </div>
                    )}

                    {showQuickReplies && (
                      <div className="border-t flex-shrink-0 inbox-quick-replies-bg">
                        <div className="flex items-center justify-between px-4 py-2">
                          <span className="text-sm font-semibold text-white">⚡ Quick Replies</span>
                          <div className="flex items-center gap-1">
                            <button onClick={() => setShowQRManager(!showQRManager)} className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
                              {showQRManager ? <X className="h-3.5 w-3.5 text-white" /> : <Plus className="h-3.5 w-3.5 text-white" />}
                            </button>
                            <button onClick={() => setShowQuickReplies(false)} className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors">
                              <X className="h-3.5 w-3.5 text-white" />
                            </button>
                          </div>
                        </div>
                        {quickReplies.length > 0 && !showQRManager && (
                          <div className="grid grid-cols-2 gap-2 px-4 pb-3 max-h-36 overflow-y-auto">
                            {quickReplies.map((qr) => (
                              <button key={qr.id} onClick={() => handleQuickReplySelect(qr)} className="text-left p-2.5 rounded-xl bg-white/20 hover:bg-white/30 border border-white/20 transition-all text-white">
                                <p className="font-semibold text-xs truncate">{qr.label}</p>
                                <p className="text-xs text-white/70 truncate mt-0.5">{qr.message.substring(0, 55)}…</p>
                              </button>
                            ))}
                          </div>
                        )}
                        {showQRManager && (
                          <div className="px-4 pb-3 space-y-2">
                            {quickReplies.length === 0 && <p className="text-xs text-center text-white/70 py-2">لا توجد ردود سريعة بعد</p>}
                            {quickReplies.length > 0 && (
                              <div className="space-y-1 max-h-32 overflow-y-auto">
                                {quickReplies.map((qr) => (
                                  <div key={qr.id} className="flex items-center justify-between bg-white/10 rounded px-2 py-1">
                                    <span className="text-xs font-semibold text-white truncate flex-1">{qr.label}</span>
                                    <div className="flex gap-1 flex-shrink-0">
                                      <button onClick={() => handleEditQuickReply(qr)} className="p-1 hover:bg-white/20 rounded"><Edit2 className="h-3 w-3 text-white" /></button>
                                      <button onClick={() => handleDeleteQuickReply(qr.id)} className="p-1 hover:bg-white/20 rounded"><Trash2 className="h-3 w-3 text-white" /></button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                            <input value={qrForm.label} onChange={(e) => setQrForm(prev => ({ ...prev, label: e.target.value }))} placeholder="اسم الرد السريع" className="bg-white/20 border border-white/30 rounded-lg px-2 py-1 text-xs text-white placeholder:text-white/50 w-full" />
                            <textarea value={qrForm.message} onChange={(e) => setQrForm(prev => ({ ...prev, message: e.target.value }))} placeholder="نص الرسالة..." rows={2} className="bg-white/20 border border-white/30 rounded-lg px-2 py-1 text-xs text-white placeholder:text-white/50 w-full resize-none" />
                            <select value={qrForm.category} onChange={(e) => setQrForm(prev => ({ ...prev, category: e.target.value }))} className="bg-white/20 border border-white/30 rounded-lg px-2 py-1 text-xs text-white w-full">
                              <option value="greeting">تحية</option>
                              <option value="booking">حجز</option>
                              <option value="payment">دفع</option>
                              <option value="inquiry">استفسار</option>
                              <option value="closing">إغلاق</option>
                              <option value="other">أخرى</option>
                            </select>
                            <div className="flex gap-2">
                              <button onClick={handleSaveQuickReply} disabled={qrSaving || !qrForm.label || !qrForm.message} className="bg-white text-[#66A9E9] text-xs font-semibold rounded-lg px-3 py-1 disabled:opacity-50 flex items-center gap-1">
                                {qrSaving ? <Loader2 className="h-3 w-3 animate-spin" /> : null}{qrEditId ? 'تحديث' : 'حفظ'}
                              </button>
                              {qrEditId && <button onClick={() => { setQrForm({ label: '', message: '', category: 'other' }); setQrEditId(null); }} className="bg-white/20 text-white text-xs rounded-lg px-3 py-1">إلغاء</button>}
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {showTemplatePicker && (
                      <div className="border-t bg-gray-50 px-4 py-3 flex-shrink-0">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-semibold text-gray-600">اختر قالباً معتمداً</p>
                          <button onClick={() => setShowTemplatePicker(false)} className="text-gray-400 hover:text-gray-600">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        {templates.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-2">لا توجد قوالب معتمدة. قم بمزامنة القوالب من لوحة التحكم أولاً.</p>
                        ) : (
                          <div className="space-y-1 max-h-40 overflow-y-auto">
                            {templates.map(tpl => (
                              <button
                                key={tpl._id}
                                onClick={() => handleSendTemplate(tpl)}
                                disabled={sendingTemplate}
                                className="w-full text-left px-3 py-2 rounded-lg bg-white border border-gray-200 hover:border-[#66A9E9] hover:bg-[#66A9E9]/5 transition-all disabled:opacity-50"
                              >
                                <p className="text-xs font-semibold text-gray-700">{tpl.name}</p>
                                <p className="text-xs text-gray-400 truncate mt-0.5">{tpl.body_text?.slice(0, 60)}...</p>
                                <span className="text-xs text-[#66A9E9]">{tpl.language} · {tpl.category}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="border-t bg-white px-3 sm:px-4 py-3 flex-shrink-0">
                      {mediaPreview?.length > 0 && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {mediaPreview.map(({ url, type }, idx) => (
                            <div key={idx} className="relative">
                              {type === 'video' ? (
                                <video src={url} className="h-16 w-16 rounded-xl object-cover border border-gray-200" muted />
                              ) : (
                                <img src={url} alt="preview" className="h-16 w-16 rounded-xl object-cover border border-gray-200" />
                              )}
                              {idx === 0 && (
                                <button
                                  onClick={() => { setMediaFiles([]); setMediaPreview([]); if (imageInputRef.current) imageInputRef.current.value = ''; }}
                                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                          {mediaPreview.length > 1 && (
                            <p className="text-xs text-gray-500 self-end">{mediaPreview.length} مرفقات — سيتم إرسالها بشكل منفصل</p>
                          )}
                        </div>
                      )}
                      <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-end gap-2 sm:gap-3">
                        <button
                          type="button"
                          onClick={() => setShowTemplatePicker(!showTemplatePicker)}
                          title="إرسال قالب"
                          className={`flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all ${showTemplatePicker ? 'bg-[#66A9E9] text-white' : 'bg-gray-100 hover:bg-gray-200 text-gray-500'}`}
                        >
                          <FileText className="h-4 w-4" />
                        </button>
                        <input
                          ref={imageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp,video/mp4,video/3gpp,video/quicktime"
                          multiple
                          className="hidden"
                          onChange={handleMediaSelect}
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          title="إرسال صورة أو فيديو"
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-all"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </button>
                        <textarea ref={replyTextareaRef} value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSendMessage(); } }} placeholder="اكتب رسالة... (Enter للإرسال)" rows={2} disabled={sending} className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-3 sm:px-4 py-2.5 sm:py-3 text-sm leading-6 min-h-[48px] max-h-40 overflow-y-auto focus:outline-none focus:ring-2 focus:ring-[#66A9E9]/40 focus:border-[#66A9E9] focus:bg-white transition-all disabled:opacity-50" />
                        <button
                          type={mediaFiles?.length ? 'button' : 'submit'}
                          onClick={mediaFiles?.length ? handleSendMedia : undefined}
                          disabled={sending || sendingMedia || (!replyText.trim() && !mediaFiles?.length)}
                          className="flex-shrink-0 w-11 h-11 rounded-full bg-[#66A9E9] hover:bg-[#4a8fd4] disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-all shadow-md hover:shadow-lg active:scale-95"
                        >
                          {(sending || sendingMedia) ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Send className="h-5 w-5 text-white" />}
                        </button>
                      </form>
                      <p className="text-xs text-gray-400 mt-1.5 pl-1">WhatsApp · {selectedConversation.wa_id}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {previewImageSrc && (
              <div
                className="fixed inset-0 z-[100] bg-black/80 p-4 flex items-center justify-center"
                onClick={() => setPreviewImageSrc('')}
                role="dialog"
                aria-modal="true"
                aria-label="معاينة الصورة"
              >
                <button
                  type="button"
                  className="absolute top-4 right-4 text-white bg-black/30 rounded-full p-2 hover:bg-black/50 transition-colors"
                  onClick={() => setPreviewImageSrc('')}
                  aria-label="إغلاق المعاينة"
                >
                  <X className="h-5 w-5" />
                </button>
                <img
                  src={previewImageSrc}
                  alt="معاينة الصورة"
                  className="max-h-[92vh] max-w-[92vw] rounded-xl object-contain"
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            )}
          </TabsContent>

          <TabsContent value="campaigns">
            <div className="space-y-4">
              <Card className="rounded-2xl">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="font-heading flex items-center gap-2"><Megaphone className="h-5 w-5 text-primary" /> حملات واتساب</CardTitle>
                      <CardDescription>أرسل رسائل جماعية للعملاء عبر واتساب</CardDescription>
                    </div>
                    <Button variant={showCampaignForm ? 'outline' : 'default'} onClick={() => setShowCampaignForm(!showCampaignForm)} className="rounded-full gap-2">
                      {showCampaignForm ? <><X className="h-4 w-4" /> إلغاء</> : <><Plus className="h-4 w-4" /> إنشاء حملة</>}
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              {/* ===== BULK SEND CARD (DB-neutral, no campaign state) ===== */}
              <Card className="rounded-2xl border-dashed border-2 border-primary/30">
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-base flex items-center gap-2"><Send className="h-4 w-4 text-primary" /> إرسال جماعي يدوي</CardTitle>
                      <p className="text-xs text-muted-foreground mt-1">أرسل قالب معتمد مباشرة بدون حفظ حملة — حتى 1,000 مستلم</p>
                    </div>
                    <Button size="sm" variant={showBulkSend ? 'outline' : 'default'} onClick={() => { setShowBulkSend(!showBulkSend); setBulkResults(null); }} className="rounded-full gap-1.5">
                      {showBulkSend ? <><X className="h-3.5 w-3.5" /> إغلاق</> : <><Send className="h-3.5 w-3.5" /> ابدأ</>}
                    </Button>
                  </div>
                </CardHeader>
                {showBulkSend && (
                  <CardContent className="space-y-3 pt-0">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <Label className="text-xs">اسم القالب المعتمد *</Label>
                        <button type="button" onClick={handleSyncTemplates} disabled={syncingTemplates} className="flex items-center gap-1 text-[11px] text-primary hover:underline disabled:opacity-50">
                          {syncingTemplates ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                          {syncingTemplates ? 'جاري المزامنة...' : 'مزامنة من Meta'}
                        </button>
                      </div>
                      {approvedTemplates.length > 0 ? (
                        <select value={bulkTemplateName} onChange={(e) => { setBulkTemplateName(e.target.value); setBulkVarValues({}); }} className="w-full mt-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                          <option value="">— اختر قالب —</option>
                          {approvedTemplates.map(t => <option key={t._id || t.name} value={t.name}>{t.name} ({t.language || 'ar'}) — {t.category}</option>)}
                        </select>
                      ) : (
                        <Input value={bulkTemplateName} onChange={(e) => setBulkTemplateName(e.target.value)} placeholder="اسم القالب كما هو في Meta" className="rounded-xl mt-1" />
                      )}
                      {(() => {
                        const selTpl = approvedTemplates.find(t => t.name === bulkTemplateName);
                        if (selTpl?.body_text) return <p className="text-xs text-muted-foreground mt-1.5 bg-gray-50 rounded-lg px-2 py-1.5 border border-gray-100 leading-relaxed" dir="auto">{selTpl.body_text}</p>;
                        return null;
                      })()}
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs">اللغة</Label>
                        <Input value={bulkLanguageCode} onChange={(e) => setBulkLanguageCode(e.target.value)} placeholder="ar" className="rounded-xl mt-1" />
                      </div>
                      <div>
                        <Label className="text-xs">صلاحية (ساعات)</Label>
                        <Input type="number" min="12" max="720" value={bulkTtlHours} onChange={(e) => setBulkTtlHours(e.target.value)} placeholder="اختياري" className="rounded-xl mt-1" />
                      </div>
                    </div>

                    {/* Header image URL — shown when template has image header */}
                    {(() => {
                      const selTpl = approvedTemplates.find(t => t.name === bulkTemplateName);
                      if (!selTpl || selTpl.header_type !== 'image') return null;
                      return (
                        <div>
                          <Label className="text-xs">رابط صورة الهيدر *</Label>
                          <Input value={bulkHeaderImageUrl} onChange={(e) => setBulkHeaderImageUrl(e.target.value)} placeholder="https://example.com/image.jpg" className="rounded-xl mt-1 text-xs" dir="ltr" />
                        </div>
                      );
                    })()}

                    {/* Smart variable inputs — shown only when template has variables or body_text placeholders */}
                    {(() => {
                      if (showBulkAdvanced) return null;
                      const selTpl = approvedTemplates.find(t => t.name === bulkTemplateName);
                      if (!selTpl) return null;
                      let vars = selTpl.variables || [];
                      // Fallback: detect {1}/{2} or {{1}}/{{2}} placeholders from body_text
                      if (vars.length === 0 && selTpl.body_text) {
                        const matches = selTpl.body_text.match(/\{\{?\d+\}?\}/g);
                        if (matches) {
                          const indices = [...new Set(matches.map(m => parseInt(m.replace(/[{}]/g, ''), 10)))].sort((a, b) => a - b);
                          vars = indices.map(n => ({ name: `المتغير ${n}`, example: '' }));
                        }
                      }
                      if (vars.length === 0) return null;
                      return (
                        <div className="space-y-2">
                          <Label className="text-xs">متغيرات القالب</Label>
                          {vars.map((v, idx) => (
                            <div key={idx}>
                              <label className="text-[11px] text-muted-foreground">{v.name || `المتغير ${idx + 1}`}{v.example ? ` — مثال: ${v.example}` : ''}</label>
                              <Input value={bulkVarValues[idx] || ''} onChange={(e) => setBulkVarValues(prev => ({ ...prev, [idx]: e.target.value }))} placeholder={v.example || `المتغير ${idx + 1}`} className="rounded-xl mt-0.5" />
                            </div>
                          ))}
                        </div>
                      );
                    })()}

                    {/* Advanced JSON toggle */}
                    <div>
                      <button type="button" onClick={() => setShowBulkAdvanced(!showBulkAdvanced)} className="text-[11px] text-muted-foreground underline">
                        {showBulkAdvanced ? 'إخفاء الوضع المتقدم' : 'وضع متقدم (JSON)'}
                      </button>
                      {showBulkAdvanced && (
                        <textarea value={bulkAdvancedJson} onChange={(e) => setBulkAdvancedJson(e.target.value)} placeholder={'[{"type":"body","parameters":[{"type":"text","text":"..."}]}]'} rows={3} className="w-full mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                      )}
                    </div>
                    <div>
                      <Label className="text-xs">أرقام الهواتف * (رقم واحد في كل سطر، حتى 1,000)</Label>
                      <textarea value={bulkPhones} onChange={(e) => setBulkPhones(e.target.value)} placeholder={'962791234567\n962797654321\n...'} rows={5} className="w-full mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y" />
                      <p className="text-xs text-muted-foreground mt-1">
                        عدد الأسطر: {bulkPhones.split('\n').filter(l => l.trim()).length} / 1,000
                      </p>
                    </div>
                    <Button onClick={handleBulkSend} disabled={bulkSending || !bulkTemplateName.trim() || !bulkPhones.trim()} className="w-full rounded-full gap-2">
                      {bulkSending ? <><Loader2 className="h-4 w-4 animate-spin" /> جاري الإرسال...</> : <><Send className="h-4 w-4" /> إرسال جماعي</>}
                    </Button>

                    {/* Bulk send results */}
                    {bulkResults && (
                      <div className="bg-muted/30 rounded-xl p-3 space-y-2">
                        <p className="text-sm font-semibold">نتائج الإرسال</p>
                        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                          <div className="bg-green-50 rounded-lg py-2"><p className="text-lg font-bold text-green-700">{bulkResults.summary?.sent || 0}</p><p className="text-[10px] text-green-600">تم الإرسال</p></div>
                          <div className="bg-amber-50 rounded-lg py-2"><p className="text-lg font-bold text-amber-700">{bulkResults.summary?.skipped_no_consent || 0}</p><p className="text-[10px] text-amber-600">بدون موافقة تسويقية</p></div>
                          <div className="bg-yellow-50 rounded-lg py-2"><p className="text-lg font-bold text-yellow-700">{bulkResults.summary?.skipped_opted_out || 0}</p><p className="text-[10px] text-yellow-600">إلغاء اشتراك</p></div>
                          <div className="bg-orange-50 rounded-lg py-2"><p className="text-lg font-bold text-orange-700">{bulkResults.summary?.skipped_invalid || 0}</p><p className="text-[10px] text-orange-600">رقم غير صالح</p></div>
                          <div className="bg-red-50 rounded-lg py-2"><p className="text-lg font-bold text-red-700">{bulkResults.summary?.failed || 0}</p><p className="text-[10px] text-red-600">فشل</p></div>
                        </div>
                        {Array.isArray(bulkResults.results) && bulkResults.results.length > 0 && (
                          <div className="max-h-40 overflow-y-auto space-y-1 mt-2">
                            {bulkResults.results.map((r, idx) => (
                              <div key={idx} className="bg-white rounded-lg px-2 py-1 border text-xs">
                                <div className="flex items-center justify-between">
                                  <span className="font-mono truncate max-w-[50%]">{r.phone}</span>
                                  <span className={`px-2 py-0.5 rounded-full font-medium ${r.status === 'sent' ? 'bg-green-100 text-green-700' : r.status === 'skipped_no_consent' ? 'bg-amber-100 text-amber-700' : r.status === 'skipped_opted_out' ? 'bg-yellow-100 text-yellow-700' : r.status === 'skipped_invalid' ? 'bg-orange-100 text-orange-700' : 'bg-red-100 text-red-700'}`}>
                                    {r.status === 'sent' ? 'تم' : r.status === 'skipped_no_consent' ? 'بدون موافقة' : r.status === 'skipped_opted_out' ? 'إلغاء اشتراك' : r.status === 'skipped_invalid' ? 'غير صالح' : 'فشل'}
                                  </span>
                                </div>
                                {!!r.reason && (
                                  <p className={`mt-1 text-[11px] break-words ltr:text-left ltr:font-mono ${r.status === 'sent' ? 'text-green-700' : r.status === 'skipped_no_consent' ? 'text-amber-700' : r.status === 'skipped_opted_out' ? 'text-yellow-700' : r.status === 'skipped_invalid' ? 'text-orange-700' : 'text-red-700'}`}>{r.reason}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </CardContent>
                )}
              </Card>

              {showCampaignForm && (
                <Card className="rounded-2xl">
                  <CardHeader><CardTitle className="text-base">حملة جديدة</CardTitle></CardHeader>
                  <CardContent className="space-y-4">
                    <div>
                      <Label>اسم الحملة</Label>
                      <Input value={campaignForm.name} onChange={(e) => setCampaignForm(prev => ({ ...prev, name: e.target.value }))} placeholder="مثال: عروض عيد الفطر" className="rounded-xl mt-1" />
                    </div>
                    <div>
                      <Label>نوع الرسالة</Label>
                      <select value={campaignForm.message_type} onChange={(e) => setCampaignForm(prev => ({ ...prev, message_type: e.target.value }))} className="w-full mt-1 rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30">
                        <option value="free_form">رسالة نصية حرة (داخل 24 ساعة)</option>
                        <option value="template">قالب معتمد من Meta (خارج 24 ساعة)</option>
                      </select>
                    </div>
                    {campaignForm.message_type === 'free_form' && (
                      <div>
                        <Label>نص الرسالة</Label>
                        <textarea value={campaignForm.free_form_message} onChange={(e) => setCampaignForm(prev => ({ ...prev, free_form_message: e.target.value }))} placeholder="اكتب الرسالة التي سترسلها للعملاء..." rows={4} className="w-full mt-1 rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none" />
                      </div>
                    )}
                    {campaignForm.message_type === 'template' && (
                      <>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label>اسم القالب</Label>
                            <Input value={campaignForm.template_name} onChange={(e) => setCampaignForm(prev => ({ ...prev, template_name: e.target.value }))} placeholder="peekaboo_booking_reminder" className="rounded-xl mt-1" />
                          </div>
                          <div>
                            <Label>اللغة</Label>
                            <Input value={campaignForm.template_language} onChange={(e) => setCampaignForm(prev => ({ ...prev, template_language: e.target.value }))} placeholder="ar" className="rounded-xl mt-1" />
                          </div>
                        </div>
                        <div>
                          <Label>مدة الصلاحية (ساعات)</Label>
                          <Input type="number" min="12" max="720" value={campaignForm.ttl_hours} onChange={(e) => setCampaignForm(prev => ({ ...prev, ttl_hours: e.target.value }))} placeholder="مثال: 48 (اختياري)" className="rounded-xl mt-1" />
                          <p className="text-xs text-muted-foreground mt-1">اتركها فارغة لاستخدام المدة الافتراضية · النطاق: 12 إلى 720 ساعة</p>
                        </div>
                      </>
                    )}
                    <div className="space-y-2">
                      <Label>فلترة الجمهور</Label>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="has_booking" checked={campaignForm.audience_filters.has_booking} onChange={(e) => setCampaignForm(prev => ({ ...prev, audience_filters: { ...prev.audience_filters, has_booking: e.target.checked } }))} className="rounded" />
                        <label htmlFor="has_booking" className="text-sm">العملاء الذين لديهم حجز</label>
                      </div>
                      <div className="flex items-center gap-2">
                        <input type="checkbox" id="has_sub" checked={campaignForm.audience_filters.has_active_subscription} onChange={(e) => setCampaignForm(prev => ({ ...prev, audience_filters: { ...prev.audience_filters, has_active_subscription: e.target.checked } }))} className="rounded" />
                        <label htmlFor="has_sub" className="text-sm">العملاء الذين لديهم اشتراك نشط</label>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs">من تاريخ</Label>
                          <input type="date" value={campaignForm.audience_filters.last_message_after} onChange={(e) => setCampaignForm(prev => ({ ...prev, audience_filters: { ...prev.audience_filters, last_message_after: e.target.value } }))} className="w-full mt-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                        <div>
                          <Label className="text-xs">إلى تاريخ</Label>
                          <input type="date" value={campaignForm.audience_filters.last_message_before} onChange={(e) => setCampaignForm(prev => ({ ...prev, audience_filters: { ...prev.audience_filters, last_message_before: e.target.value } }))} className="w-full mt-1 rounded-xl border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/30" />
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={fetchAudiencePreview}
                        disabled={previewLoading}
                        className="text-xs text-[#66A9E9] underline mt-1"
                      >
                        {previewLoading ? 'جاري الحساب...' : 'احسب حجم الجمهور'}
                      </button>
                      {audiencePreview !== null && (
                        <p className="text-sm font-semibold text-green-700 mt-1">
                          المستلمون المتوقعون: {audiencePreview} شخص
                        </p>
                      )}
                      {audienceCostEstimate !== null && audiencePreview > 0 && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          تكلفة تقديرية: ~{audienceCostEstimate} دينار (حسب سعر Meta الحالي)
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">الجمهور يُبنى من سجل رسائل واتساب فقط</p>
                    </div>
                    <Button onClick={handleCreateCampaign} disabled={campaignSaving || !campaignForm.name || (campaignForm.message_type === 'free_form' && !campaignForm.free_form_message) || (campaignForm.message_type === 'template' && !campaignForm.template_name)} className="w-full rounded-full">
                      {campaignSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}إنشاء الحملة
                    </Button>
                  </CardContent>
                </Card>
              )}

              <div className="space-y-3">
                {campaignsLoading ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
                ) : campaigns.length === 0 ? (
                  <div className="text-center py-16 text-muted-foreground"><Megaphone className="h-12 w-12 mx-auto mb-3 opacity-20" /><p>لا توجد حملات بعد</p></div>
                ) : (
                  campaigns.map((campaign) => (
                    <Card key={campaign.id} className="rounded-2xl">
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold truncate">{campaign.name}</p>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusBadgeClass(campaign.status)}`}>{statusLabel(campaign.status)}</span>
                            <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">{campaign.message_type === 'free_form' ? 'نصية' : 'قالب'}</span>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          <span>{new Date(campaign.created_at).toLocaleDateString('ar-JO')}</span>
                          {campaign.recipient_count > 0 && <span>{campaign.recipient_count} مستلم</span>}
                          {campaign.executed_at && <span>أُطلقت: {new Date(campaign.executed_at).toLocaleDateString('ar-JO')}</span>}
                          {campaign.ttl_hours && <span className="text-primary font-medium">صلاحية: {campaign.ttl_hours}س</span>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {(campaign.status === 'draft' || campaign.status === 'paused') && (
                            <Button size="sm" className="rounded-full bg-green-600 hover:bg-green-700 gap-1.5" onClick={() => handleExecuteCampaign(campaign.id)} disabled={executingId === campaign.id}>
                              {executingId === campaign.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PlayCircle className="h-3.5 w-3.5" />}إطلاق
                            </Button>
                          )}
                          {campaign.status === 'running' && (
                            <Button size="sm" variant="outline" className="rounded-full border-yellow-400 text-yellow-700 gap-1.5" onClick={() => handlePauseCampaign(campaign.id)} disabled={pausingId === campaign.id}>
                              {pausingId === campaign.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PauseCircle className="h-3.5 w-3.5" />}إيقاف
                            </Button>
                          )}
                          <Button size="sm" variant="outline" className="rounded-full gap-1.5" onClick={() => handleToggleCampaignStats(campaign.id)}>
                            <BarChart2 className="h-3.5 w-3.5" />إحصائيات
                            {expandedCampaignId === campaign.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          </Button>
                        </div>
                        {expandedCampaignId === campaign.id && (
                          <div className="space-y-3 pt-2 border-t">
                            <div className="grid grid-cols-4 gap-2">
                              {(() => {
                                const s = campaignStats[campaign.id] || campaign.live_stats || { sent: 0, delivered: 0, read: 0, failed: 0 };
                                return [
                                  { label: 'تم الإرسال', value: s.sent, color: 'text-blue-600' },
                                  { label: 'وصلت', value: s.delivered, color: 'text-green-600' },
                                  { label: 'قُرئت', value: s.read, color: 'text-primary' },
                                  { label: 'فشلت', value: s.failed, color: 'text-red-500' }
                                ].map(stat => (
                                  <div key={stat.label} className="text-center bg-muted/50 rounded-xl py-2">
                                    <p className={`text-xl font-bold ${stat.color}`}>{stat.value}</p>
                                    <p className="text-xs text-muted-foreground">{stat.label}</p>
                                  </div>
                                ));
                              })()}
                            </div>

                            <div className="bg-muted/30 rounded-xl p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-sm font-semibold">قائمة جمهور الحملة</p>
                                {campaignRecipients[campaign.id] && (
                                  <p className="text-xs text-muted-foreground">
                                    الإجمالي: {campaignRecipients[campaign.id].recipient_count} · المستبعد: {campaignRecipients[campaign.id].excluded_count}
                                  </p>
                                )}
                              </div>

                              {loadingRecipientsId === campaign.id ? (
                                <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-primary" /></div>
                              ) : (
                                <div className="space-y-1 max-h-56 overflow-y-auto">
                                  {(campaignRecipients[campaign.id]?.recipients || []).length === 0 ? (
                                    <p className="text-xs text-muted-foreground">لا يوجد مستلمون مطابقون حالياً.</p>
                                  ) : (
                                    (campaignRecipients[campaign.id]?.recipients || []).map((recipient) => (
                                      <div key={recipient.wa_id} className="flex items-center justify-between bg-white rounded-lg px-2 py-1.5 border">
                                        <div>
                                          <p className="text-xs font-medium">{recipient.profile_name || 'بدون اسم'}</p>
                                          <p className="text-[11px] text-muted-foreground">{recipient.wa_id}</p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                          {recipient.excluded ? (
                                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-red-100 text-red-700">مستبعد</span>
                                          ) : (
                                            (campaign.status === 'draft' || campaign.status === 'paused') && (
                                              <Button
                                                size="sm"
                                                variant="outline"
                                                className="rounded-full h-7 text-xs border-red-200 text-red-700 hover:bg-red-50"
                                                onClick={() => handleRemoveRecipientFromCampaign(campaign.id, recipient.wa_id)}
                                                disabled={removingRecipientKey === `${campaign.id}:${recipient.wa_id}`}
                                              >
                                                {removingRecipientKey === `${campaign.id}:${recipient.wa_id}` ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                                                استبعاد
                                              </Button>
                                            )
                                          )}
                                        </div>
                                      </div>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  ))
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
        )}

      <style>{`
        @keyframes messageSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseBadge { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .message-animated { animation: messageSlideUp 0.3s ease-out; }
        .pulse-badge { animation: pulseBadge 2s infinite; }
        .inbox-messages-bg { background: linear-gradient(180deg, #f0f4f8 0%, #e8eef5 100%); }
        .inbox-quick-replies-bg { background: linear-gradient(135deg, #66A9E9 0%, #4a8fd4 100%); }
        .inbox-scroll { scrollbar-width: thin; scrollbar-color: #b9c7d7 transparent; }
        .inbox-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
        .inbox-scroll::-webkit-scrollbar-thumb { background: #c4d1de; border-radius: 999px; }
        .inbox-scroll::-webkit-scrollbar-thumb:hover { background: #a9bccf; }
        @media (max-width: 1023px) {
          .staff-page-inbox-shell {
            min-height: 70dvh;
          }
        }
      `}</style>
      </div>
    </DashboardLayout>
  );
}
