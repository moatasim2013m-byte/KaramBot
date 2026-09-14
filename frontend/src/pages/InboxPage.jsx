import React, { useEffect, useState, useRef, useCallback } from 'react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import {
  Send, Bot, UserCheck, CheckCheck, RefreshCw,
  Phone, Search, Circle, AlertTriangle, Clock,
  ChevronDown, ChevronUp, Pencil, Undo2, Check, X
} from 'lucide-react';

// BotOff not in this lucide version — styled Bot as fallback
const BotOff = (props) => <Bot {...props} />;

const STATUS_LABELS = {
  open: { label: 'مفتوح', color: 'text-green-500' },
  human_takeover: { label: 'موظف', color: 'text-orange-500' },
  pending: { label: 'معلق', color: 'text-yellow-500' },
  resolved: { label: 'محلول', color: 'text-gray-400' },
};

const STAGE_LABELS = {
  opening: 'بداية', discovery: 'اكتشاف', fit: 'ملاءمة', sample: 'مثال', roleplay_setup: 'تجهيز مثال',
  roleplay: 'مثال جاري', objection: 'اعتراض', close: 'إغلاق', captured: 'طلب مكالمة', handoff: 'تحويل', closed: 'مغلق',
};

const NEEDS_TEAM_LABELS = {
  quote: 'عرض سعر', meeting: 'مكالمة', person: 'شخص', complaint: 'شكوى', demo: 'عرض تجريبي',
  unknown: 'سؤال', ai_failure: 'تعطّل البوت',
};

const SECTOR_LABELS = { clinic: 'عيادة', restaurant: 'مطعم', store: 'متجر', other: 'غير ذلك' };
const LANGUAGE_LABELS = { ar: 'عربي', en: 'إنجليزي' };
const INTEREST_LABELS = { hot: 'ساخن', warm: 'دافئ', cold: 'بارد' };

// The lead fields staff may edit (the backend whitelist). Enum fields use a <select> because the
// server silently drops values outside the enum.
const LEAD_FIELDS = [
  { key: 'name', label: 'الاسم' },
  { key: 'business_name', label: 'اسم المنشأة' },
  { key: 'sector', label: 'القطاع', options: SECTOR_LABELS },
  { key: 'sector_text', label: 'النشاط' },
  { key: 'city', label: 'المدينة' },
  { key: 'need', label: 'الاحتياج', list: true },
  { key: 'preferred_time', label: 'الوقت المفضّل' },
  { key: 'budget_note', label: 'الميزانية' },
  { key: 'language', label: 'اللغة', options: LANGUAGE_LABELS },
  { key: 'interest', label: 'الاهتمام', options: INTEREST_LABELS },
];

const WINDOW_MS = 24 * 60 * 60 * 1000;
// The batcher stops retrying after this many failed deliveries (replyBatcher MAX_REPLY_FAILURES).
const MAX_REPLY_FAILURES = 3;

// The bot gave up: the customer has no reply until someone answers by hand.
function replyGaveUp(conv) {
  return Number(conv?.metadata?.reply_failures) >= MAX_REPLY_FAILURES;
}

function openNeedsTeam(conv) {
  const nt = conv?.workflow_data?.needs_team;
  return nt && !nt.resolved_at ? nt : null;
}

// Pending (needs the team) first, then newest activity — the same order the API returns per page.
function sortConversations(list) {
  return [...list].sort((a, b) => {
    const pa = a.status === 'pending' ? 0 : 1;
    const pb = b.status === 'pending' ? 0 : 1;
    if (pa !== pb) return pa - pb;
    return new Date(b.last_message_at || 0) - new Date(a.last_message_at || 0);
  });
}

function leadFieldText(lead, field) {
  const value = lead?.[field.key];
  if (value === undefined || value === null || value === '') return '';
  if (field.list) return Array.isArray(value) ? value.join('، ') : String(value);
  if (field.key === 'preferred_time') return typeof value === 'object' ? value.text || '' : String(value);
  if (field.options) return field.options[value] || String(value);
  return String(value);
}

function useNow(intervalMs) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// `isShift`: the lead line, stage and team badges are SHIFT sales data. Restaurant, clinic and
// external-mode tenants keep their Inbox as it was (their current_state is a workflow state).
function ConvItem({ conv, active, onClick, isShift }) {
  const st = STATUS_LABELS[conv.status] || STATUS_LABELS.open;
  const time = new Date(conv.last_message_at).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
  const lead = conv.workflow_data?.lead || {};
  const leadLine = isShift
    ? [SECTOR_LABELS[lead.sector] || lead.sector, lead.sector_text, lead.business_name].filter(Boolean).join(' · ')
    : '';
  const needsTeam = isShift && conv.status === 'pending' ? openNeedsTeam(conv) : null;
  const gaveUp = isShift && replyGaveUp(conv);

  return (
    <button
      onClick={onClick}
      className={`w-full text-right px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${active ? 'bg-green-50' : ''}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <Circle size={8} className={`fill-current ${st.color}`} />
          <span className="text-xs text-gray-400">{st.label}</span>
          {isShift && conv.current_state && (
            <span className="text-[10px] bg-gray-100 text-gray-500 rounded px-1.5 py-0.5">
              {STAGE_LABELS[conv.current_state] || conv.current_state}
            </span>
          )}
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
      {leadLine && <div className="text-xs text-gray-500 mt-0.5 truncate">{leadLine}</div>}
      <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1">
        {conv.ai_enabled ? <Bot size={10} className="text-green-400" /> : <BotOff size={10} className="text-gray-300" />}
        {conv.customer_wa_id}
      </div>
      {(needsTeam || conv.awaiting_staff > 0 || gaveUp) && (
        <div className="flex flex-wrap gap-1 mt-1">
          {gaveUp && (
            <span className="text-[10px] bg-red-100 text-red-700 rounded px-1.5 py-0.5">بدون رد</span>
          )}
          {needsTeam && (
            <span className="text-[10px] bg-orange-100 text-orange-700 rounded px-1.5 py-0.5">
              يحتاج الفريق: {NEEDS_TEAM_LABELS[needsTeam.reason] || needsTeam.reason}
            </span>
          )}
          {conv.awaiting_staff > 0 && (
            <span className="text-[10px] bg-amber-100 text-amber-700 rounded px-1.5 py-0.5">بانتظار الموظف</span>
          )}
        </div>
      )}
    </button>
  );
}

function MessageBubble({ msg }) {
  const isOut = msg.direction === 'outbound';
  const time = new Date(msg.created_at).toLocaleTimeString('ar-JO', { hour: '2-digit', minute: '2-digit' });
  const awaitingStaff = !isOut && msg.status === 'awaiting_staff';
  const unconfirmedSend = isOut && (msg.status === 'ambiguous' || msg.status === 'ambiguous_unreconciled');

  return (
    <div className={`flex ${isOut ? 'justify-start' : 'justify-end'} mb-2`}>
      <div className={`max-w-xs lg:max-w-md px-3 py-2 text-sm ${isOut ? 'msg-outbound' : 'msg-inbound'}`}>
        <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text_body || '[مرفق]'}</div>
        <div className={`text-xs mt-1 flex items-center gap-1 ${isOut ? 'text-green-200' : 'text-gray-400'} justify-end`}>
          {awaitingStaff && <span className="text-amber-600">بانتظار الموظف ·</span>}
          {unconfirmedSend && <span className="text-yellow-200">إرسال غير مؤكد ·</span>}
          {time}
          {isOut && msg.is_ai_generated && <Bot size={10} />}
          {isOut && !msg.is_ai_generated && <UserCheck size={10} />}
        </div>
      </div>
    </div>
  );
}

// Free-form replies are only possible for 24 h after the customer's last message.
function WindowCountdown({ lastInboundAt }) {
  const now = useNow(30000);
  if (!lastInboundAt) return null;
  const remaining = new Date(lastInboundAt).getTime() + WINDOW_MS - now;
  if (remaining <= 0) {
    return <span className="text-xs text-red-600 font-medium">النافذة مسكّرة — اتصل</span>;
  }
  const totalMinutes = Math.floor(remaining / 60000);
  const hh = String(Math.floor(totalMinutes / 60)).padStart(2, '0');
  const mm = String(totalMinutes % 60).padStart(2, '0');
  return (
    <span className="text-xs text-gray-500 flex items-center gap-1">
      <Clock size={10} />
      النافذة تسكر بعد {hh}:{mm}
    </span>
  );
}

function LeadFieldRow({ field, lead, onSave }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const text = leadFieldText(lead, field);

  const startEdit = () => {
    const raw = lead?.[field.key];
    setDraft(field.options ? (raw || '') : text);
    setEditing(true);
  };

  const save = async () => {
    const value = draft.trim();
    // The lead merge ignores empty values, so an empty save would silently do nothing.
    if (!value) { setEditing(false); return; }
    const payload = field.list ? value.split(/[,،]/).map((s) => s.trim()).filter(Boolean) : value;
    setSaving(true);
    const ok = await onSave(field.key, payload);
    setSaving(false);
    if (ok) setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 py-1 text-xs">
      <span className="w-24 flex-shrink-0 text-gray-400">{field.label}</span>
      {editing ? (
        <div className="flex-1 flex items-center gap-1">
          {field.options ? (
            <select
              value={draft}
              onChange={e => setDraft(e.target.value)}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none"
            >
              <option value="">—</option>
              {Object.entries(field.options).map(([v, label]) => <option key={v} value={v}>{label}</option>)}
            </select>
          ) : (
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); save(); }
                if (e.key === 'Escape') setEditing(false);
              }}
              placeholder={field.list ? 'افصل بفاصلة' : ''}
              className="flex-1 border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-green-500"
            />
          )}
          <button onClick={save} disabled={saving} className="flex items-center gap-0.5 text-green-600 hover:text-green-700 disabled:opacity-50">
            <Check size={12} />
            حفظ
          </button>
          <button onClick={() => setEditing(false)} className="text-gray-400 hover:text-gray-600">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button onClick={startEdit} className="flex-1 flex items-center justify-between text-right text-gray-700 hover:bg-gray-50 rounded px-1 py-0.5 group">
          <span className={text ? '' : 'text-gray-300'}>{text || '—'}</span>
          <Pencil size={10} className="text-gray-300 group-hover:text-gray-500" />
        </button>
      )}
    </div>
  );
}

function LeadCard({ conversation, onChanged }) {
  const [open, setOpen] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const lead = conversation.workflow_data?.lead || {};
  const needsTeam = openNeedsTeam(conversation);
  const isClaimed = conversation.status === 'human_takeover';

  useEffect(() => { setNotice(''); }, [conversation.id]);

  const saveField = async (key, value) => {
    try {
      await api.patch(`/inbox/conversations/${conversation.id}/lead`, {
        lead: { [key]: value },
        version: lead.version ?? 0,
      });
      setNotice('');
      await onChanged();
      return true;
    } catch (err) {
      if (err.response?.status === 409) {
        await onChanged();
        setNotice('تعدّل من مكان ثاني — حدّثنا البطاقة');
        return false;
      }
      setNotice('فشل الحفظ: ' + (err.response?.data?.error || err.message));
      return false;
    }
  };

  const run = async (fn) => {
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      if (err.response?.data?.error === 'already_claimed') {
        setNotice('استلمها موظف ثاني');
      } else {
        setNotice('فشلت العملية: ' + (err.response?.data?.error || err.message));
      }
    } finally {
      setBusy(false);
      await onChanged();
    }
  };

  const markContacted = () => run(async () => {
    await api.patch(`/inbox/conversations/${conversation.id}/lead`, { needs_team_resolved: true });
    setNotice('');
  });

  const claim = () => run(async () => {
    const res = await api.post(`/inbox/conversations/${conversation.id}/claim`);
    setNotice(res.data.ack === 'failed' ? 'استلمت المحادثة، بس رسالة الاستلام ما وصلت للعميل' : '');
  });

  const release = () => run(async () => {
    await api.post(`/inbox/conversations/${conversation.id}/release`);
    setNotice('');
  });

  return (
    <div className="border-t border-gray-100 bg-white">
      <div className="px-3 py-2 flex items-center justify-between gap-2">
        <button onClick={() => setOpen(o => !o)} className="flex items-center gap-1 text-sm font-medium text-gray-700">
          {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
          بطاقة العميل
        </button>
        <div className="flex flex-wrap items-center gap-1.5">
          {needsTeam && (
            <button
              onClick={markContacted}
              disabled={busy}
              className="flex items-center gap-1 text-xs bg-orange-100 text-orange-700 px-2.5 py-1 rounded-lg hover:bg-orange-200 disabled:opacity-50"
            >
              <CheckCheck size={12} />
              تم التواصل
            </button>
          )}
          {!isClaimed ? (
            <button
              onClick={claim}
              disabled={busy}
              className="flex items-center gap-1 text-xs bg-blue-100 text-blue-700 px-2.5 py-1 rounded-lg hover:bg-blue-200 disabled:opacity-50"
            >
              <UserCheck size={12} />
              استلام
            </button>
          ) : (
            <button
              onClick={release}
              disabled={busy}
              className="flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2.5 py-1 rounded-lg hover:bg-green-200 disabled:opacity-50"
            >
              <Undo2 size={12} />
              إرجاع للبوت
            </button>
          )}
        </div>
      </div>
      {notice && <div className="px-3 pb-1 text-xs text-amber-700">{notice}</div>}
      {open && (
        <div className="px-3 pb-2 max-h-56 overflow-y-auto">
          {needsTeam && (
            <div className="text-xs text-orange-700 mb-1">
              يحتاج الفريق: {NEEDS_TEAM_LABELS[needsTeam.reason] || needsTeam.reason}
              {needsTeam.summary ? ` — ${needsTeam.summary}` : ''}
            </div>
          )}
          {LEAD_FIELDS.map(field => (
            <LeadFieldRow key={field.key} field={field} lead={lead} onSave={saveField} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function InboxPage() {
  const { user } = useAuth();
  const isShift = user?.business_type === 'shift';
  const [conversations, setConversations] = useState([]);
  const [selected, setSelected] = useState(null);
  const [messages, setMessages] = useState([]);
  const [replyText, setReplyText] = useState('');
  const [sending, setSending] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const messagesEndRef = useRef(null);
  const selectedId = selected?.id;
  // The conversation staff currently have open. A response that arrives after they switched (or
  // resolved) must not switch the page back, or a reply would go to the previous customer.
  const openIdRef = useRef(null);

  const openConversation = (conv) => {
    openIdRef.current = conv ? conv.id : null;
    setSelected(conv);
  };

  // Apply a /messages response only if that conversation is still the open one.
  const applyMessages = (convId, data) => {
    if (openIdRef.current !== convId) return;
    setMessages(data.messages || []);
    if (data.conversation) setSelected(data.conversation);
  };

  const loadConversations = useCallback(async () => {
    const params = {};
    if (statusFilter === 'needs_team') params.needs_team = 1;
    else if (statusFilter) params.status = statusFilter;
    if (search) params.search = search;
    const res = await api.get('/inbox/conversations', { params });
    setConversations(sortConversations(res.data.conversations || []));
  }, [statusFilter, search]);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Poll conversation list for updates (SSE disabled to avoid token in URL logs)
  useEffect(() => {
    const interval = setInterval(() => {
      loadConversations();
    }, 10000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  const loadMessages = async (conv) => {
    openConversation(conv);
    setLoadingMsgs(true);
    try {
      const res = await api.get(`/inbox/conversations/${conv.id}/messages`);
      applyMessages(conv.id, res.data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMsgs(false);
    }
  };

  // Re-read the open conversation (lead card, status, banners) and its messages.
  const refreshSelected = useCallback(async () => {
    if (!selectedId) return;
    try {
      const res = await api.get(`/inbox/conversations/${selectedId}/messages`);
      applyMessages(selectedId, res.data);
    } catch (e) {
      console.error(e);
    }
    loadConversations();
  }, [selectedId, loadConversations]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Poll messages for selected conversation. The conversation row is refreshed too, so the lead
  // card, the window countdown and the billing banner follow what the bot writes.
  useEffect(() => {
    if (!selectedId) return;
    const interval = setInterval(async () => {
      try {
        const res = await api.get(`/inbox/conversations/${selectedId}/messages`);
        applyMessages(selectedId, res.data);
      } catch (e) {
        console.error(e);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [selectedId]);

  const sendReply = async () => {
    if (!replyText.trim() || !selected) return;
    setSending(true);
    try {
      await api.post(`/inbox/conversations/${selected.id}/send`, { text: replyText });
      setReplyText('');
      const res = await api.get(`/inbox/conversations/${selected.id}/messages`);
      applyMessages(selected.id, res.data);
    } catch (err) {
      alert('فشل الإرسال: ' + (err.response?.data?.error || err.message));
    } finally {
      setSending(false);
    }
  };

  const handleTakeover = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected.id}/takeover`);
    const res = await api.get(`/inbox/conversations/${selected.id}/messages`);
    applyMessages(selected.id, res.data);
    loadConversations();
  };

  const handleEnableAI = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected.id}/enable-ai`);
    const res = await api.get(`/inbox/conversations/${selected.id}/messages`);
    applyMessages(selected.id, res.data);
    loadConversations();
  };

  const handleResolve = async () => {
    if (!selected) return;
    await api.post(`/inbox/conversations/${selected.id}/resolve`);
    loadConversations();
    openConversation(null);
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
            <option value="needs_team">يحتاج الفريق</option>
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
              key={conv.id}
              conv={conv}
              active={selected?.id === conv.id}
              onClick={() => loadMessages(conv)}
              isShift={isShift}
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
        <div className="flex-1 flex flex-col min-w-0">
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
              <div className="mt-0.5">
                <WindowCountdown lastInboundAt={selected.last_inbound_at} />
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

          {/* Billing banner: Meta stopped sending for this number until a payment method is added */}
          {selected.metadata?.billing_blocked_at && (
            <div className="text-center text-xs py-1.5 bg-red-600 text-white flex items-center justify-center gap-1">
              <AlertTriangle size={12} />
              واتساب موقف الإرسال — أضف طريقة دفع
            </div>
          )}

          {/* The bot failed to reply 3 times and stopped retrying: shown even when no alert channel is set */}
          {isShift && replyGaveUp(selected) && (
            <div className="text-center text-xs py-1.5 bg-red-50 text-red-700 flex items-center justify-center gap-1">
              <AlertTriangle size={12} />
              البوت ما قدر يرد 3 مرات ووقف المحاولة — العميل بدون رد، رد عليه من هون
            </div>
          )}

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 bg-gray-50">
            {loadingMsgs && <div className="text-center text-gray-400 py-8">جاري التحميل...</div>}
            {messages.map(msg => <MessageBubble key={msg.id} msg={msg} />)}
            <div ref={messagesEndRef} />
          </div>

          {/* Lead card (SHIFT sales leads only) */}
          {isShift && <LeadCard conversation={selected} onChanged={refreshSelected} />}

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
