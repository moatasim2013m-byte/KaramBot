import React, { useEffect, useState, useRef, useCallback } from 'react';
import api from '../utils/api';
import {
  Send, Bot, UserCheck, CheckCheck, RefreshCw,
  Phone, Search, Circle
} from 'lucide-react';

// BotOff not in this lucide version — styled Bot as fallback
const BotOff = (props) => <Bot {...props} />;

const STATUS_LABELS = {
  open: { label: 'مفتوح', color: 'text-green-500' },
  human_takeover: { label: 'موظف', color: 'text-orange-500' },
  pending: { label: 'معلق', color: 'text-yellow-500' },
  resolved: { label: 'محلول', color: 'text-gray-400' },
};

function ConvItem({ conv, active, onClick }) {
  const st = STATUS_LABELS[conv.status] || STATUS_LABELS.open;
  const time = new Date(conv.last_message_at).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });

  return (
    <button
      onClick={onClick}
      className={`w-full text-right px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? 'bg-green-50' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Circle size={8} className={`fill-current ${st.color}`} />
          <span className="text-xs text-gray-400">{st.label}</span>
        </div>
        <span className="text-xs text-gray-400">{time}</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="font-medium text-sm text-gray-800 truncate">
          {conv.profile_name || conv.customer_wa_id}
        </div>
        {conv.unread_count > 0 && (
          <span className="bg-green-500 text-white text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center">
            {conv.unread_count}
          </span>
        )}
      </div>
      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
        {conv.ai_enabled ? <Bot size={10} className="text-green-400" /> : <BotOff size={10} className="text-gray-300" />}
        {conv.customer_wa_id}
      </div>
    </button>
  );
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound';
  const time = new Date(msg.created_at).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });

  return (
    <div className={`flex ${isOut ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-xs lg:max-w-md px-3 py-2 text-sm ${isOut ? 'msg-outbound' : 'msg-inbound'}`}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text_body || '[مرفق]'}</div>
        <div className={`text-xs mt-1 flex items-center gap-1 ${isOut ? 'text-green-200' : 'text-gray-400'} justify-end`}>
          {time}
          {isOut && msg.is_ai_generated && <Bot size={10} />}
          {isOut && !msg.is_ai_generated && <UserCheck size={10} />}
        </div>
      </div>
    </div>
  );
}

export default function InboxPage() {
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const messagesEndRef = useRef(null);

  const loadConversations = useCallback(async () => {
    const params = {};
    if (statusFilter) params.status = statusFilter;
    if (search) params.search = search;
    const res = await api.get('/inbox/conversations', { params });
    setConversations(res.data.conversations || []);
  }, [statusFilter, search]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Poll for new conversations every 10s
  useEffect(() => {
    const interval = setInterval(loadConversations, 10000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  const loadMessages = async (conv) => {
    setSelected(conv);
    setLoadingMsgs(true);
    try {
      const res = await api.get(`/inbox/conversations/${conv._id}/messages`);
      setMessages(res.data.messages || []);
      setSelected(res.data.conversation || conv);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMsgs(false);
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll messages for selected conversation
  useEffect(() => {
    if (!selected) return;
    const interval = setInterval(async () => {
      const res = await api.get(`/inbox/conversations/${selected._id}/messages`);
      setMessages(res.data.messages || []);
    }, 5000);
    return () => clearInterval(interval);
  }, [selected]);

  const sendReply = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      await api.post(`/inbox/conversations/${selected._id}/send`, { text: replyText });
      setReplyText('');
      const res = await api.get(`/inbox/conversations/${selected._id}/messages`);
      setMessages(res.data.messages || []);
    } catch (err) {
      alert('فشل الإرسال: ' + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  const handleTakeover = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected._id}/takeover`);
    const res = await api.get(`/inbox/conversations/${selected._id}/messages`);
    setSelected(res.data.conversation);
    loadConversations();
  };

  const handleEnableAI = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected._id}/enable-ai`);
    const res = await api.get(`/inbox/conversations/${selected._id}/messages`);
    setSelected(res.data.conversation);
    loadConversations();
  };

  const handleResolve = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected._id}/resolve`);
    loadConversations();
    setSelected(null);
    setMessages([]);
  };

  return (
    <div className="flex h-full gap-0 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden" style={{ height: 'calc(100vh - 120px)' }}>
      {/* Conversation list */}
      <div className="w-72 flex-shrink-0 border-l border-gray-200 flex flex-col">
        <div className="p-3 border-b border-gray-100">
          <div className="relative mb-2">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="بحث..."
              className="w-full border border-gray-200 rounded-lg pr-8 pl-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none"
          >
            <option value="">كل المحادثات</option>
            <option value="open">مفتوح</option>
            <option value="human_takeover">موظف</option>
            <option value="pending">معلق</option>
            <option value="resolved">محلول</option>
          </select>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 && (
            <div className="text-center py-12 text-gray-400 text-sm">لا توجد محادثات</div>
          )}
          {conversations.map(conv => (
            <ConvItem
              key={conv._id}
              conv={conv}
              active={selected?._id === conv._id}
              onClick={() => loadMessages(conv)}
            />
          ))}
        </div>
      </div>

      {/* Chat area */}
      {!selected ? (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <div className="text-center">
            <div className="text-4xl mb-3">💬</div>
            <div>اختر محادثة للبدء</div>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col">
          {/* Chat header */}
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <div>
              <div className="font-semibold text-gray-800">
                {selected.profile_name || selected.customer_wa_id}
              </div>
              <div className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Phone size={10} />
                {selected.customer_wa_id}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {selected.ai_enabled ? (
                <button
                  onClick={handleTakeover}
                  className="flex items-center gap-1 text-xs bg-orange-100 text-orange-600 px-3 py-1.5 rounded-lg hover:bg-orange-200"
                >
                  <UserCheck size={12} />
                  تولي المحادثة
                </button>
              ) : (
                <button
                  onClick={handleEnableAI}
                  className="flex items-center gap-1 text-xs bg-green-100 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-200"
                >
                  <Bot size={12} />
                  تفعيل AI
                </button>
              )}
              <button
                onClick={handleResolve}
                className="flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-3 py-1.5 rounded-lg hover:bg-gray-200"
              >
                <CheckCheck size={12} />
                إنهاء
              </button>
              <button onClick={() => loadMessages(selected)} className="text-gray-400 hover:text-gray-600">
                <RefreshCw size={14} />
              </button>
            </div>
          </div>

          {/* AI badge */}
          <div className={`text-center text-xs py-1.5 ${selected.ai_enabled ? 'bg-green-50 text-green-600' : 'bg-orange-50 text-orange-600'}`}>
            {selected.ai_enabled ? '🤖 الذكاء الاصطناعي يرد تلقائياً' : '👤 موظف يدير المحادثة'}
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {loadingMsgs && <div className="text-center text-gray-400 py-8">جاري التحميل...</div>}
            {messages.map(msg => <MessageBubble key={msg._id} msg={msg} />)}
            <div ref={messagesEndRef} />
          </div>

          {/* Reply box */}
          <div className="border-t border-gray-100 p-3 bg-white">
            <div className="flex items-end gap-2">
              <textarea
                value={replyText}
                onChange={e => setReplyText(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendReply(); } }}
                placeholder="اكتب رسالتك..."
                rows={2}
                className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <button
                onClick={sendReply}
                disabled={sending || !replyText.trim()}
                className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white p-2.5 rounded-xl flex-shrink-0"
              >
                <Send size={16} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
