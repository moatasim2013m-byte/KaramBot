/**
 * Inbox v2 — the WhatsApp staff inbox ported from Peekaboo (docs/inbox-v2-port-plan.md).
 *
 * Layout and design follow official-peekaboo-website- frontend/src/pages/StaffPage.js (the `inbox` tab):
 * a conversation list and a thread, edge to edge on a phone (list OR thread, with a back button and a
 * «⋮» actions sheet), side by side from `lg`, plus the customer panel from `xl`. Data is KaramBot's:
 * /api/inbox/v2 (tenant-scoped) for the list, thread and organising, and the existing /api/inbox
 * routes for sending, takeover and the SHIFT lead card.
 *
 * Reads are explicit: a thread is marked read only while this tab is visible (Peekaboo's lesson — a
 * thread open in a background tab used to "read" everything that arrived).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Search, RefreshCw, MessageSquare, Loader2, ChevronDown, ChevronUp, Send, X, Bot, User,
  AlertTriangle, Clock, CheckCircle,
} from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { formatClock, formatListTime, formatDaySeparator } from '../../utils/inboxTime';
import { isJumboEmoji } from '../../utils/waMarkdown';
import { StatusTick, TickDouble, WaText, windowState, Avatar, LABEL_PRESETS } from './waParts';
import { LeadCard, NEEDS_TEAM_LABELS, STAGE_LABELS } from '../InboxPage';

const V2 = '/inbox/v2';
const LIST_POLL_MS = 10000;
const STATS_POLL_MS = 30000;
const THREAD_POLL_MS = 5000;
const DETAIL_POLL_MS = 20000;

const TABS = [
  { key: 'all', label: 'الكل' },
  { key: 'unread', label: 'غير مقروءة' },
  { key: 'mine', label: 'لي' },
  { key: 'unassigned', label: 'غير مسندة' },
  { key: 'attention', label: '🚨 انتباه' },
  { key: 'snoozed', label: '💤 مؤجّلة' },
  { key: 'resolved', label: '✅ مغلقة' },
];

const STATUS_OPTIONS = [
  { value: 'open', label: '🟢 مفتوحة' },
  { value: 'pending', label: '🟡 قيد المتابعة' },
  { value: 'resolved', label: '✅ مغلقة' },
];

const SNOOZE_OPTIONS = [
  { label: 'ساعة', minutes: 60 },
  { label: '٣ ساعات', minutes: 180 },
  { label: 'حتى الغد', minutes: 24 * 60 },
  { label: 'أسبوع', minutes: 7 * 24 * 60 },
  { label: 'إلغاء التأجيل', minutes: 0 },
];

const KIND_TAGS = {
  nudge: '🔔 تذكير',
  weekly_followup: '📣 متابعة أسبوعية',
  booking_reminder: '📅 تذكير موعد',
  staff_alert: '🛎️ تنبيه للفريق',
  optout: '⛔ إيقاف',
};

const MEDIA_LABELS = { image: '📷 صورة', audio: '🎤 رسالة صوتية', video: '🎥 فيديو', document: '📄 مستند', sticker: '🌟 ملصق' };

const useVisible = () => {
  const [visible, setVisible] = useState(typeof document === 'undefined' ? true : document.visibilityState === 'visible');
  useEffect(() => {
    const on = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', on);
    return () => document.removeEventListener('visibilitychange', on);
  }, []);
  return visible;
};

function previewText(c) {
  const m = c.last_message;
  if (!m) return '';
  if (m.text) return m.text;
  return MEDIA_LABELS[m.type] || '📎 وسائط';
}

// ─── list ────────────────────────────────────────────────────────────────────

function ConversationRow({ conv, active, onOpen }) {
  const snoozed = conv.snoozed_until && new Date(conv.snoozed_until) > new Date();
  const m = conv.last_message;
  const sub = conv.lead && (conv.lead.business_name || conv.lead.sector_text);
  return (
    <button
      onClick={() => onOpen(conv)}
      className={`w-full text-start px-4 py-3 border-b border-gray-100 transition-colors hover:bg-[#F5F6F6] ${active ? 'bg-[#F0F2F5]' : ''} ${conv.status === 'resolved' ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <Avatar name={conv.display_name} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-0.5 gap-1">
            <span className="font-semibold text-[15px] truncate text-gray-800 flex items-center gap-1 min-w-0">
              {(conv.needs_attention || conv.team_request) && <span title="يحتاج الفريق" className="flex-shrink-0">🚨</span>}
              {conv.status === 'resolved' && <CheckCircle className="h-3 w-3 text-green-500 flex-shrink-0" />}
              <span className="truncate">{conv.display_name}</span>
              {conv.labels.slice(0, 1).map((l) => (
                <span key={l} className="flex-shrink-0 text-[9px] font-medium bg-[#008069]/10 text-[#008069] border border-[#008069]/20 rounded-full px-1.5">{l}</span>
              ))}
            </span>
            <span className={`text-xs flex-shrink-0 ${conv.unread_count > 0 ? 'text-[#1FA855] font-semibold' : 'text-gray-400'}`}>
              {formatListTime(m ? m.at : conv.last_message_at)}
            </span>
          </div>
          <div className="flex items-center justify-between gap-1">
            <p className={`text-[13px] truncate flex items-center gap-1 ${conv.unread_count > 0 ? 'text-gray-800 font-medium' : 'text-gray-500'}`}>
              {m && m.direction === 'outbound' && (m.is_ai_generated ? <Bot className="h-3.5 w-3.5 text-[#667781] flex-shrink-0" /> : <TickDouble className="text-[#667781] flex-shrink-0 scale-90" />)}
              <span className="truncate" dir="auto">{previewText(conv)}</span>
            </p>
            <span className="flex items-center gap-1 flex-shrink-0">
              {snoozed && <Clock className="h-3.5 w-3.5 text-gray-400" />}
              {conv.assigned_staff && (
                <span title={`مسندة إلى ${conv.assigned_staff.name}`} className="inline-flex items-center justify-center w-[18px] h-[18px] rounded-full bg-[#F2E533]/60 text-yellow-900 text-[10px] font-bold border border-[#F2E533]">
                  {conv.assigned_staff.name.charAt(0)}
                </span>
              )}
              {conv.unread_count > 0 && (
                <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-[#25D366] text-white text-[11px] font-bold px-1">{conv.unread_count}</span>
              )}
            </span>
          </div>
          {(conv.team_request || conv.current_state || sub) && (
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              {conv.team_request && (
                <span className="text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 rounded-full px-1.5">
                  يحتاج الفريق: {NEEDS_TEAM_LABELS[conv.team_request.reason] || conv.team_request.reason || 'طلب'}
                </span>
              )}
              {conv.current_state && STAGE_LABELS[conv.current_state] && (
                <span className="text-[10px] text-gray-500 bg-gray-100 rounded-full px-1.5">{STAGE_LABELS[conv.current_state]}</span>
              )}
              {sub && <span className="text-[10px] text-gray-400 truncate max-w-[140px]">{sub}</span>}
            </div>
          )}
        </div>
      </div>
    </button>
  );
}

// ─── attachments ─────────────────────────────────────────────────────────────

const READ_LABELS = { audio: '🎧 كرم سمع', image: '👁️ كرم شاف', video: '🎬 كرم شاف' };

/**
 * A voice note, photo, video or file in the thread (owner, 2026-10-08: voice notes could not be played and
 * photos were only a label). The file is fetched through the API with the staff member's session — WhatsApp's
 * own link needs the business token — and only once the bubble scrolls into view.
 */
function MediaAttachment({ convId, msg }) {
  const [url, setUrl] = useState(null);
  const [state, setState] = useState('idle'); // idle | loading | ready | gone | error
  const [zoom, setZoom] = useState(false);
  const holder = useRef(null);
  const type = msg.message_type;
  const wantsAuto = type === 'image' || type === 'audio' || type === 'sticker';

  const load = useCallback(async () => {
    if (state === 'loading' || state === 'ready') return;
    setState('loading');
    try {
      const res = await api.get(`${V2}/conversations/${convId}/messages/${msg.id}/media`, { responseType: 'blob' });
      setUrl(URL.createObjectURL(res.data));
      setState('ready');
    } catch (err) {
      setState(err.response && err.response.status === 410 ? 'gone' : 'error');
    }
  }, [convId, msg.id, state]);

  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  useEffect(() => {
    if (!wantsAuto || !msg.media_id || !holder.current || typeof IntersectionObserver === 'undefined') return undefined;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { io.disconnect(); load(); }
    }, { rootMargin: '200px' });
    io.observe(holder.current);
    return () => io.disconnect();
  }, [wantsAuto, msg.media_id, load]);

  const read = msg.media_read && msg.media_read.status === 'ok' && msg.media_read.text ? msg.media_read.text : null;
  const label = MEDIA_LABELS[type] || `[${type}]`;
  let content;
  if (!msg.media_id) {
    content = <p className="text-sm text-[#54656F]">{label}</p>;
  } else if (state === 'gone') {
    content = <p className="text-sm text-[#54656F]">{label} — <span className="text-xs">ما عاد متوفر على واتساب</span></p>;
  } else if (state === 'error') {
    content = (
      <button type="button" onClick={() => { setState('idle'); setTimeout(load, 0); }} className="text-sm text-[#027EB5] underline">
        {label} — تعذّر التحميل، جرّب مرة ثانية
      </button>
    );
  } else if (state !== 'ready') {
    content = wantsAuto ? (
      <p className="text-sm text-[#54656F] flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> {label}</p>
    ) : (
      <button type="button" onClick={load} className="text-sm text-[#027EB5] flex items-center gap-1.5">
        {state === 'loading' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} {label} — اضغط للعرض
      </button>
    );
  } else if (type === 'audio') {
    content = <audio controls preload="metadata" src={url} className="w-[240px] max-w-full h-10" />;
  } else if (type === 'image' || type === 'sticker') {
    content = (
      <>
        <button type="button" onClick={() => setZoom(true)} className="block">
          <img src={url} alt="صورة من العميل" className={`rounded-md ${type === 'sticker' ? 'w-28 h-28 object-contain' : 'max-h-72 max-w-full object-cover'}`} />
        </button>
        {zoom && (
          <button type="button" onClick={() => setZoom(false)} className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4" aria-label="إغلاق">
            <img src={url} alt="" className="max-w-full max-h-full object-contain" />
          </button>
        )}
      </>
    );
  } else if (type === 'video') {
    content = <video controls preload="metadata" src={url} className="rounded-md max-h-80 max-w-full" />;
  } else {
    content = <a href={url} download className="text-sm text-[#027EB5] underline">{label} — تنزيل</a>;
  }

  return (
    <div ref={holder}>
      {content}
      {read && (
        <div className="mt-1.5 rounded-md bg-black/[0.04] px-2 py-1">
          <p className="text-[11px] text-[#54656F] font-medium">{READ_LABELS[type] || 'كرم قرأ'}:</p>
          <p className="text-[12.5px] text-[#3B4A54] whitespace-pre-wrap break-words" dir="auto">{read}</p>
        </div>
      )}
    </div>
  );
}

// ─── thread ──────────────────────────────────────────────────────────────────

function MessageBubble({ msg, prev, customerName, onReply, convId }) {
  const dayChange = !prev || new Date(prev.created_at).toDateString() !== new Date(msg.created_at).toDateString();
  const grouped = !dayChange && prev && prev.direction === msg.direction;
  const out = msg.direction === 'outbound';
  const kindTag = KIND_TAGS[msg.kind];
  const bubble = `relative rounded-lg px-2.5 py-1.5 [box-shadow:0_1px_0.5px_rgba(11,20,26,0.13)] max-w-[88%] sm:max-w-[80%] lg:max-w-[72%] ${
    out ? `bg-[#D9FDD3] text-[#111B21] ${!grouped ? 'wa-tail-out rounded-se-none' : ''}`
      : `bg-white text-gray-800 ${!grouped ? 'wa-tail-in rounded-ss-none' : ''}`
  }`;
  const body = (() => {
    const text = msg.text_body || '';
    if (msg.message_type === 'template') {
      // The follow-up the customer actually got, with its buttons — not the stored «[قالب …]» tag.
      return (
        <div>
          <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words" dir="auto"><WaText text={text || '[قالب]'} /></p>
          {Array.isArray(msg.template_buttons) && msg.template_buttons.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {msg.template_buttons.map((b) => (
                <span key={b} className="text-[12px] text-[#027EB5] bg-white/70 border border-[#027EB5]/20 rounded-full px-2 py-0.5">{b}</span>
              ))}
            </div>
          )}
        </div>
      );
    }
    if (msg.message_type === 'text' || msg.message_type === 'interactive' || msg.message_type === 'button') {
      if (!text) return <p className="text-sm italic opacity-70">[{msg.message_type}]</p>;
      if (isJumboEmoji(text)) return <p className="text-[40px] leading-tight" dir="auto">{text}</p>;
      return <p className="text-[14.5px] leading-relaxed whitespace-pre-wrap break-words" dir="auto"><WaText text={text} /></p>;
    }
    if (MEDIA_LABELS[msg.message_type]) {
      return (
        <div>
          {convId ? <MediaAttachment convId={convId} msg={msg} /> : <p className="text-sm text-[#54656F]">{MEDIA_LABELS[msg.message_type]}</p>}
          {text && !/^\[(?:صورة|image)\]\s*$/.test(text) ? <p className="text-[14.5px] mt-1 whitespace-pre-wrap break-words" dir="auto"><WaText text={text.replace(/^\[(?:صورة|image)\]\s*/, '')} /></p> : null}
        </div>
      );
    }
    if (msg.message_type === 'location') return <p className="text-sm">📍 {text || 'موقع'}</p>;
    return <p className="text-sm italic opacity-70" dir="auto">{text || `[${msg.message_type}]`}</p>;
  })();

  return (
    <div id={`msg-${msg.meta_message_id || msg.id}`} className={grouped ? 'mt-0.5' : 'mt-3'}>
      {dayChange && (
        <div className="flex justify-center my-2">
          <span className="text-[12px] font-medium text-[#54656F] bg-white rounded-lg px-3 py-1 shadow-sm">{formatDaySeparator(msg.created_at)}</span>
        </div>
      )}
      <div className={`group flex items-end gap-1 ${out ? 'justify-end' : 'justify-start'} ${msg.reactions.length ? 'mb-3.5' : ''}`}>
        {out && <ReplyButton onClick={() => onReply(msg)} />}
        <div className={bubble}>
          {kindTag && <span className="inline-flex items-center text-[10px] font-semibold px-1.5 py-0.5 mb-1 rounded bg-emerald-100 text-emerald-700">{kindTag}</span>}
          {msg.reply_to && (
            <div
              role="button"
              tabIndex={0}
              onClick={() => {
                const el = document.getElementById(`msg-${msg.reply_to.meta_message_id}`);
                if (!el) return;
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('wa-flash');
                setTimeout(() => el.classList.remove('wa-flash'), 1300);
              }}
              className={`mb-1 rounded-md px-2.5 py-1.5 border-s-4 text-xs cursor-pointer bg-black/5 ${msg.reply_to.direction === 'inbound' ? 'border-[#53BDEB]' : 'border-[#008069]'}`}
              dir="auto"
            >
              <p className={`font-semibold text-[11px] mb-0.5 ${msg.reply_to.direction === 'inbound' ? 'text-[#2E9BC7]' : 'text-[#008069]'}`}>
                {msg.reply_to.direction === 'inbound' ? customerName : 'نحن'}
              </p>
              <p className="line-clamp-2 text-[#54656F]">{msg.reply_to.text || `[${msg.reply_to.message_type || 'رسالة'}]`}</p>
            </div>
          )}
          {body}
          <div className={`flex items-center gap-1 mt-0.5 text-[11px] text-[#667781] ${out ? 'justify-end' : ''}`}>
            {out && msg.is_ai_generated && <Bot className="h-3 w-3" title="رد آلي" />}
            {out && msg.sent_by && <span className="truncate max-w-[90px]">{msg.sent_by.name} ·</span>}
            <span>{formatClock(msg.created_at)}</span>
            {out && <span className="ms-0.5 inline-flex items-center"><StatusTick status={msg.status} /></span>}
          </div>
          {out && msg.status === 'failed' && (
            <p className="mt-0.5 text-[10px] text-red-600 text-end" dir="auto">⚠ لم تصل الرسالة{msg.error_message ? `: ${msg.error_message.slice(0, 80)}` : ''}</p>
          )}
          {msg.reactions.length > 0 && (
            <div className={`absolute -bottom-4 ${out ? 'start-1' : 'end-1'} z-[1]`}>
              <span className="inline-flex items-center gap-0.5 text-[13px] leading-none bg-white rounded-full ps-1.5 pe-2 py-[3px] shadow-[0_1px_3px_rgba(11,20,26,0.25)] border border-gray-100">
                {[...new Set(msg.reactions.map((r) => r.emoji))].slice(0, 3).join('')}
                {msg.reactions.length > 1 && <span className="text-[10px] text-[#667781] font-medium">{msg.reactions.length}</span>}
              </span>
            </div>
          )}
        </div>
        {!out && <ReplyButton onClick={() => onReply(msg)} />}
      </div>
    </div>
  );
}

function ReplyButton({ onClick }) {
  return (
    <button
      type="button"
      title="رد على هذه الرسالة"
      onClick={onClick}
      // Faint and small on a phone (it sat beside every bubble and crowded the thread), hover-only from lg.
      className="opacity-30 lg:opacity-0 lg:group-hover:opacity-100 transition-opacity self-center w-6 h-6 lg:w-7 lg:h-7 rounded-full lg:bg-white/90 lg:border lg:border-gray-200 lg:shadow-sm flex items-center justify-center text-[#54656F] hover:text-[#008069] text-xs flex-shrink-0"
    >↩</button>
  );
}

// ─── organising controls (desktop bar and mobile sheet share them) ──────────

function LabelPicker({ labels, onToggle }) {
  const all = [...LABEL_PRESETS.map((l) => l.name), ...labels.filter((l) => !LABEL_PRESETS.some((p) => p.name === l))];
  return (
    <div className="flex flex-wrap gap-1.5" dir="rtl">
      {all.map((name) => {
        const preset = LABEL_PRESETS.find((p) => p.name === name);
        const active = labels.includes(name);
        return (
          <button key={name} onClick={() => onToggle(name)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${active ? 'bg-[#008069] text-white border-[#008069]' : 'bg-gray-50 text-gray-600 border-gray-200 hover:border-[#008069]'}`}>
            {preset ? `${preset.emoji} ` : ''}{name}
          </button>
        );
      })}
    </div>
  );
}

function ContactPanel({ conv, onSaveNotes, onSaveLabel, onChanged, isShift }) {
  const [notes, setNotes] = useState(conv.contact_notes || '');
  const [label, setLabel] = useState(conv.custom_label || '');
  const [saved, setSaved] = useState('');
  useEffect(() => { setNotes(conv.contact_notes || ''); setLabel(conv.custom_label || ''); }, [conv.id, conv.contact_notes, conv.custom_label]);
  const flash = (t) => { setSaved(t); setTimeout(() => setSaved(''), 1500); };
  return (
    <div className="space-y-4" dir="rtl">
      <div className="flex flex-col items-center text-center pt-2">
        <Avatar name={conv.display_name} size="w-20 h-20 text-3xl" />
        <p className="mt-2 font-semibold text-gray-800">{conv.display_name}</p>
        <p className="text-sm text-gray-500" dir="ltr">+{conv.customer_wa_id}</p>
      </div>
      <div>
        <p className="text-[11px] font-bold text-gray-400 mb-1">اسم مخصص</p>
        <div className="flex gap-2">
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="مثلًا: أبو أحمد — مطعم الساحة"
            className="flex-1 min-w-0 text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none focus:ring-1 focus:ring-[#008069]" />
          <button onClick={async () => { if (await onSaveLabel(label)) flash('تم الحفظ'); }} className="text-sm bg-[#008069] text-white px-3 rounded-xl">حفظ</button>
        </div>
      </div>
      <div>
        <p className="text-[11px] font-bold text-gray-400 mb-1">ملاحظات عن العميل (للفريق فقط)</p>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4} maxLength={2000}
          placeholder="مثلًا: بيفضّل التواصل الصبح، عنده فرعين…"
          className="w-full text-sm border border-gray-200 rounded-xl px-3 py-2 resize-none focus:outline-none focus:ring-1 focus:ring-[#008069]" />
        <button onClick={async () => { if (await onSaveNotes(notes)) flash('تم الحفظ'); }} className="mt-1 text-sm bg-[#008069] text-white px-4 py-1.5 rounded-xl">حفظ الملاحظات</button>
      </div>
      {saved && <p className="text-xs text-green-600">{saved} ✓</p>}
      {isShift && conv.workflow_data && (
        <div className="-mx-4 border-t">
          {/* key: a half-edited field for one customer can never be saved into the next one's lead —
              the same remount the classic inbox relies on. */}
          <LeadCard key={conv.id} conversation={conv} onChanged={onChanged} />
        </div>
      )}
    </div>
  );
}

// ─── page ────────────────────────────────────────────────────────────────────

export default function InboxPage() {
  const { user } = useAuth();
  const isShift = user?.business_type === 'shift';
  const visible = useVisible();

  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [conversations, setConversations] = useState([]);
  const [cursor, setCursor] = useState(null);
  const [stats, setStats] = useState(null);
  const [listLoading, setListLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [staff, setStaff] = useState([]);

  const [selectedId, setSelectedId] = useState(null);
  const [conv, setConv] = useState(null);
  const [messages, setMessages] = useState([]);
  const [hasOlder, setHasOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [threadLoading, setThreadLoading] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);
  const [showSheet, setShowSheet] = useState(false);
  const [showPanel, setShowPanel] = useState(false);
  const [showLabels, setShowLabels] = useState(false);
  const [showSnooze, setShowSnooze] = useState(false);

  const [replyText, setReplyText] = useState('');
  const [replyingTo, setReplyingTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const [showJump, setShowJump] = useState(false);

  const scrollRef = useRef(null);
  const endRef = useRef(null);
  const textareaRef = useRef(null);
  const openIdRef = useRef(null);
  const atBottomRef = useRef(true);

  useEffect(() => { const t = setTimeout(() => setDebounced(search.trim()), 300); return () => clearTimeout(t); }, [search]);

  // ── request discipline (Codex review, 2026-10-07) ──
  // A generation token per opened thread: every thread response is applied only if the thread it was
  // asked for is still the one on screen, so a slow answer for A can never land inside B — not even
  // after A → B → A. Poll responses also carry a sequence number, so an older one cannot replace a
  // newer one. A 429 pauses all polling for a minute instead of hammering the limiter.
  const genRef = useRef(0);
  const msgSeqRef = useRef(0);
  const msgAppliedRef = useRef(0);
  const backoffUntilRef = useRef(0);
  const backedOff = () => Date.now() < backoffUntilRef.current;
  const noteRateLimit = (err) => {
    if (err && err.response && err.response.status === 429) backoffUntilRef.current = Date.now() + 60000;
  };
  const isCurrent = (gen, id) => genRef.current === gen && openIdRef.current === id;

  // ── list ──
  const listKeyRef = useRef('');
  const pagesRef = useRef(1);
  const listBusyRef = useRef(false);
  const loadList = useCallback(async ({ more = false } = {}) => {
    // A refresh never runs on top of «تحميل المزيد» (or the other way round): their answers interleaved.
    if (listBusyRef.current) return;
    listBusyRef.current = true;
    const key = `${filter}|${debounced}`;
    listKeyRef.current = key;
    try {
      const params = { filter };
      if (debounced) params.search = debounced;
      if (more && cursor) {
        params.cursor = cursor;
        params.limit = 30;
      } else {
        // A refresh re-reads every row on screen (the API allows 150), so nothing loaded is dropped.
        params.limit = Math.min(30 * pagesRef.current, 150);
      }
      const res = await api.get(`${V2}/conversations`, { params });
      if (listKeyRef.current !== key) return; // the filter or search changed meanwhile
      if (more) pagesRef.current += 1;
      setConversations((prev) => {
        if (!more) return res.data.conversations;
        const seen = new Set(prev.map((c) => c.id));
        return [...prev, ...res.data.conversations.filter((c) => !seen.has(c.id))];
      });
      setCursor(res.data.next_cursor);
    } catch (err) {
      noteRateLimit(err);
      throw err;
    } finally {
      listBusyRef.current = false;
    }
  }, [filter, debounced, cursor]);

  const loadStats = useCallback(async () => {
    try { setStats((await api.get(`${V2}/stats`)).data); } catch (err) { noteRateLimit(err); }
  }, []);

  useEffect(() => {
    pagesRef.current = 1;
    setListLoading(true);
    loadList().catch(() => setNotice('تعذّر تحميل المحادثات')).finally(() => setListLoading(false));
    loadStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter, debounced]);

  useEffect(() => { api.get(`${V2}/staff-list`).then((r) => setStaff(r.data.staff || [])).catch(() => {}); }, []);

  // Polling budget, per open tab: list 6/min + stats 2/min + thread 12/min + detail 3/min ≈ 23/min
  // (it was 51 with the menu badge). The limiter is 100/min per signed-in session.
  useEffect(() => {
    if (!visible) return undefined;
    const t1 = setInterval(() => { if (!backedOff()) loadList().catch(() => {}); }, LIST_POLL_MS);
    const t2 = setInterval(() => { if (!backedOff()) loadStats(); }, STATS_POLL_MS);
    return () => { clearInterval(t1); clearInterval(t2); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, filter, debounced]);

  // ── thread ──
  const loadConversation = useCallback(async (id, gen = genRef.current) => {
    try {
      const res = await api.get(`${V2}/conversations/${id}`);
      if (isCurrent(gen, id)) setConv(res.data.conversation);
    } catch (err) { noteRateLimit(err); throw err; }
  }, []);

  const loadMessages = useCallback(async (id, gen = genRef.current) => {
    const seq = ++msgSeqRef.current;
    let res;
    try {
      res = await api.get(`${V2}/conversations/${id}/messages`, { params: { limit: 50 } });
    } catch (err) { noteRateLimit(err); throw err; }
    if (!isCurrent(gen, id) || seq < msgAppliedRef.current) return;
    msgAppliedRef.current = seq;
    // The newest page replaces itself; older pages staff already loaded stay above it.
    setMessages((prev) => {
      const page = res.data.messages;
      if (!page.length) return prev.length ? prev : page;
      // Older = before the page's first message on (created_at, id), so a same-instant message stays.
      const firstAt = new Date(page[0].created_at).getTime();
      const firstId = page[0].id;
      const ids = new Set(page.map((m) => m.id));
      const older = (m) => {
        const t = new Date(m.created_at).getTime();
        return t < firstAt || (t === firstAt && m.id < firstId);
      };
      return [...prev.filter((m) => !ids.has(m.id) && older(m)), ...page];
    });
    setHasOlder((h) => (h === null ? res.data.has_older : h));
  }, []);

  // Read up to the newest message actually on screen, and only while the tab is visible and the thread
  // is the open one: whatever arrived after that stays unread (it used to be zeroed unseen).
  const lastAckRef = useRef('');
  const markRead = useCallback(async (id, gen, upTo) => {
    if (!isCurrent(gen, id) || document.visibilityState !== 'visible' || !upTo) return;
    const ackKey = `${id}|${upTo}`;
    if (lastAckRef.current === ackKey) return;
    lastAckRef.current = ackKey;
    try {
      const res = await api.post(`${V2}/conversations/${id}/read`, { up_to: upTo });
      const left = res.data.unread_count || 0;
      setConversations((list) => list.map((c) => (c.id === id ? { ...c, unread_count: left } : c)));
      if (isCurrent(gen, id)) setConv((c) => (c && c.id === id ? { ...c, unread_count: left } : c));
    } catch (err) { noteRateLimit(err); lastAckRef.current = ''; }
  }, []);

  const openConversation = async (c) => {
    const gen = ++genRef.current;
    openIdRef.current = c.id;
    msgAppliedRef.current = msgSeqRef.current;
    lastAckRef.current = '';
    setSelectedId(c.id);
    setConv(c);
    setMessages([]);
    setHasOlder(null);
    setReplyingTo(null);
    // A draft typed for one customer must never be sent to the next one (review, 2026-10-06).
    setReplyText('');
    setNotice('');
    setShowSheet(false);
    setShowLabels(false);
    setShowSnooze(false);
    setMobileThread(true);
    atBottomRef.current = true;
    setThreadLoading(true);
    try {
      await Promise.all([loadConversation(c.id, gen), loadMessages(c.id, gen)]);
    } catch {
      if (isCurrent(gen, c.id)) setNotice('تعذّر فتح المحادثة');
    } finally {
      if (isCurrent(gen, c.id)) setThreadLoading(false);
    }
  };

  useEffect(() => {
    if (!selectedId || !visible) return undefined;
    const gen = genRef.current;
    const t1 = setInterval(() => { if (!backedOff()) loadMessages(selectedId, gen).catch(() => {}); }, THREAD_POLL_MS);
    const t2 = setInterval(() => { if (!backedOff()) loadConversation(selectedId, gen).catch(() => {}); }, DETAIL_POLL_MS);
    return () => { clearInterval(t1); clearInterval(t2); };
  }, [selectedId, visible, loadMessages, loadConversation]);

  // Acknowledge from what was rendered, not from the conversation's counter.
  const newest = messages.length ? messages[messages.length - 1] : null;
  useEffect(() => {
    if (!selectedId || !visible || !conv || !newest) return;
    if ((conv.unread_count || 0) <= 0) return;
    markRead(selectedId, genRef.current, newest.created_at);
  }, [selectedId, visible, conv, newest, markRead]);

  // Stick to the bottom when new messages arrive, unless staff scrolled up to read.
  useEffect(() => {
    if (atBottomRef.current) endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = fromBottom < 80;
    setShowJump(fromBottom > 400);
  };

  const loadOlder = async () => {
    if (!messages.length || !selectedId) return;
    const id = selectedId;
    const gen = genRef.current;
    const first = messages[0];
    setLoadingOlder(true);
    const el = scrollRef.current;
    const before = el ? el.scrollHeight : 0;
    try {
      const res = await api.get(`${V2}/conversations/${id}/messages`, { params: { before: first.created_at, before_id: first.id, limit: 50 } });
      // Another thread is open now: this page belongs to the one that asked for it, not this one.
      if (!isCurrent(gen, id)) return;
      atBottomRef.current = false;
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...res.data.messages.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasOlder(res.data.has_older);
      requestAnimationFrame(() => { if (el) el.scrollTop = el.scrollHeight - before; });
    } catch (err) {
      noteRateLimit(err);
    } finally {
      if (isCurrent(gen, id)) setLoadingOlder(false);
    }
  };

  // Back on a phone closes the thread for real: polling, read-marking and any answer still on its way
  // for it stop with it.
  const closeThread = () => {
    genRef.current += 1;
    openIdRef.current = null;
    setSelectedId(null);
    setConv(null);
    setMessages([]);
    setReplyText('');
    setReplyingTo(null);
    setShowSheet(false);
    setMobileThread(false);
  };

  // ── actions ──
  const refreshOpen = async () => {
    const id = openIdRef.current;
    if (!id) return;
    const gen = genRef.current;
    await Promise.all([
      loadConversation(id, gen).catch(() => {}),
      loadMessages(id, gen).catch(() => {}),
      loadList().catch(() => {}),
      loadStats(),
    ]);
  };

  /** Runs a write; true only if the WRITE succeeded — a failed refresh afterwards is not a failed save. */
  const act = async (fn, okText) => {
    try {
      await fn();
    } catch (err) {
      noteRateLimit(err);
      setNotice(`فشلت العملية: ${err.response?.data?.error || err.message}`);
      return false;
    }
    refreshOpen();
    if (okText) { setNotice(okText); setTimeout(() => setNotice(''), 1800); }
    return true;
  };

  const setStatus = (status) => act(() => api.post(`${V2}/conversations/${selectedId}/status`, { status }));
  const assign = (userId) => act(() => api.post(`${V2}/conversations/${selectedId}/assign`, { user_id: userId || null }));

  // Label taps queue: each computes from the labels the previous tap left, so two quick taps both stick.
  const labelsRef = useRef({ id: null, labels: [] });
  const labelChainRef = useRef(Promise.resolve());
  useEffect(() => {
    if (conv && labelsRef.current.id !== conv.id) labelsRef.current = { id: conv.id, labels: conv.labels || [] };
  }, [conv]);
  const toggleLabel = (name) => {
    const id = selectedId;
    const cur = labelsRef.current.id === id ? labelsRef.current.labels : (conv ? conv.labels : []);
    const labels = cur.includes(name) ? cur.filter((l) => l !== name) : [...cur, name];
    labelsRef.current = { id, labels };
    setConv((c) => (c && c.id === id ? { ...c, labels } : c));
    labelChainRef.current = labelChainRef.current
      .then(() => api.post(`${V2}/conversations/${id}/labels`, { labels: labelsRef.current.labels }))
      .then(() => loadList().catch(() => {}))
      .catch((err) => { noteRateLimit(err); setNotice('ما انحفظت التصنيفات'); });
    return labelChainRef.current;
  };
  const snooze = (minutes) => {
    setShowSnooze(false);
    const until = minutes ? new Date(Date.now() + minutes * 60000).toISOString() : null;
    return act(() => api.post(`${V2}/conversations/${selectedId}/snooze`, { until }), minutes ? 'تم التأجيل' : 'ألغي التأجيل');
  };
  const clearAttention = () => act(() => api.post(`${V2}/conversations/${selectedId}/attention/clear`));
  const saveNotes = (notes) => act(() => api.post(`${V2}/conversations/${selectedId}/contact-notes`, { notes }));
  const saveLabel = (label) => act(() => api.post(`${V2}/conversations/${selectedId}/contact-label`, { label: label || null }));
  const botActive = conv && conv.ai_enabled && conv.status !== 'human_takeover';
  const toggleBot = () => act(
    () => api.post(`/inbox/conversations/${selectedId}/${botActive ? 'takeover' : 'enable-ai'}`),
    botActive ? 'أوقفت البوت — المحادثة معك' : 'رجعت المحادثة للبوت',
  );

  const send = async () => {
    const text = replyText.trim();
    if (!text || !selectedId || sending) return;
    setSending(true);
    let sent = false;
    try {
      await api.post(`/inbox/conversations/${selectedId}/send`, {
        text,
        ...(replyingTo && replyingTo.meta_message_id ? { reply_to_message_id: replyingTo.meta_message_id } : {}),
      });
      sent = true;
    } catch (err) {
      noteRateLimit(err);
      setNotice(`ما انبعتت: ${err.response?.data?.error || err.message}`);
    }
    if (sent) {
      // Sent is sent: the draft goes, whatever happens to the refresh after it.
      setReplyText('');
      setReplyingTo(null);
      atBottomRef.current = true;
      try { navigator.vibrate?.(10); } catch { /* unsupported */ }
      refreshOpen();
    }
    setSending(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  // Auto-grow the composer like WhatsApp: one line, up to ~6.
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [replyText]);

  const win = conv ? windowState(conv.last_inbound_at) : null;
  const statusSelect = (cls) => (
    <select value={conv.status === 'human_takeover' ? 'open' : conv.status} onChange={(e) => setStatus(e.target.value)} className={cls} title="حالة المحادثة">
      {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
  const assignSelect = (cls) => (
    <select value={conv.assigned_staff_id || ''} onChange={(e) => assign(e.target.value)} className={cls} title="إسناد المحادثة">
      <option value="">غير مسندة</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === user?.id ? ' (أنا)' : ''}</option>)}
    </select>
  );
  const botButton = (cls = '') => (
    <button onClick={toggleBot}
      className={`flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${botActive ? 'bg-white text-gray-600 border-gray-200 hover:border-[#008069]' : 'bg-orange-50 text-orange-700 border-orange-300'} ${cls}`}
      title="تشغيل/إيقاف البوت لهذه المحادثة">
      {botActive ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
      {botActive ? 'البوت يرد' : 'أنت ترد — البوت متوقف'}
    </button>
  );

  const tabBadge = (key) => (stats && key !== 'all' && key !== 'resolved' ? stats[key] : 0);
  const customerName = conv ? conv.display_name : '';

  return (
    <div className="inbox-shell h-full min-h-0 flex lg:gap-3 lg:p-3 bg-[#F0F2F5] lg:bg-transparent" dir="rtl">
      {/* ── list ── */}
      <section className={`w-full lg:w-[380px] xl:w-[400px] lg:flex-none flex flex-col min-h-0 min-w-0 bg-white lg:rounded-2xl lg:border lg:shadow-sm overflow-hidden ${mobileThread ? 'hidden lg:flex' : 'flex'}`}>
        <div className="px-4 py-3 border-b bg-[#F0F2F5] flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#008069] flex items-center justify-center"><MessageSquare className="h-4 w-4 text-white" /></div>
            <span className="font-semibold">المحادثات</span>
            {stats?.unread > 0 && <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-[#25D366] text-white text-xs font-bold px-1">{stats.unread}</span>}
          </div>
          <button onClick={() => { loadList(); loadStats(); }} className="w-8 h-8 rounded-full hover:bg-[#008069]/10 flex items-center justify-center" title="تحديث">
            <RefreshCw className="h-4 w-4 text-[#008069]" />
          </button>
        </div>
        <div className="px-3 py-2 space-y-2 border-b bg-white">
          <div className="relative">
            <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ابحث بالاسم أو الرقم…"
              className="w-full ps-9 pe-3 py-2 text-sm bg-[#F0F2F5] rounded-full focus:outline-none focus:ring-2 focus:ring-[#008069]/30" />
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-0.5 no-scrollbar">
            {TABS.map((tab) => (
              <button key={tab.key} onClick={() => setFilter(tab.key)}
                className={`flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${filter === tab.key ? 'bg-[#D9FDD3] text-[#008069]' : 'bg-[#F0F2F5] text-gray-600 hover:bg-gray-200'}`}>
                {tab.label}
                {tabBadge(tab.key) > 0 && (
                  <span className={`inline-flex items-center justify-center min-w-[16px] h-4 rounded-full text-[10px] font-bold px-1 ${filter === tab.key ? 'bg-[#008069] text-white' : 'bg-[#25D366] text-white'}`}>{tabBadge(tab.key)}</span>
                )}
              </button>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto inbox-scroll">
          {listLoading ? (
            <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#008069]" /></div>
          ) : conversations.length === 0 ? (
            <div className="text-center py-16 text-gray-400"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-20" /><p className="text-sm">لا توجد محادثات هون</p></div>
          ) : (
            conversations.map((c) => <ConversationRow key={c.id} conv={c} active={c.id === selectedId} onOpen={openConversation} />)
          )}
          {!listLoading && cursor && (
            <button onClick={async () => { setLoadingMore(true); try { await loadList({ more: true }); } finally { setLoadingMore(false); } }}
              disabled={loadingMore} className="w-full py-3 text-xs font-medium text-[#008069] hover:bg-[#F5F6F6] flex items-center justify-center gap-1.5">
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ChevronDown className="h-3.5 w-3.5" />} تحميل المزيد
            </button>
          )}
        </div>
      </section>

      {/* ── thread ── */}
      <section className={`flex-1 flex flex-col min-h-0 min-w-0 bg-white lg:rounded-2xl lg:border lg:shadow-sm overflow-hidden ${mobileThread ? 'flex wa-thread-enter' : 'hidden lg:flex'}`}>
        {!conv ? (
          <div className="flex-1 flex items-center justify-center bg-[#F0F2F5]">
            <div className="text-center text-gray-400">
              <div className="w-20 h-20 rounded-full bg-[#008069]/10 flex items-center justify-center mx-auto mb-4"><MessageSquare className="h-10 w-10 text-[#008069]/40" /></div>
              <p className="font-medium text-gray-500">اختر محادثة</p>
              <p className="text-sm mt-1">اختر محادثة من القائمة للرد</p>
            </div>
          </div>
        ) : (
          <>
            <header className="px-2 sm:px-4 py-2.5 border-b bg-[#F0F2F5] flex items-center gap-2 flex-shrink-0">
              <button onClick={closeThread} className="lg:hidden w-9 h-9 rounded-full hover:bg-[#008069]/10 flex items-center justify-center flex-shrink-0" aria-label="رجوع">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-[#008069]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
              </button>
              <button onClick={() => (window.innerWidth >= 1280 ? setShowPanel((p) => !p) : setShowSheet(true))} className="flex items-center gap-2.5 min-w-0 flex-1 text-start">
                <Avatar name={conv.display_name} size="w-10 h-10 text-base" />
                <div className="min-w-0">
                  <p className="font-semibold text-gray-800 leading-tight truncate">{conv.display_name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    <span dir="ltr">+{conv.customer_wa_id}</span>
                    {conv.current_state && STAGE_LABELS[conv.current_state] ? ` · ${STAGE_LABELS[conv.current_state]}` : ''}
                    {botActive ? ' · 🤖 البوت يرد' : ' · 👤 مع الفريق'}
                  </p>
                </div>
              </button>
              <div className="hidden sm:flex items-center gap-1.5">{botButton()}</div>
              <button onClick={() => setShowSheet(true)} className="xl:hidden w-9 h-9 rounded-full hover:bg-[#008069]/10 flex items-center justify-center text-gray-600 flex-shrink-0" aria-label="خيارات">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24"><circle cx="12" cy="5" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="12" cy="19" r="2" /></svg>
              </button>
            </header>

            {/* Desktop workflow bar: on phones these live in the «⋮» sheet. */}
            <div className="hidden sm:flex px-3 py-2 border-b bg-gray-50/80 items-center gap-2 flex-wrap flex-shrink-0">
              {assignSelect('text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#008069] max-w-[140px]')}
              {statusSelect('text-[11px] border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-[#008069]')}
              <div className="relative">
                <button onClick={() => { setShowLabels(!showLabels); setShowSnooze(false); }}
                  className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border ${showLabels ? 'bg-[#008069] text-white border-[#008069]' : 'bg-white text-gray-600 border-gray-200 hover:border-[#008069]'}`}>
                  🏷️ {conv.labels.slice(0, 2).join('، ')}
                </button>
                {showLabels && <div className="absolute top-8 end-0 z-30 bg-white border rounded-xl shadow-lg p-2 w-64"><LabelPicker labels={conv.labels} onToggle={toggleLabel} /></div>}
              </div>
              <div className="relative">
                <button onClick={() => { setShowSnooze(!showSnooze); setShowLabels(false); }}
                  className={`px-2 py-1 rounded-lg text-[11px] font-medium border ${conv.snoozed_until && new Date(conv.snoozed_until) > new Date() ? 'bg-purple-50 text-purple-700 border-purple-300' : 'bg-white text-gray-600 border-gray-200 hover:border-[#008069]'}`} title="تأجيل">💤</button>
                {showSnooze && (
                  <div className="absolute top-8 end-0 z-30 bg-white border rounded-xl shadow-lg p-1.5 w-36">
                    {SNOOZE_OPTIONS.map((o) => <button key={o.minutes} onClick={() => snooze(o.minutes)} className="w-full text-right text-[12px] px-2 py-1.5 rounded-lg hover:bg-gray-50">{o.label}</button>)}
                  </div>
                )}
              </div>
              {win && (
                <span title="نافذة الـ24 ساعة: بعدها ما بتوصل إلا القوالب المعتمدة"
                  className={`ms-auto flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium border ${win.expired || win.urgent ? 'bg-red-50 text-red-700 border-red-200' : win.warn ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-green-50 text-green-700 border-green-200'}`}>
                  <Clock className="h-3 w-3" />{win.label}
                </span>
              )}
            </div>

            {(conv.needs_attention || conv.team_request) && (
              <div className="px-4 py-2 bg-amber-50 border-b border-amber-200 flex items-center justify-between gap-2 flex-shrink-0">
                <p className="text-xs font-semibold text-amber-800 flex items-center gap-1.5 min-w-0">
                  <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">
                    {conv.team_request
                      ? `يحتاج الفريق: ${NEEDS_TEAM_LABELS[conv.team_request.reason] || conv.team_request.reason || ''}${conv.team_request.summary ? ` — ${conv.team_request.summary}` : ''}`
                      : `يحتاج انتباه${conv.attention_reason ? `: ${conv.attention_reason}` : ''}`}
                  </span>
                </p>
                {conv.needs_attention && <button onClick={clearAttention} className="text-[11px] font-bold text-amber-800 bg-white border border-amber-300 rounded-lg px-2.5 py-1 flex-shrink-0">تم ✓</button>}
              </div>
            )}

            <div className="flex-1 min-h-0 flex">
              <div ref={scrollRef} onScroll={onScroll} className="flex-1 min-w-0 overflow-y-auto px-3 sm:px-[6%] py-3 inbox-messages-bg inbox-scroll relative">
                {hasOlder && (
                  <div className="flex justify-center">
                    <button onClick={loadOlder} disabled={loadingOlder}
                      className="text-[11px] font-medium text-[#008069] bg-white/90 border border-gray-200 rounded-full px-3 py-1 shadow-sm flex items-center gap-1.5 disabled:opacity-60">
                      {loadingOlder ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronUp className="h-3 w-3" />} تحميل الأقدم
                    </button>
                  </div>
                )}
                {threadLoading && !messages.length ? (
                  <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-[#008069]" /></div>
                ) : messages.length === 0 ? (
                  <div className="text-center text-gray-500 py-12 text-sm">لا توجد رسائل بعد</div>
                ) : (
                  messages.map((m, i) => (
                    <MessageBubble key={m.id} msg={m} convId={selectedId} prev={i > 0 ? messages[i - 1] : null} customerName={customerName}
                      onReply={(msg) => { setReplyingTo(msg); textareaRef.current?.focus(); }} />
                  ))
                )}
                {showJump && (
                  <div className="sticky bottom-1 flex justify-end pointer-events-none">
                    <button onClick={() => { atBottomRef.current = true; endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }}
                      className="pointer-events-auto w-10 h-10 rounded-full bg-white shadow-md border border-gray-200 text-[#008069] flex items-center justify-center" title="آخر الرسائل">
                      <ChevronDown className="h-5 w-5" />
                    </button>
                  </div>
                )}
                <div ref={endRef} />
              </div>
              {showPanel && (
                <aside className="hidden xl:block w-[340px] flex-none border-s bg-white overflow-y-auto inbox-scroll p-4">
                  <ContactPanel key={conv.id} conv={conv} onSaveNotes={saveNotes} onSaveLabel={saveLabel} onChanged={refreshOpen} isShift={isShift} />
                </aside>
              )}
            </div>

            {/* Composer — pb includes the iPhone home-indicator inset. */}
            <div className="border-t bg-[#F0F2F5] px-2 sm:px-4 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] flex-shrink-0">
              {notice && <p className="mb-1.5 text-[12px] text-center text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">{notice}</p>}
              {win && win.expired ? (
                <div className="bg-white border border-red-200 rounded-2xl px-3 py-2.5 text-center">
                  <p className="text-xs text-red-700 font-medium">⏳ انتهت نافذة الـ24 ساعة — الرسائل الحرة ما بتوصل للعميل لحتى يكتبلك هو.</p>
                </div>
              ) : (
                <>
                  {replyingTo && (
                    <div className="mb-2 flex items-center gap-2 bg-white border-s-4 border-[#008069] rounded-lg px-3 py-1.5">
                      <div className="flex-1 min-w-0">
                        <p className="text-[11px] font-bold text-[#008069]">↩ رد على {replyingTo.direction === 'inbound' ? customerName : 'رسالتنا'}</p>
                        <p className="text-xs text-gray-600 truncate" dir="auto">{replyingTo.text_body || `[${replyingTo.message_type}]`}</p>
                      </div>
                      <button onClick={() => setReplyingTo(null)} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
                    </div>
                  )}
                  <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-end gap-2">
                    <textarea
                      ref={textareaRef}
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && window.innerWidth >= 1024) { e.preventDefault(); send(); } }}
                      placeholder="اكتب رسالة"
                      rows={1}
                      disabled={sending}
                      className="flex-1 min-w-0 resize-none rounded-[24px] bg-white px-4 py-3 text-[16px] lg:text-[15px] leading-6 min-h-[48px] max-h-40 overflow-y-auto focus:outline-none focus:ring-2 focus:ring-[#00A884]/40 disabled:opacity-50"
                    />
                    <button type="submit" disabled={sending || !replyText.trim()}
                      className="flex-shrink-0 w-12 h-12 rounded-full bg-[#00A884] hover:bg-[#008069] disabled:bg-gray-300 flex items-center justify-center transition-colors" aria-label="إرسال">
                      {sending ? <Loader2 className="h-5 w-5 text-white animate-spin" /> : <Send className="h-5 w-5 text-white -scale-x-100" />}
                    </button>
                  </form>
                </>
              )}
            </div>

            {/* Mobile / tablet actions sheet. */}
            {showSheet && (
              <div className="xl:hidden fixed inset-0 z-[85]" onClick={() => setShowSheet(false)}>
                <div className="absolute inset-0 bg-black/40" />
                <div className="absolute bottom-0 inset-x-0 max-h-[85dvh] overflow-y-auto bg-white rounded-t-3xl inbox-scroll pb-[env(safe-area-inset-bottom)]" onClick={(e) => e.stopPropagation()}>
                  <div className="sticky top-0 bg-white px-4 pt-3 pb-2 flex items-center justify-between border-b z-10">
                    <div className="mx-auto absolute top-1.5 inset-x-0 w-10 h-1 rounded-full bg-gray-300" />
                    <p className="font-bold text-gray-800 truncate mt-1">{conv.display_name}</p>
                    <button onClick={() => setShowSheet(false)} className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-500 mt-1"><X className="h-5 w-5" /></button>
                  </div>
                  <div className="p-4 space-y-4">
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 mb-1.5">الرد</p>
                      {botButton('!text-sm !px-3 !py-2 !rounded-full')}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div><p className="text-[11px] font-bold text-gray-400 mb-1">الحالة</p>{statusSelect('w-full text-sm border border-gray-200 rounded-xl px-2 py-2 bg-white')}</div>
                      <div><p className="text-[11px] font-bold text-gray-400 mb-1">الإسناد</p>{assignSelect('w-full text-sm border border-gray-200 rounded-xl px-2 py-2 bg-white')}</div>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 mb-1.5">التأجيل</p>
                      <div className="flex flex-wrap gap-2">
                        {SNOOZE_OPTIONS.map((o) => <button key={o.minutes} onClick={() => snooze(o.minutes)} className="px-3 py-1.5 rounded-full text-xs font-medium border bg-white text-gray-600 border-gray-200">💤 {o.label}</button>)}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-bold text-gray-400 mb-1.5">التصنيفات</p>
                      <LabelPicker labels={conv.labels} onToggle={toggleLabel} />
                    </div>
                    {win && <p className="text-xs text-gray-500 flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> نافذة الرد: {win.label}</p>}
                    <div className="border-t pt-3">
                      <ContactPanel key={conv.id} conv={conv} onSaveNotes={saveNotes} onSaveLabel={saveLabel} onChanged={refreshOpen} isShift={isShift} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
