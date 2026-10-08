import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, ArrowRight, Bot, User, Search, Mic, Image as ImageIcon, Video, FileText, BookOpen } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Timestamp, Ltr, SkeletonRows, EmptyState } from '../../components/shared/Primitives';

/**
 * «فحص المحادثات» — read-only, audited inspection of one shop's conversations.
 *
 * This exists for one job: seeing what the bot actually said when an owner reports a wrong answer
 * («البوت قال سعرًا غلط»). It is not a workspace — there is no reply box, no claim, no takeover,
 * and the backend has no write route to offer one. Every list and every thread opened is written
 * to admin_access_logs on the server and shows in the shop's «السجل».
 *
 * A thread shows its newest 200 messages in order, so the recent wrong answer is never the one
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
    <div className="sticky top-0 z-10 -mx-4 lg:-mx-6 -mt-4 lg:-mt-6 mb-4 px-4 lg:px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap">
      <Eye size={15} className="text-amber-700 shrink-0" />
      <span className="text-[13px] text-amber-900">
        محادثات <strong className="font-semibold">{name || '—'}</strong> — قراءة فقط — كل دخول مسجّل باسمك
      </span>
      <Link to={`/admin/accounts/${id}`} className="text-[12px] text-amber-900 underline underline-offset-2 mr-auto">
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

function Body({ m }) {
  const transcript = m.transcript || m.media_transcript || null;
  const media = MEDIA[m.message_type];
  if (!media) {
    return <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{m.text_body || <span className="text-gray-400">—</span>}</p>;
  }
  const [Icon, label] = media;
  const text = transcript || m.text_body || null;
  return (
    <div>
      <span className="inline-flex items-center gap-1 text-[11px] text-gray-500"><Icon size={11} /> {label}</span>
      {text
        ? <p className="mt-0.5 text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{text}</p>
        : <p className="mt-0.5 text-[12px] text-gray-400">لا يوجد نص محفوظ لهذه الوسائط</p>}
    </div>
  );
}

function Thread({ accountId, conversationId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const box = useRef(null);

  useEffect(() => {
    setData(null); setError(null);
    api.get(`/admin/accounts/${accountId}/conversations/${conversationId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثة'));
  }, [accountId, conversationId]);

  // The newest message is the one being asked about; open the thread at it.
  useEffect(() => { if (data && box.current) box.current.scrollTop = box.current.scrollHeight; }, [data]);

  if (error) return <div className="p-4 text-[13px] text-red-700">{error}</div>;
  if (!data) return <SkeletonRows rows={6} cols={2} />;

  const messages = data.messages || [];
  return (
    <div ref={box} className="p-4 space-y-2.5 max-h-[65vh] overflow-y-auto">
      {data.truncated && <p className="text-center text-[11px] text-gray-400">تظهر آخر 200 رسالة فقط</p>}
      {messages.length === 0 && <EmptyState tone="neutral" title="لا توجد رسائل في هذه المحادثة" />}
      {messages.map((m) => {
        const outbound = m.direction === 'outbound';
        const who = outbound ? authorOf(m) : null;
        return (
          <div key={m.id} className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 ${!outbound ? 'bg-emerald-50' : who === 'bot' ? 'bg-gray-100' : 'bg-blue-50'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {outbound ? (
                  <span className={`inline-flex items-center gap-1 text-[10px] font-medium rounded px-1.5 py-0.5 ${who === 'bot' ? 'bg-gray-200 text-gray-700' : 'bg-blue-100 text-blue-800'}`}>
                    {who === 'bot' ? <Bot size={10} /> : <User size={10} />} {who === 'bot' ? 'البوت' : 'موظف'}
                  </span>
                ) : <span className="text-[10px] text-gray-500">الزبون</span>}
                <Timestamp value={m.created_at} className="text-[10px] text-gray-400 mr-auto" />
              </div>
              <Body m={m} />
            </div>
          </div>
        );
      })}
    </div>
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
    <div className="max-w-[1200px]">
      <Banner name={data?.business?.name} id={id} />

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <Link to={`/admin/accounts/${id}`} className="text-gray-400 hover:text-gray-700"><ArrowRight size={17} /></Link>
        <h1 className="text-lg font-bold text-gray-900">فحص المحادثات</h1>
        <Link to={`/admin/accounts/${id}?tab=knowledge`}
          className="mr-auto inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-800 px-3 h-8 rounded-md text-[12px] hover:bg-gray-50">
          <BookOpen size={13} /> صحّح الإجابة في «المعرفة»
        </Link>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3 mb-3">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        <Panel title={`آخر المحادثات${data ? ` · ${conversations.length}` : ''}`}>
          <div className="px-3 py-2 border-b border-gray-100">
            <div className="relative">
              <Search size={13} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="ابحث برقم الزبون أو اسمه"
                className="h-8 w-full pr-8 pl-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400" />
            </div>
          </div>
          {!data ? <SkeletonRows rows={6} cols={2} /> : conversations.length === 0 ? (
            <EmptyState tone="neutral" title={search ? 'لا نتائج مطابقة' : 'لا توجد محادثات بعد'} />
          ) : (
            <ul className="divide-y divide-gray-50 max-h-[65vh] overflow-y-auto">
              {conversations.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => setActive(c.id)}
                    className={`w-full text-right px-4 py-2 hover:bg-gray-50 transition-colors ${active === c.id ? 'bg-gray-50' : ''}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-gray-900 truncate">{c.profile_name || <Ltr className="font-mono text-xs">{c.customer_wa_id}</Ltr>}</span>
                      <Timestamp value={c.last_message_at} className="text-[11px] text-gray-400 shrink-0" />
                    </div>
                    {c.profile_name && <Ltr className="text-[11px] text-gray-400 font-mono">{c.customer_wa_id}</Ltr>}
                    {c.ai_enabled === false && <span className="block text-[10px] text-amber-700">البوت موقوف لهذه المحادثة</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={active ? 'المحادثة' : ''}>
          {active
            ? <Thread accountId={id} conversationId={active} />
            : <EmptyState tone="neutral" title="اختر محادثة" hint="لترى ما قاله البوت فعليًا" />}
        </Panel>
      </div>
    </div>
  );
}
