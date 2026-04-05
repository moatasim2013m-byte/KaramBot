import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { Badge } from '../components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { toast } from 'sonner';
import {
  QrCode, Clock, Star, Cake, Search, CheckCircle, XCircle, 
  Loader2, AlertTriangle, Users, RefreshCw, MessageSquare, Send,
  Plus, Edit2, Trash2, X, Filter, Megaphone, BarChart2,
  PlayCircle, PauseCircle, ChevronDown, ChevronUp, FileText,
  Image as ImageIcon
} from 'lucide-react';

const getApiErrorMessage = (error, fallback = 'حدث خطأ') =>
  error?.response?.data?.details ||
  error?.response?.data?.error ||
  error?.message ||
  fallback;
const getMediaSrc = (mediaUrl) => {
  if (!mediaUrl) return '';
  if (mediaUrl.startsWith('http://') || mediaUrl.startsWith('https://')) return mediaUrl;
  return `/api/staff/inbox/media/${mediaUrl}`;
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
  const { api, user, token } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('scanner');
  const [bookingCode, setBookingCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
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
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [sendingImage, setSendingImage] = useState(false);
  const [togglingOptOut, setTogglingOptOut] = useState(false);
  const [previewImageSrc, setPreviewImageSrc] = useState('');
  const imageInputRef = useRef(null);
  const inboxEventsRef = useRef(null);

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
    if (requestedTab === 'inbox') setActiveTab('inbox');
  }, [location.search]);

  useEffect(() => {
    if (!previewImageSrc) return undefined;
    const handleEscape = (event) => {
      if (event.key === 'Escape') setPreviewImageSrc('');
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [previewImageSrc]);

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
    fetchActiveSessions();
    fetchPendingCheckins();
    fetchTodayParties();
  }, [fetchActiveSessions, fetchPendingCheckins, fetchTodayParties]);

  useEffect(() => {
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
  }, [createAuthedEventSource]);

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

  const handleConversationSelect = (conv) => {
    setConversations(prev => prev.map(c => c.wa_id === conv.wa_id ? { ...c, unread_count: 0 } : c));
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

  const handleImageSelect = (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
    if (files.some((file) => !allowedTypes.includes(file.type))) {
      toast.error('يسمح فقط بصور JPG أو PNG أو WEBP');
      if (imageInputRef.current) imageInputRef.current.value = '';
      return;
    }
    setImageFile(files);
    const urls = files.map((f) => URL.createObjectURL(f));
    setImagePreview(urls);
  };

  const handleSendImage = async () => {
    const files = Array.isArray(imageFile) ? imageFile : imageFile ? [imageFile] : [];
    if (!files.length || !selectedConversation) return;
    setSendingImage(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const formData = new FormData();
        const compressed = await compressImage(file);
        formData.append('image', compressed);
        formData.append('wa_id', selectedConversation.wa_id);
        if (i === 0 && replyText.trim()) formData.append('caption', replyText.trim());
        await api.post('/staff/inbox/send-image', formData);
      }
      toast.success(files.length > 1 ? `تم إرسال ${files.length} صور` : 'تم إرسال الصورة');
      setImageFile(null);
      setImagePreview(null);
      setReplyText('');
      if (imageInputRef.current) imageInputRef.current.value = '';
      await fetchMessages(selectedConversation.wa_id);
    } catch (error) {
      const errMsg = error.response?.data?.error || error.response?.data?.details || 'فشل إرسال الصورة';
      toast.error(errMsg);
    } finally { setSendingImage(false); }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    if (activeTab === 'inbox') {
      fetchInboxStats();
      fetchConversations(true);
      fetchQuickReplies();
      fetchTemplates();
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
    fetchInboxStats,
    fetchConversations,
    fetchQuickReplies,
    fetchTemplates,
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
    if (activeTab === 'campaigns') fetchCampaigns();
  }, [activeTab, fetchCampaigns]);

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
    <div className="min-h-screen bg-muted/30 py-8">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="font-heading text-3xl font-bold" data-testid="staff-title">
            <Users className="inline-block h-8 w-8 text-primary mr-2" />
            Staff Panel
          </h1>
          <Button variant="outline" onClick={() => { fetchActiveSessions(); fetchPendingCheckins(); fetchTodayParties(); }} className="rounded-full gap-2">
            <RefreshCw className="h-4 w-4" /> Refresh
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border rounded-full p-1 flex-wrap gap-1">
            <TabsTrigger value="scanner" className="rounded-full gap-2" data-testid="tab-scanner">
              <QrCode className="h-4 w-4" /> QR Scanner
            </TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-full gap-2" data-testid="tab-sessions">
              <Clock className="h-4 w-4" /> Active Sessions
              {activeSessions.length > 0 && <Badge className="ml-1 bg-primary">{activeSessions.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="rounded-full gap-2" data-testid="tab-subscriptions">
              <Star className="h-4 w-4" /> Subscriptions
            </TabsTrigger>
            <TabsTrigger value="birthdays" className="rounded-full gap-2" data-testid="tab-birthdays">
              <Cake className="h-4 w-4" /> Today's Parties
              {todayParties.length > 0 && <Badge className="ml-1 bg-accent">{todayParties.length}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="inbox" className="rounded-full gap-2" data-testid="tab-inbox">
              <MessageSquare className="h-4 w-4" /> Inbox
              {inboxStats?.unread_messages > 0 && <Badge className="ml-1 bg-red-500">{inboxStats.unread_messages}</Badge>}
            </TabsTrigger>
            <TabsTrigger value="campaigns" className="rounded-full gap-2" data-testid="tab-campaigns">
              <Megaphone className="h-4 w-4" /> حملات
            </TabsTrigger>
          </TabsList>

          <TabsContent value="scanner">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="font-heading flex items-center gap-2"><QrCode className="h-5 w-5 text-primary" /> Check-in Scanner</CardTitle>
                  <CardDescription>Enter the booking code from the parent's QR to start their session</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCheckin} className="space-y-4">
                    <div>
                      <Label>Booking Code</Label>
                      <Input value={bookingCode} onChange={(e) => setBookingCode(e.target.value)} placeholder="PK-H-XXXXXXXX" className="rounded-xl h-14 text-lg uppercase mt-2" data-testid="booking-code-input" />
                    </div>
                    <Button type="submit" disabled={scanning || !bookingCode.trim()} className="w-full rounded-full h-12" data-testid="checkin-btn">
                      {scanning ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : <CheckCircle className="h-5 w-5 mr-2" />}
                      Check In
                    </Button>
                  </form>
                  {scanResult && (
                    <div className={`mt-6 p-4 rounded-xl ${scanResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                      {scanResult.success ? (
                        <div className="text-center">
                          <CheckCircle className="h-10 w-10 text-green-600 mx-auto mb-2" />
                          <p className="font-semibold text-green-700">Check-in Successful!</p>
                          <p className="text-green-600">{scanResult.data.session?.child_name}</p>
                          <p className="text-sm text-green-600">Session ends: {new Date(scanResult.data.session?.session_end_time).toLocaleTimeString()}</p>
                        </div>
                      ) : (
                        <div className="text-center">
                          <XCircle className="h-10 w-10 text-red-600 mx-auto mb-2" />
                          <p className="font-semibold text-red-700">Failed</p>
                          <p className="text-red-600">{scanResult.error}</p>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="font-heading">Pending Check-ins Today</CardTitle>
                  <CardDescription>Confirmed bookings waiting to check in</CardDescription>
                </CardHeader>
                <CardContent>
                  {pendingCheckins.length === 0 ? (
                    <p className="text-muted-foreground text-center py-8">No pending check-ins</p>
                  ) : (
                    <div className="space-y-3 max-h-80 overflow-y-auto">
                      {pendingCheckins.map((booking) => (
                        <div key={booking.id} className="flex justify-between items-center p-3 rounded-xl bg-muted/50">
                          <div>
                            <p className="font-semibold">{booking.child_name}</p>
                            <p className="text-sm text-muted-foreground">{booking.slot_time}</p>
                          </div>
                          <code className="text-xs bg-white px-2 py-1 rounded">{booking.booking_code}</code>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="sessions">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2"><Clock className="h-5 w-5 text-primary" /> Active Play Sessions</CardTitle>
                <CardDescription>Currently playing - monitor session times</CardDescription>
              </CardHeader>
              <CardContent>
                {activeSessions.length === 0 ? (
                  <p className="text-muted-foreground text-center py-12">No active sessions</p>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {activeSessions.map((session) => (
                      <Card key={session.id} className={`rounded-xl ${session.warning ? 'border-2 border-destructive' : ''}`}>
                        <CardContent className="p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-semibold">{session.child_name}</p>
                              <p className="text-sm text-muted-foreground">Started: {session.slot_time}</p>
                            </div>
                            <div className={`text-right ${session.warning ? 'text-destructive' : ''}`}>
                              <p className="text-2xl font-bold">{session.remaining_minutes}</p>
                              <p className="text-xs">min left</p>
                            </div>
                          </div>
                          {session.warning && (
                            <div className="flex items-center gap-1 text-destructive mt-2 text-sm">
                              <AlertTriangle className="h-4 w-4" /> Session ending soon!
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

          <TabsContent value="inbox">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-250px)]">
              <div className={`lg:col-span-1 flex flex-col ${mobileShowThread ? 'hidden lg:flex' : 'flex'}`}>
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
                  <div className="flex-1 overflow-y-auto">
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

              <div className={`lg:col-span-2 flex flex-col ${mobileShowThread ? 'flex' : 'hidden lg:flex'}`}>
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
                      <button onClick={() => setShowQuickReplies(!showQuickReplies)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${showQuickReplies ? 'bg-[#66A9E9] text-white border-[#66A9E9]' : 'bg-white text-[#66A9E9] border-[#66A9E9]/40 hover:bg-[#66A9E9]/10'}`}>
                        <MessageSquare className="h-3.5 w-3.5" /> Quick Replies
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto p-4 space-y-3 inbox-messages-bg">
                      {messages.length === 0 ? (
                        <div className="text-center text-gray-400 py-12"><p className="text-sm">No messages yet</p></div>
                      ) : (
                        messages.map((msg) => (
                          <div key={msg.id} className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'} message-animated`}>
                            <div className={`max-w-[72%] rounded-2xl px-4 py-2.5 shadow-sm ${msg.direction === 'outbound' ? 'bg-[#66A9E9] text-white rounded-tr-sm' : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'}`}>
                              {msg.message_type === 'text' ? (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap" dir="auto">{msg.text_body}</p>
                              ) : msg.message_type === 'image' && msg.media_url ? (
                                <div className="space-y-1">
                                  {(() => {
                                    const mediaSrc = msg.media_proxy_url || `/api/staff/inbox/media/${msg.media_url}`;
                                    return (
                                  <img
                                    src={mediaSrc}
                                    alt="صورة"
                                    className="max-w-[220px] rounded-xl cursor-pointer hover:opacity-90 transition-opacity"
                                    onClick={() => setPreviewImageSrc(mediaSrc)}
                                    onError={(e) => { e.target.style.display='none'; e.target.nextSibling.style.display='block'; }}
                                  />
                                    );
                                  })()}
                                  <p className="text-xs italic opacity-70 hidden">📷 صورة</p>
                                  {msg.text_body ? <p className="text-sm mt-1" dir="auto">{msg.text_body}</p> : null}
                                </div>
                              ) : msg.message_type === 'video' && msg.media_url ? (
                                <div className="space-y-1">
                                  <video
                                    src={msg.media_proxy_url || `/api/staff/inbox/media/${msg.media_url}`}
                                    controls
                                    className="max-w-[220px] rounded-xl"
                                  />
                                  {msg.text_body ? <p className="text-sm mt-1" dir="auto">{msg.text_body}</p> : null}
                                </div>
                              ) : msg.message_type === 'audio' && msg.media_url ? (
                                <audio src={msg.media_proxy_url || `/api/staff/inbox/media/${msg.media_url}`} controls className="max-w-[220px]" />
                              ) : msg.message_type === 'document' && msg.media_url ? (
                                <a
                                  href={msg.media_proxy_url || `/api/staff/inbox/media/${msg.media_url}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-2 text-sm underline"
                                >
                                  📄 {msg.text_body || 'مستند'}
                                </a>
                              ) : msg.message_type === 'sticker' && msg.media_url ? (
                                <img
                                  src={msg.media_proxy_url || `/api/staff/inbox/media/${msg.media_url}`}
                                  alt="ملصق"
                                  className="max-w-[100px]"
                                />
                              ) : (
                                <p className="text-sm italic opacity-70">
                                  {msg.message_type === 'location' ? msg.text_body : `[${msg.message_type}]`}
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
                              <div className="border-t pt-2 mt-1">
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

                    <div className="border-t bg-white px-4 py-3 flex-shrink-0">
                      {imagePreview && (
                        <div className="mb-2 flex flex-wrap gap-2">
                          {(Array.isArray(imagePreview) ? imagePreview : [imagePreview]).map((url, idx) => (
                            <div key={idx} className="relative">
                              <img src={url} alt="preview" className="h-16 w-16 rounded-xl object-cover border border-gray-200" />
                              {idx === 0 && (
                                <button
                                  onClick={() => { setImageFile(null); setImagePreview(null); if (imageInputRef.current) imageInputRef.current.value = ''; }}
                                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                          {Array.isArray(imagePreview) && imagePreview.length > 1 && (
                            <p className="text-xs text-gray-500 self-end">{imagePreview.length} صور — سيتم إرسالها بشكل منفصل</p>
                          )}
                        </div>
                      )}
                      <form onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }} className="flex items-end gap-3">
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
                          accept="image/jpeg,image/png,image/webp"
                          multiple
                          className="hidden"
                          onChange={handleImageSelect}
                        />
                        <button
                          type="button"
                          onClick={() => imageInputRef.current?.click()}
                          title="إرسال صورة"
                          className="flex-shrink-0 w-9 h-9 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-500 flex items-center justify-center transition-all"
                        >
                          <ImageIcon className="h-4 w-4" />
                        </button>
                        <textarea value={replyText} onChange={(e) => setReplyText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); handleSendMessage(); } }} placeholder="اكتب رسالة... (Enter للإرسال)" rows={2} disabled={sending} className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#66A9E9]/40 focus:border-[#66A9E9] focus:bg-white transition-all disabled:opacity-50" />
                        <button
                          type={imageFile ? 'button' : 'submit'}
                          onClick={imageFile ? handleSendImage : undefined}
                          disabled={sending || sendingImage || (!replyText.trim() && !imageFile)}
                          className="flex-shrink-0 w-11 h-11 rounded-full bg-[#66A9E9] hover:bg-[#4a8fd4] disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-all shadow-md hover:shadow-lg active:scale-95"
                        >
                          {(sending || sendingImage) ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Send className="h-5 w-5 text-white" />}
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

      <style>{`
        @keyframes messageSlideUp { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes pulseBadge { 0%, 100% { opacity: 1; } 50% { opacity: 0.6; } }
        .message-animated { animation: messageSlideUp 0.3s ease-out; }
        .pulse-badge { animation: pulseBadge 2s infinite; }
        .inbox-messages-bg { background: linear-gradient(180deg, #f0f4f8 0%, #e8eef5 100%); }
        .inbox-quick-replies-bg { background: linear-gradient(135deg, #66A9E9 0%, #4a8fd4 100%); }
      `}</style>
      </div>
    </div>
  );
}
