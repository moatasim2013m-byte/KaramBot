import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, Search, Mic, Image as ImageIcon, Video, FileText, BookOpen } from 'lucide-react';
import api from '../../utils/api';
import { Timestamp, Ltr, SkeletonRows, EmptyState } from '../../components/shared/Primitives';
import { Card, Drawer, btnClass, fieldClass } from '../../components/admin/ui';
import { maskPhone } from '../../components/admin/operatorView';
import { useAuth } from '../../context/AuthContext';

/**
 * «فحص المحادثات» — read-only, audited inspection of one shop's conversations.
 *
 * This exists for one job: seeing what the bot actually said when an owner reports a wrong answer
 * («البوت قال سعرًا غلط»). It is not a workspace — there is no reply box, no claim, no takeover,
 * and the backend has no write route to offer one. Every list and every thread opened is written
 * to admin_access_logs on the server and shows in the shop's «السجل».
 *
 * A thread opens in a side panel (ConversationDrawer, also opened from the account page's urgent
 * alert) and shows its newest 200 messages in order, so the recent wrong answer is never the one
 * cut off. A voice note or picture shows the text the bot read from it, since that is what it
 * answered. Each reply says who wrote it: «البوت» or «موظف». The fix is one click away, on the
 * shop's «المعرفة».
 *
 * The banner stays at the top for as long as you are in here: whose data is on screen should never
 * depend on remembering how you got here.
 */

const MEDIA = {
  audio: [Mic, 'رسالة صوتية'], voice: [Mic, 'رسالة صوتية'], image: [ImageIcon, 'صورة'],
  video: [Video, 'فيديو'], document: [FileText, 'ملف'], sticker: [ImageIcon, 'ملصق'],
};

function Banner({ name, id }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 lg:-mx-8 -mt-5 lg:-mt-7 mb-4 px-4 lg:px-8 py-2.5 bg-shift-warnBg border-b border-[#EBD3A8] flex items-center gap-2 flex-wrap">
      <Eye size={15} className="text-shift-warn shrink-0" />
      <span className="text-[13.5px] text-shift-warn">
        محادثات <strong className="font-semibold">{name || '—'}</strong> — قراءة فقط — كل دخول مسجّل باسمك
      </span>
      <Link to={`/admin/accounts/${id}`} className="inline-flex items-center min-h-[40px] text-[13px] text-shift-warn underline underline-offset-2 ms-auto">
        رجوع للمحل
      </Link>
    </div>
  );
}

// Who wrote an outbound message. The server tags it (bot | staff); older rows fall back to the flag.
function authorOf(m) {
  const tag = m.author || m.sender_kind || m.by;
  if (tag === 'bot' || tag === 'staff') return tag;
  return m.is_ai_generated ? 'bot' : 'staff';
}

const clock = (iso) => (iso ? new Date(iso).toLocaleTimeString('ar-JO-u-nu-latn', { hour: '2-digit', minute: '2-digit', hour12: false }) : '');

function Body({ m }) {
  const transcript = m.transcript || m.media_transcript || null;
  const media = MEDIA[m.message_type];
  if (!media) {
    return <p className="m-0 whitespace-pre-wrap leading-relaxed">{m.text_body || <span className="text-shift-muted">—</span>}</p>;
  }
  const [Icon, label] = media;
  const text = transcript || m.text_body || null;
  return (
    <div>
      <span className="inline-flex items-center gap-1 text-[12px] text-shift-muted"><Icon size={12} /> {label}</span>
      {text
        ? <p className="m-0 mt-0.5 whitespace-pre-wrap leading-relaxed">{text}</p>
        : <p className="m-0 mt-0.5 text-[12.5px] text-shift-muted">لا يوجد نص محفوظ لهذه الوسائط</p>}
    </div>
  );
}

/** The thread, as WhatsApp lays it out: the customer on the start side, the shop's replies on the end. */
function Thread({ data }) {
  const box = useRef(null);
  // The newest message is the one being asked about; open the thread at it.
  useEffect(() => { if (data && box.current) box.current.scrollTop = box.current.scrollHeight; }, [data]);

  const messages = data.messages || [];
  return (
    <div ref={box} className="flex-1 min-h-0 overflow-y-auto bg-[#EFE9E1] p-4 flex flex-col gap-2 text-sm text-shift-ink">
      {data.truncated && <p className="m-0 text-center text-[12px] text-shift-muted">تظهر آخر 200 رسالة فقط</p>}
      {messages.length === 0 && <p className="m-0 text-center text-shift-body">لا توجد رسائل في هذه المحادثة</p>}
      {messages.map((m) => {
        const outbound = m.direction === 'outbound';
        const who = outbound ? authorOf(m) : null;
        const label = !outbound ? 'الزبون' : who === 'bot' ? 'البوت' : 'موظف';
        return (
          <div key={m.id}
            className={`max-w-[80%] rounded-[10px] px-2.5 py-2 ${!outbound ? 'self-start bg-white' : who === 'bot' ? 'self-end bg-[#D9FDD3]' : 'self-end bg-shift-sel'}`}>
            <Body m={m} />
            <div className="mt-0.5 text-[11px] text-shift-muted" title={m.created_at ? new Date(m.created_at).toLocaleString('ar-JO') : undefined}>
              <span dir="ltr" className="tabular-nums">{clock(m.created_at)}</span> · {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// A customer waits when the last thing in the thread is theirs.
const isWaiting = (c) => Boolean(c.last_inbound_at) && (!c.last_message_at || new Date(c.last_inbound_at) >= new Date(c.last_message_at));

function ConversationList({ conversations, onPick, active }) {
  return (
    <ul className="m-0 p-0 list-none divide-y divide-shift-line2">
      {conversations.map((c) => (
        <li key={c.id}>
          <button type="button" onClick={() => onPick(c.id)}
            className={`w-full text-right px-4 py-2.5 min-h-[48px] hover:bg-shift-hover ${active === c.id ? 'bg-shift-sel' : ''}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-shift-ink truncate">{c.profile_name || <Ltr>{maskPhone(c.customer_wa_id) || c.customer_wa_id}</Ltr>}</span>
              <Timestamp value={c.last_message_at} className="text-[12px] text-shift-muted shrink-0" />
            </div>
            <div className="flex flex-wrap items-center gap-x-2 text-[12px]">
              {c.profile_name && <Ltr className="text-shift-muted">{maskPhone(c.customer_wa_id) || c.customer_wa_id}</Ltr>}
              {isWaiting(c) && <span className="font-semibold text-shift-danger">ينتظر ردًا</span>}
              {c.ai_enabled === false && <span className="text-shift-warn">البوت موقوف لهذه المحادثة</span>}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * The read-only side panel for one conversation. Without a conversationId (the account page's
 * «محادثة تحتاج تدخلًا», whose attention row names no thread) it reads the recent list — itself a
 * logged read — and opens the newest thread whose customer is waiting, or lets you pick one.
 */
export function ConversationDrawer({ accountId, conversationId = null, ownerHref = null, onClose }) {
  const { user } = useAuth();
  const [active, setActive] = useState(conversationId);
  const [list, setList] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (conversationId) return;
    api.get(`/admin/accounts/${accountId}/conversations`)
      .then((res) => {
        const rows = res.data?.conversations || [];
        setList(rows);
        const waiting = rows.find(isWaiting);
        if (waiting) setActive(waiting.id);
      })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثات'));
  }, [accountId, conversationId]);

  useEffect(() => {
    if (!active) return;
    setData(null); setError(null);
    api.get(`/admin/accounts/${accountId}/conversations/${active}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثة'));
  }, [accountId, active]);

  const conv = data?.conversation;
  const who = conv ? (conv.profile_name || maskPhone(conv.customer_wa_id) || conv.customer_wa_id) : null;

  return (
    <Drawer title="فحص المحادثة" onClose={onClose} width={560}>
      <div className="-mt-2 flex flex-col gap-0.5">
        {who && <div className="font-semibold text-shift-ink">زبون <bdi dir="ltr">{who}</bdi></div>}
        <div className="text-[12.5px] font-medium text-shift-warn">
          للقراءة فقط · يُسجَّل هذا الدخول باسمك{user?.name ? ` (${user.name})` : ''} ويظهر في «السجل»
        </div>
        {conv?.ai_enabled === false && <div className="text-[12.5px] text-shift-warn">البوت موقوف لهذه المحادثة</div>}
      </div>
      {error && <p role="alert" className="m-0 text-[13px] text-shift-danger">{error}</p>}
      {!active && !error && (
        !list ? <SkeletonRows rows={5} cols={2} /> : list.length === 0
          ? <EmptyState tone="neutral" title="لا توجد محادثات بعد" />
          : (
            <div className="border border-shift-line rounded-xl overflow-hidden">
              <p className="m-0 px-4 py-2 text-[13px] text-shift-body bg-shift-canvas">لا أحد ينتظر الآن. اختر محادثة:</p>
              <ConversationList conversations={list} onPick={setActive} />
            </div>
          )
      )}
      {active && (
        <div className="-mx-[22px] flex-1 min-h-[320px] flex flex-col border-y border-shift-line">
          {data ? <Thread data={data} /> : !error && <SkeletonRows rows={6} cols={2} />}
        </div>
      )}
      <p className="m-0 text-[13px] text-shift-body">
        لا تستطيع الرد من هنا.
        {ownerHref && <> أرسل لصاحب المحل: <a href={ownerHref} target="_blank" rel="noopener noreferrer" className="text-shift-accent hover:text-shift-ink">راسله على واتساب</a> ·</>}
        {' '}أو صحّح الإجابة في <Link to={`/admin/accounts/${accountId}?tab=knowledge`} onClick={onClose} className="text-shift-accent hover:text-shift-ink">«المعرفة»</Link>
      </p>
    </Drawer>
  );
}

export default function AccountWorkspacePage() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [active, setActive] = useState(null);
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');

  // Typing is not a read: the search goes to the server (and into the access log) once it settles.
  useEffect(() => {
    const t = setTimeout(() => setSearch(q.trim()), 400);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    setError(null);
    api.get(`/admin/accounts/${id}/conversations`, { params: search ? { search } : {} })
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثات'));
  }, [id, search]);

  const conversations = data?.conversations || [];

  return (
    <div className="max-w-[900px] flex flex-col gap-4">
      <Banner name={data?.business?.name} id={id} />

      <div className="text-[13.5px] text-shift-body">
        <Link to="/admin/accounts" className="text-shift-accent hover:text-shift-ink no-underline">الزبائن</Link>
        <span aria-hidden="true"> / </span>
        <Link to={`/admin/accounts/${id}`} className="text-shift-accent hover:text-shift-ink no-underline">{data?.business?.name || 'المحل'}</Link>
        <span aria-hidden="true"> / </span>فحص المحادثات
      </div>

      <header className="flex flex-wrap items-end gap-3">
        <h1 className="flex-1 basis-60 m-0 font-display text-[28px] leading-[1.35] font-semibold text-shift-ink">فحص المحادثات</h1>
        <Link to={`/admin/accounts/${id}?tab=knowledge`} className={btnClass('secondary', 'md')}>
          <BookOpen size={15} /> صحّح الإجابة في «المعرفة»
        </Link>
      </header>

      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}

      <Card pad={false} title={`آخر المحادثات${data ? ` · ${conversations.length}` : ''}`}>
        <div className="px-[18px] pb-3">
          <div className="relative">
            <Search size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-shift-muted" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم الزبون أو اسمه" aria-label="ابحث برقم الزبون أو اسمه"
              className={`${fieldClass} pr-9`} />
          </div>
        </div>
        <div className="border-t border-shift-line2">
          {!data ? <SkeletonRows rows={6} cols={2} /> : conversations.length === 0 ? (
            <EmptyState tone="neutral" title={search ? 'لا نتائج مطابقة' : 'لا توجد محادثات بعد'} />
          ) : <ConversationList conversations={conversations} onPick={setActive} active={active} />}
        </div>
      </Card>

      {active && <ConversationDrawer key={active} accountId={id} conversationId={active} onClose={() => setActive(null)} />}
    </div>
  );
}
