import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Eye, ArrowRight, Bot, User } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Timestamp, Ltr, SkeletonRows, EmptyState } from '../../components/shared/Primitives';

/**
 * Read-only inspection of a customer's conversations.
 *
 * This exists for one job: seeing what the agent actually said when an owner reports a wrong
 * answer. It is not a workspace — there is no reply box, no claim, no takeover, and the
 * backend has no write route to offer one.
 *
 * The banner stays fixed at the top for as long as you are in here. Knowing whose data is on
 * screen should never depend on remembering how you got here.
 */

function Banner({ name }) {
  return (
    <div className="sticky top-0 z-10 -mx-4 lg:-mx-6 -mt-4 lg:-mt-6 mb-4 px-4 lg:px-6 py-2.5 bg-amber-50 border-b border-amber-200 flex items-center gap-2 flex-wrap">
      <Eye size={15} className="text-amber-700 shrink-0" />
      <span className="text-[13px] text-amber-900">
        أنت تشاهد محادثات <strong className="font-semibold">{name || '—'}</strong> — قراءة فقط، ومسجّلة.
      </span>
      <Link to="../" relative="path" className="text-[12px] text-amber-900 underline underline-offset-2 mr-auto">
        رجوع للحساب
      </Link>
    </div>
  );
}

function Thread({ accountId, conversationId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null);
    api.get(`/admin/accounts/${accountId}/conversations/${conversationId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثة'));
  }, [accountId, conversationId]);

  if (error) return <div className="p-4 text-[13px] text-red-700">{error}</div>;
  if (!data) return <SkeletonRows rows={6} cols={2} />;

  return (
    <div className="p-4 space-y-2.5 max-h-[60vh] overflow-y-auto">
      {data.messages.length === 0 && (
        <EmptyState tone="neutral" title="لا توجد رسائل في هذه المحادثة" />
      )}
      {data.messages.map((m) => {
        const outbound = m.direction === 'outbound';
        return (
          <div key={m.id} className={`flex ${outbound ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[75%] rounded-lg px-3 py-2 ${outbound ? 'bg-gray-100' : 'bg-emerald-50'}`}>
              <div className="flex items-center gap-1.5 mb-1">
                {outbound
                  ? <>{m.is_ai_generated ? <Bot size={11} className="text-gray-500" /> : <User size={11} className="text-gray-500" />}
                      <span className="text-[10px] text-gray-500">{m.is_ai_generated ? 'الوكيل' : 'موظف'}</span></>
                  : <span className="text-[10px] text-gray-500">العميل</span>}
                <Timestamp value={m.created_at} className="text-[10px] text-gray-400 mr-auto" />
              </div>
              <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">
                {m.text_body || <span className="text-gray-400">[{m.message_type}]</span>}
              </p>
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

  useEffect(() => {
    api.get(`/admin/accounts/${id}/conversations`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المحادثات'));
  }, [id]);

  return (
    <div className="max-w-[1100px]">
      <Banner name={data?.business?.name} />

      <div className="flex items-center gap-2 mb-3">
        <Link to={`/admin/accounts/${id}`} className="text-gray-400 hover:text-gray-700"><ArrowRight size={17} /></Link>
        <h1 className="text-lg font-bold text-gray-900">المحادثات</h1>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <Panel title={`آخر المحادثات${data ? ` · ${data.conversations.length}` : ''}`}>
          {!data ? <SkeletonRows rows={6} cols={2} /> : data.conversations.length === 0 ? (
            <EmptyState tone="neutral" title="لا توجد محادثات بعد" />
          ) : (
            <ul className="divide-y divide-gray-50 max-h-[60vh] overflow-y-auto">
              {data.conversations.map((c) => (
                <li key={c.id}>
                  <button
                    onClick={() => setActive(c.id)}
                    className={`w-full text-right px-4 py-2 hover:bg-gray-50 transition-colors ${active === c.id ? 'bg-gray-50' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[13px] font-medium text-gray-900 truncate">
                        {c.profile_name || <Ltr className="font-mono text-xs">{c.customer_wa_id}</Ltr>}
                      </span>
                      <Timestamp value={c.last_message_at} className="text-[11px] text-gray-400 shrink-0" />
                    </div>
                    {c.ai_enabled === false && (
                      <span className="text-[10px] text-amber-700">الوكيل موقوف لهذه المحادثة</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={active ? 'المحادثة' : ''}>
          {active
            ? <Thread accountId={id} conversationId={active} />
            : <EmptyState tone="neutral" title="اختر محادثة" hint="لمعاينة ما قاله الوكيل فعليًا" />}
        </Panel>
      </div>
    </div>
  );
}
