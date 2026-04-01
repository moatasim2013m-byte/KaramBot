import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
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

export default function StaffPage() {
  const { api, user } = useAuth();
  const navigate = useNavigate();
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

  const handleSendMessage = async (e) => {
    e.preventDefault();
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
                <Card className="rounded-2xl flex-1 flex flex-col">
                  <CardHeader className="pb-3">
                    <div className="flex items-center justify-between">
                      <CardTitle className="font-heading flex items-center gap-2">
                        <MessageSquare className="h-5 w-5 text-primary" />
                        Conversations
                      </CardTitle>
                      <Button 
                        size="sm" 
                        variant="ghost"
                        onClick={() => {
                          fetchConversations();
                          fetchInboxStats();
                        }}
                        className="rounded-full"
                      >
                        <RefreshCw className="h-4 w-4" />
                      </Button>
                    </div>
                    {inboxStats && (
                      <div className="flex gap-2 mt-2">
                        <Badge variant="outline">{inboxStats.total_conversations} total</Badge>
                        {inboxStats.unread_messages > 0 && (
                          <Badge className="bg-red-500">{inboxStats.unread_messages} unread</Badge>
                        )}
                      </div>
                    )}
                  </CardHeader>
                  
                  <div className="px-4 pb-3 space-y-2">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        value={inboxSearch}
                        onChange={(e) => setInboxSearch(e.target.value)}
                        placeholder="Search conversations..."
                        className="pl-9 rounded-xl"
                      />
                    </div>
                    <Button
                      size="sm"
                      variant={showUnreadOnly ? 'default' : 'outline'}
                      onClick={() => setShowUnreadOnly(!showUnreadOnly)}
                      className="w-full rounded-xl"
                    >
                      <Filter className="h-4 w-4 mr-2" />
                      {showUnreadOnly ? 'Show All' : 'Unread Only'}
                    </Button>
                  </div>

                  <CardContent className="flex-1 overflow-y-auto p-2">
                    {inboxLoading ? (
                      <div className="flex justify-center items-center py-12">
                        <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      </div>
                    ) : conversations.length === 0 ? (
                      <p className="text-muted-foreground text-center py-12">No conversations</p>
                    ) : (
                      <div className="space-y-2">
                        {conversations.map((conv) => (
                          <button
                            key={conv.wa_id}
                            onClick={() => handleConversationSelect(conv)}
                            className={`w-full text-left p-3 rounded-xl transition-all ${
                              selectedConversation?.wa_id === conv.wa_id
                                ? 'bg-primary/10 border-2 border-primary'
                                : 'bg-white hover:bg-muted/50 border border-transparent'
                            }`}
                          >
                            <div className="flex justify-between items-start mb-1">
                              <span className="font-semibold truncate">{conv.profile_name || 'No Name Available'}</span>
                              {conv.unread_count > 0 && (
                                <Badge className="bg-red-500 text-xs">{conv.unread_count}</Badge>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground truncate mb-1">
                              {conv.last_message.direction === 'inbound' ? '↓ ' : '↑ '}
                              {conv.last_message.text || '[Media]'}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(conv.last_message.timestamp).toLocaleString('ar-JO', {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              })}
                            </p>
                          </button>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Message Thread */}
              <div className="lg:col-span-2 flex flex-col">
                {!selectedConversation ? (
                  <Card className="rounded-2xl flex-1 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                      <MessageSquare className="h-16 w-16 mx-auto mb-4 opacity-30" />
                      <p>Select a conversation to view messages</p>
                    </div>
                  </Card>
                ) : (
                  <Card className="rounded-2xl flex-1 flex flex-col">
                    {/* Chat Header */}
                    <CardHeader className="border-b pb-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <CardTitle className="font-heading">
                            {selectedConversation.profile_name || 'No Name Available'}
                          </CardTitle>
                          <p className="text-sm text-muted-foreground">
                            WhatsApp: {selectedConversation.wa_id}
                          </p>
                          {customerProfile?.found && (
                            <div className="flex gap-2 mt-2">
                              <Badge variant="outline" className="text-xs">
                                Customer: {customerProfile.user.name}
                              </Badge>
                              {customerProfile.children?.length > 0 && (
                                <Badge variant="outline" className="text-xs">
                                  {customerProfile.children.length} {customerProfile.children.length === 1 ? 'child' : 'children'}
                                </Badge>
                              )}
                            </div>
                          )}
                        </div>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => setShowQuickReplies(!showQuickReplies)}
                          className="rounded-full"
                        >
                          <MessageSquare className="h-4 w-4 mr-2" />
                          Quick Replies
                        </Button>
                      </div>
                    </CardHeader>

                    {/* Messages */}
                    <CardContent className="flex-1 overflow-y-auto p-4 bg-muted/20">
                      {messages.length === 0 ? (
                        <div className="text-center text-muted-foreground py-12">
                          <p>No messages yet</p>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          {messages.map((msg) => (
                            <div
                              key={msg.id}
                              className={`flex ${msg.direction === 'outbound' ? 'justify-end' : 'justify-start'}`}
                            >
                              <div
                                className={`max-w-[70%] rounded-2xl px-4 py-2 ${
                                  msg.direction === 'outbound'
                                    ? 'bg-primary text-white'
                                    : 'bg-white border'
                                }`}
                              >
                                {msg.message_type === 'text' ? (
                                  <p className="whitespace-pre-wrap">{msg.text_body}</p>
                                ) : (
                                  <p className="italic opacity-70">[{msg.message_type}]</p>
                                )}
                                <div className={`flex items-center gap-2 mt-1 text-xs ${
                                  msg.direction === 'outbound' ? 'text-white/70' : 'text-muted-foreground'
                                }`}>
                                  <span>
                                    {new Date(msg.timestamp).toLocaleTimeString('ar-JO', {
                                      hour: '2-digit',
                                      minute: '2-digit'
                                    })}
                                  </span>
                                  {msg.direction === 'outbound' && msg.status && (
                                    <span>• {msg.status}</span>
                                  )}
                                  {msg.sent_by_staff && (
                                    <span>• {msg.sent_by_staff.name}</span>
                                  )}
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </CardContent>

                    {/* Quick Replies Dropdown */}
                    {showQuickReplies && quickReplies.length > 0 && (
                      <div className="border-t bg-muted/30 p-3">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-semibold">Quick Replies</span>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setShowQuickReplies(false)}
                            className="rounded-full h-6 w-6 p-0"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto">
                          {quickReplies.map((qr) => (
                            <button
                              key={qr.id}
                              onClick={() => handleQuickReplySelect(qr)}
                              className="text-left p-2 rounded-lg bg-white hover:bg-primary/10 border text-sm transition-colors"
                            >
                              <p className="font-semibold truncate">{qr.label}</p>
                              <p className="text-xs text-muted-foreground truncate">
                                {qr.message.substring(0, 50)}...
                              </p>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Reply Input */}
                    <div className="border-t p-4">
                      <form onSubmit={handleSendMessage} className="flex gap-2">
                        <Input
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          placeholder="Type your message..."
                          className="flex-1 rounded-xl"
                          disabled={sending}
                        />
                        <Button
                          type="submit"
                          disabled={sending || !replyText.trim()}
                          className="rounded-full px-6"
                        >
                          {sending ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Send className="h-4 w-4 mr-2" />
                              Send
                            </>
                          )}
                        </Button>
                      </form>
                    </div>
                  </Card>
                )}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
