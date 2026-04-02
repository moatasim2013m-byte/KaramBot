import { useState, useEffect, useCallback } from 'react';
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
  Plus, Edit2, Trash2, X, Filter
} from 'lucide-react';

// Helper function for relative timestamps
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

export default function StaffPage() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('scanner');
  
  // Scanner state
  const [bookingCode, setBookingCode] = useState('');
  const [scanResult, setScanResult] = useState(null);
  const [scanning, setScanning] = useState(false);
  
  // Active sessions
  const [activeSessions, setActiveSessions] = useState([]);
  const [pendingCheckins, setPendingCheckins] = useState([]);
  
  // Subscription state
  const [childSearch, setChildSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedChild, setSelectedChild] = useState(null);
  const [childSubscription, setChildSubscription] = useState(null);
  const [consuming, setConsuming] = useState(false);
  
  // Birthday parties
  const [todayParties, setTodayParties] = useState([]);
  
  // Inbox state
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

  // Check if user is staff or admin
  useEffect(() => {
    if (user && user.role !== 'staff' && user.role !== 'admin') {
      navigate('/');
    }
    setLoading(false);
  }, [user, navigate]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const requestedTab = params.get('tab');
    if (requestedTab === 'inbox') {
      setActiveTab('inbox');
    }
  }, [location.search]);

  const fetchActiveSessions = useCallback(async () => {
    try {
      const response = await api.get('/staff/active-sessions');
      setActiveSessions(response.data.sessions || []);
    } catch (error) {
      console.error('Failed to fetch active sessions:', error);
    }
  }, [api]);

  const fetchPendingCheckins = useCallback(async () => {
    try {
      const response = await api.get('/staff/pending-checkins');
      setPendingCheckins(response.data.bookings || []);
    } catch (error) {
      console.error('Failed to fetch pending check-ins:', error);
    }
  }, [api]);

  const fetchTodayParties = useCallback(async () => {
    try {
      const response = await api.get('/staff/today-birthdays');
      setTodayParties(response.data.parties || []);
    } catch (error) {
      console.error('Failed to fetch birthday parties:', error);
    }
  }, [api]);

  useEffect(() => {
    fetchActiveSessions();
    fetchPendingCheckins();
    fetchTodayParties();
    
    // Poll active sessions every 30 seconds
    const interval = setInterval(fetchActiveSessions, 30000);
    return () => clearInterval(interval);
  }, [fetchActiveSessions, fetchPendingCheckins, fetchTodayParties]);

  // QR Scanner - Check in
  const handleCheckin = async (e) => {
    e.preventDefault();
    if (!bookingCode.trim()) {
      toast.error('Please enter a booking code');
      return;
    }

    setScanning(true);
    setScanResult(null);

    try {
      const response = await api.post('/staff/checkin', {
        booking_code: bookingCode.toUpperCase().trim()
      });
      
      setScanResult({
        success: true,
        data: response.data
      });
      toast.success('Check-in successful!');
      setBookingCode('');
      fetchActiveSessions();
      fetchPendingCheckins();
    } catch (error) {
      setScanResult({
        success: false,
        error: error.response?.data?.error || 'Check-in failed'
      });
      toast.error(error.response?.data?.error || 'Check-in failed');
    } finally {
      setScanning(false);
    }
  };

  // Search children for subscription
  const handleChildSearch = async (value) => {
    setChildSearch(value);
    setSelectedChild(null);
    setChildSubscription(null);
    
    if (value.length < 2) {
      setSearchResults([]);
      return;
    }

    try {
      const response = await api.get(`/staff/search-child?name=${encodeURIComponent(value)}`);
      setSearchResults(response.data.children || []);
    } catch (error) {
      console.error('Search failed:', error);
    }
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
      if (error.response?.status !== 404) {
        toast.error('Failed to fetch subscription');
      }
    }
  };

  const handleConsumeVisit = async () => {
    if (!selectedChild) return;

    setConsuming(true);
    try {
      const response = await api.post('/staff/consume-visit', {
        child_id: selectedChild.id
      });
      
      toast.success(`Visit consumed! ${response.data.remaining_visits} visits remaining`);
      
      // Refresh subscription info
      const subResponse = await api.get(`/staff/subscription/${selectedChild.id}`);
      setChildSubscription(subResponse.data.subscription);
    } catch (error) {
      toast.error(error.response?.data?.error || 'Failed to consume visit');
    } finally {
      setConsuming(false);
    }
  };

  // ==================== INBOX FUNCTIONS ====================
  
  const fetchInboxStats = useCallback(async () => {
    try {
      const response = await api.get('/staff/inbox/stats');
      setInboxStats(response.data);
    } catch (error) {
      console.error('Failed to fetch inbox stats:', error);
    }
  }, [api]);

  const fetchConversations = useCallback(async () => {
    try {
      setInboxLoading(true);
      const params = new URLSearchParams();
      if (inboxSearch) params.append('search', inboxSearch);
      if (showUnreadOnly) params.append('unread_only', 'true');
      
      const response = await api.get(`/staff/inbox/conversations?${params}`);
      setConversations(response.data.conversations || []);
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      toast.error('فشل تحميل المحادثات');
    } finally {
      setInboxLoading(false);
    }
  }, [api, inboxSearch, showUnreadOnly]);

  const fetchMessages = useCallback(async (waId) => {
    try {
      const response = await api.get(`/staff/inbox/messages/${waId}`);
      setMessages(response.data.messages || []);
    } catch (error) {
      console.error('Failed to fetch messages:', error);
      toast.error('فشل تحميل الرسائل');
    }
  }, [api]);

  const fetchCustomerProfile = useCallback(async (waId) => {
    try {
      const response = await api.get(`/staff/inbox/customer-profile/${waId}`);
      setCustomerProfile(response.data);
    } catch (error) {
      console.error('Failed to fetch customer profile:', error);
    }
  }, [api]);

  const fetchQuickReplies = useCallback(async () => {
    try {
      const response = await api.get('/staff/inbox/quick-replies?platform=whatsapp');
      setQuickReplies(response.data.quick_replies || []);
    } catch (error) {
      console.error('Failed to fetch quick replies:', error);
    }
  }, [api]);

  const handleConversationSelect = (conv) => {
    setSelectedConversation(conv);
    setMessages([]);
    setCustomerProfile(null);
    fetchMessages(conv.wa_id);
    fetchCustomerProfile(conv.wa_id);
  };

  const handleSendMessage = async () => {
    if (!replyText.trim() || !selectedConversation) return;

    setSending(true);
    try {
      await api.post('/staff/inbox/send', {
        wa_id: selectedConversation.wa_id,
        message: replyText
      });

      toast.success('تم إرسال الرسالة');
      setReplyText('');
      
      // Refresh messages
      await fetchMessages(selectedConversation.wa_id);
      await fetchConversations();
      await fetchInboxStats();
    } catch (error) {
      console.error('Failed to send message:', error);
      toast.error('فشل إرسال الرسالة');
    } finally {
      setSending(false);
    }
  };

  const handleQuickReplySelect = (quickReply) => {
    setReplyText(quickReply.message);
    setShowQuickReplies(false);
    
    // Track usage
    api.post(`/staff/inbox/quick-replies/${quickReply.id}/use`).catch(console.error);
  };

  useEffect(() => {
    if (activeTab === 'inbox') {
      fetchInboxStats();
      fetchConversations();
      fetchQuickReplies();
      
      // Poll for new messages every 8 seconds
      const pollInterval = setInterval(() => {
        fetchConversations();
        if (selectedConversation) {
          fetchMessages(selectedConversation.wa_id);
        }
      }, 8000);
      
      return () => clearInterval(pollInterval);
    }
  }, [activeTab, fetchInboxStats, fetchConversations, fetchQuickReplies, selectedConversation, fetchMessages]);

  // ==================== END INBOX FUNCTIONS ====================

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
          <Button 
            variant="outline" 
            onClick={() => {
              fetchActiveSessions();
              fetchPendingCheckins();
              fetchTodayParties();
            }}
            className="rounded-full gap-2"
          >
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="bg-white border rounded-full p-1">
            <TabsTrigger value="scanner" className="rounded-full gap-2" data-testid="tab-scanner">
              <QrCode className="h-4 w-4" /> QR Scanner
            </TabsTrigger>
            <TabsTrigger value="sessions" className="rounded-full gap-2" data-testid="tab-sessions">
              <Clock className="h-4 w-4" /> Active Sessions
              {activeSessions.length > 0 && (
                <Badge className="ml-1 bg-primary">{activeSessions.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="rounded-full gap-2" data-testid="tab-subscriptions">
              <Star className="h-4 w-4" /> Subscriptions
            </TabsTrigger>
            <TabsTrigger value="birthdays" className="rounded-full gap-2" data-testid="tab-birthdays">
              <Cake className="h-4 w-4" /> Today's Parties
              {todayParties.length > 0 && (
                <Badge className="ml-1 bg-accent">{todayParties.length}</Badge>
              )}
            </TabsTrigger>
            <TabsTrigger value="inbox" className="rounded-full gap-2" data-testid="tab-inbox">
              <MessageSquare className="h-4 w-4" /> Inbox
              {inboxStats?.unread_messages > 0 && (
                <Badge className="ml-1 bg-red-500">{inboxStats.unread_messages}</Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* QR Scanner Tab */}
          <TabsContent value="scanner">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="rounded-2xl">
                <CardHeader>
                  <CardTitle className="font-heading flex items-center gap-2">
                    <QrCode className="h-5 w-5 text-primary" />
                    Check-in Scanner
                  </CardTitle>
                  <CardDescription>
                    Enter the booking code from the parent's QR to start their session
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handleCheckin} className="space-y-4">
                    <div>
                      <Label>Booking Code</Label>
                      <Input
                        value={bookingCode}
                        onChange={(e) => setBookingCode(e.target.value)}
                        placeholder="PK-H-XXXXXXXX"
                        className="rounded-xl h-14 text-lg uppercase mt-2"
                        data-testid="booking-code-input"
                      />
                    </div>
                    <Button 
                      type="submit" 
                      disabled={scanning || !bookingCode.trim()}
                      className="w-full rounded-full h-12"
                      data-testid="checkin-btn"
                    >
                      {scanning ? (
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                      ) : (
                        <CheckCircle className="h-5 w-5 mr-2" />
                      )}
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
                          <p className="text-sm text-green-600">
                            Session ends: {new Date(scanResult.data.session?.session_end_time).toLocaleTimeString()}
                          </p>
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

              {/* Pending Check-ins */}
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

          {/* Active Sessions Tab */}
          <TabsContent value="sessions">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2">
                  <Clock className="h-5 w-5 text-primary" />
                  Active Play Sessions
                </CardTitle>
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
                              <AlertTriangle className="h-4 w-4" />
                              Session ending soon!
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

          {/* Subscriptions Tab */}
          <TabsContent value="subscriptions">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2">
                  <Star className="h-5 w-5 text-secondary" />
                  Subscription Visit Consumption
                </CardTitle>
                <CardDescription>Search for a child and consume a subscription visit</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div>
                  <Label>Search Child by Name</Label>
                  <div className="relative mt-2">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                    <Input
                      value={childSearch}
                      onChange={(e) => handleChildSearch(e.target.value)}
                      placeholder="Type child's name..."
                      className="pl-10 rounded-xl h-12"
                      data-testid="child-search-input"
                    />
                  </div>
                  
                  {searchResults.length > 0 && (
                    <div className="mt-2 border rounded-xl overflow-hidden">
                      {searchResults.map((child) => (
                        <button
                          key={child.id}
                          onClick={() => handleSelectChild(child)}
                          className="w-full px-4 py-3 text-left hover:bg-muted transition-colors border-b last:border-b-0"
                        >
                          {child.name}
                        </button>
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
                          <div>
                            <p className="text-muted-foreground">Plan</p>
                            <p className="font-semibold">{childSubscription.plan_name}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Status</p>
                            <Badge className={childSubscription.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}>
                              {childSubscription.status === 'pending' ? 'Not activated' : childSubscription.status}
                            </Badge>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Remaining</p>
                            <p className="font-semibold text-2xl text-secondary">{childSubscription.remaining_visits}</p>
                          </div>
                          <div>
                            <p className="text-muted-foreground">Expires</p>
                            <p className="font-semibold">
                              {childSubscription.expires_at 
                                ? new Date(childSubscription.expires_at).toLocaleDateString()
                                : 'After first use'
                              }
                            </p>
                          </div>
                        </div>
                        
                        <Button
                          onClick={handleConsumeVisit}
                          disabled={consuming || childSubscription.remaining_visits === 0}
                          className="w-full rounded-full bg-secondary hover:bg-secondary/90"
                          data-testid="consume-visit-btn"
                        >
                          {consuming ? (
                            <Loader2 className="h-5 w-5 animate-spin mr-2" />
                          ) : (
                            <Star className="h-5 w-5 mr-2" />
                          )}
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

          {/* Today's Birthdays Tab */}
          <TabsContent value="birthdays">
            <Card className="rounded-2xl">
              <CardHeader>
                <CardTitle className="font-heading flex items-center gap-2">
                  <Cake className="h-5 w-5 text-accent" />
                  Today's Birthday Parties
                </CardTitle>
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
                                <Badge className={party.status === 'confirmed' ? 'bg-green-100 text-green-700' : 'bg-purple-100 text-purple-700'}>
                                  {party.status.replace('_', ' ')}
                                </Badge>
                              </div>
                              <p className="text-muted-foreground">Theme: {party.theme}</p>
                              <p className="text-sm text-muted-foreground">Guests: {party.guest_count}</p>
                              {party.special_notes && (
                                <p className="text-sm text-accent mt-2">Notes: {party.special_notes}</p>
                              )}
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

          {/* Inbox Tab */}
          <TabsContent value="inbox">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 h-[calc(100vh-250px)]">
              {/* Conversations List */}
              <div className="lg:col-span-1 flex flex-col">
                <div className="rounded-2xl border bg-white shadow-sm flex-1 flex flex-col overflow-hidden">
                  {/* Conversations Header */}
                  <div className="px-4 py-3 border-b bg-gradient-to-r from-[#66A9E9]/10 to-white flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-[#66A9E9] flex items-center justify-center">
                        <MessageSquare className="h-4 w-4 text-white" />
                      </div>
                      <span className="font-semibold text-sm">Conversations</span>
                      {inboxStats?.unread_messages > 0 && (
                        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#D9232E] text-white text-xs font-bold pulse-badge">
                          {inboxStats.unread_messages}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => { fetchConversations(); fetchInboxStats(); }}
                      className="w-7 h-7 rounded-full hover:bg-[#66A9E9]/10 flex items-center justify-center transition-colors"
                    >
                      <RefreshCw className="h-4 w-4 text-[#66A9E9]" />
                    </button>
                  </div>

                  {/* Search & Filter */}
                  <div className="px-3 py-2 space-y-2 border-b bg-gray-50">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400" />
                      <input
                        value={inboxSearch}
                        onChange={(e) => setInboxSearch(e.target.value)}
                        placeholder="Search conversations..."
                        className="w-full pl-8 pr-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#66A9E9]/40 focus:border-[#66A9E9]"
                      />
                    </div>
                    <button
                      onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                      className={`w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
                        showUnreadOnly
                          ? 'bg-[#D9232E] text-white shadow-sm'
                          : 'bg-white border border-gray-200 text-gray-600 hover:border-[#D9232E] hover:text-[#D9232E]'
                      }`}
                    >
                      <Filter className="h-3 w-3" />
                      {showUnreadOnly ? 'Show All' : 'Unread Only'}
                    </button>
                  </div>

                  {/* Conversation List */}
                  <div className="flex-1 overflow-y-auto">
                    {inboxLoading ? (
                      <div className="flex justify-center items-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-[#66A9E9]" />
                      </div>
                    ) : conversations.length === 0 ? (
                      <div className="text-center py-12 text-gray-400">
                        <MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-20" />
                        <p className="text-sm">No conversations</p>
                      </div>
                    ) : (
                      conversations.map((conv) => (
                        <button
                          key={conv.wa_id}
                          onClick={() => handleConversationSelect(conv)}
                          className={`w-full text-left px-4 py-3 border-b transition-all hover:bg-[#66A9E9]/5 ${
                            selectedConversation?.wa_id === conv.wa_id
                              ? 'bg-[#66A9E9]/10 border-l-4 border-l-[#66A9E9]'
                              : 'border-l-4 border-l-transparent'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-[#66A9E9] to-[#4a8fd4] flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
                              {(conv.profile_name || conv.wa_id).charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center justify-between mb-0.5">
                                <span className="font-semibold text-sm truncate text-gray-800">
                                  {conv.profile_name || 'Unknown'}
                                </span>
                                <span className="text-xs text-gray-400 flex-shrink-0 ml-1">
                                  {getRelativeTime(conv.last_message.timestamp)}
                                </span>
                              </div>
                              <div className="flex items-center justify-between">
                                <p className="text-xs text-gray-500 truncate">
                                  {conv.last_message.direction === 'inbound' ? '' : '↑ '}
                                  {conv.last_message.text || '[Media]'}
                                </p>
                                {conv.unread_count > 0 && (
                                  <span className="ml-1 flex-shrink-0 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[#D9232E] text-white text-xs font-bold pulse-badge px-1">
                                    {conv.unread_count}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))
                    )}
                  </div>
                </div>
              </div>

              {/* Message Thread */}
              <div className="lg:col-span-2 flex flex-col">
                {!selectedConversation ? (
                  <div className="rounded-2xl border bg-white shadow-sm flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400">
                      <div className="w-20 h-20 rounded-full bg-[#66A9E9]/10 flex items-center justify-center mx-auto mb-4">
                        <MessageSquare className="h-10 w-10 text-[#66A9E9]/40" />
                      </div>
                      <p className="font-medium text-gray-500">Select a conversation</p>
                      <p className="text-sm mt-1 text-gray-400">Choose a chat from the list to start replying</p>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl border bg-white shadow-sm flex-1 flex flex-col overflow-hidden">
                    {/* Chat Header */}
                    <div className="px-5 py-3 border-b bg-gradient-to-r from-[#66A9E9]/10 to-white flex items-center justify-between flex-shrink-0">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#66A9E9] to-[#4a8fd4] flex items-center justify-center text-white font-bold">
                          {(selectedConversation.profile_name || selectedConversation.wa_id).charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="font-semibold text-gray-800 leading-tight">
                            {selectedConversation.profile_name || 'Unknown'}
                          </p>
                          <p className="text-xs text-gray-400">+{selectedConversation.wa_id}</p>
                          {customerProfile?.found && (
                            <div className="flex gap-1.5 mt-1">
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#F2E533]/30 text-yellow-800 border border-[#F2E533]/60">
                                {customerProfile.user.name}
                              </span>
                              {customerProfile.children?.length > 0 && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#66A9E9]/15 text-[#3a7fc1] border border-[#66A9E9]/30">
                                  {customerProfile.children.length} {customerProfile.children.length === 1 ? 'child' : 'children'}
                                </span>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                      <button
                        onClick={() => setShowQuickReplies(!showQuickReplies)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                          showQuickReplies
                            ? 'bg-[#66A9E9] text-white border-[#66A9E9]'
                            : 'bg-white text-[#66A9E9] border-[#66A9E9]/40 hover:bg-[#66A9E9]/10'
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Quick Replies
                      </button>
                    </div>

                    {/* Messages */}
                    <div className="flex-1 overflow-y-auto p-4 space-y-3 inbox-messages-bg">
                      {messages.length === 0 ? (
                        <div className="text-center text-gray-400 py-12">
                          <p className="text-sm">No messages yet</p>
                        </div>
                      ) : (
                        messages.map((msg) => (
                          <div
                            key={msg.id}
                            className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'} message-animated`}
                          >
                            <div
                              className={`max-w-[72%] rounded-2xl px-4 py-2.5 shadow-sm ${
                                msg.direction === 'outbound'
                                  ? 'bg-[#66A9E9] text-white rounded-tr-sm'
                                  : 'bg-white border border-gray-100 text-gray-800 rounded-tl-sm'
                              }`}
                            >
                              {msg.message_type === 'text' ? (
                                <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.text_body}</p>
                              ) : (
                                <p className="text-sm italic opacity-70">[{msg.message_type}]</p>
                              )}
                              <div className={`flex items-center gap-1.5 mt-1 text-xs ${
                                msg.direction === 'outbound' ? 'text-white/70 justify-end' : 'text-gray-400'
                              }`}>
                                <span>
                                  {new Date(msg.timestamp).toLocaleTimeString('ar-JO', {
                                    hour: '2-digit',
                                    minute: '2-digit'
                                  })}
                                </span>
                                {msg.direction === 'outbound' && msg.status && (
                                  <span>· {msg.status}</span>
                                )}
                                {msg.sent_by_staff && (
                                  <span>· {msg.sent_by_staff.name}</span>
                                )}
                              </div>
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Quick Replies Panel */}
                    {showQuickReplies && quickReplies.length > 0 && (
                      <div className="border-t flex-shrink-0 inbox-quick-replies-bg">
                        <div className="flex items-center justify-between px-4 py-2">
                          <span className="text-sm font-semibold text-white">⚡ Quick Replies</span>
                          <button
                            onClick={() => setShowQuickReplies(false)}
                            className="w-6 h-6 rounded-full bg-white/20 hover:bg-white/30 flex items-center justify-center transition-colors"
                          >
                            <X className="h-3.5 w-3.5 text-white" />
                          </button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 px-4 pb-3 max-h-36 overflow-y-auto">
                          {quickReplies.map((qr) => (
                            <button
                              key={qr.id}
                              onClick={() => handleQuickReplySelect(qr)}
                              className="text-left p-2.5 rounded-xl bg-white/20 hover:bg-white/30 border border-white/20 transition-all text-white"
                            >
                              <p className="font-semibold text-xs truncate">{qr.label}</p>
                              <p className="text-xs text-white/70 truncate mt-0.5">
                                {qr.message.substring(0, 55)}…
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reply Input */}
                    <div className="border-t bg-white px-4 py-3 flex-shrink-0">
                      <form
                        onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                        className="flex items-end gap-3"
                      >
                        <textarea
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
                              e.preventDefault();
                              handleSendMessage();
                            }
                          }}
                          placeholder="اكتب رسالة... (Enter للإرسال)"
                          rows={2}
                          disabled={sending}
                          className="flex-1 resize-none rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-[#66A9E9]/40 focus:border-[#66A9E9] focus:bg-white transition-all disabled:opacity-50"
                        />
                        <button
                          type="submit"
                          disabled={sending || !replyText.trim()}
                          className="flex-shrink-0 w-11 h-11 rounded-full bg-[#66A9E9] hover:bg-[#4a8fd4] disabled:bg-gray-200 disabled:cursor-not-allowed flex items-center justify-center transition-all shadow-md hover:shadow-lg active:scale-95"
                        >
                          {sending ? (
                            <Loader2 className="h-5 w-5 text-white animate-spin" />
                          ) : (
                            <Send className="h-5 w-5 text-white" />
                          )}
                        </button>
                      </form>
                      <p className="text-xs text-gray-400 mt-1.5 pl-1">WhatsApp · {selectedConversation.wa_id}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>

      <style>{`
        @keyframes messageSlideUp {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes pulseBadge {
          0%,
          100% {
            opacity: 1;
          }
          50% {
            opacity: 0.6;
          }
        }

        .message-animated {
          animation: messageSlideUp 0.3s ease-out;
        }

        .pulse-badge {
          animation: pulseBadge 2s infinite;
        }

        .inbox-messages-bg {
          background: linear-gradient(180deg, #f0f4f8 0%, #e8eef5 100%);
        }

        .inbox-quick-replies-bg {
          background: linear-gradient(135deg, #66A9E9 0%, #4a8fd4 100%);
        }
      `}</style>

      </div>
    </div>
  );
}
