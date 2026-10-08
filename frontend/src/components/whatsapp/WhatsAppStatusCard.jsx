import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink, MessageCircle, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { StatusDot, Timestamp } from '../shared/Primitives';
import { explainControls } from './setupControls';
import { ClaimCardButton, ConnectInline } from './OwnerSetupActions';

/**
 * «هل واتسابي موصول؟» — the customer's own answer.
 *
 * Two personas walked the real dashboard and both scored it 4/10 for exactly this: nothing
 * told a paying customer whether the WhatsApp they pay for is connected. The state here comes
 * from the same functions SHIFT staff see in the fleet view, so both sides read one truth.
 *
 * What the customer can do themselves is offered here: connect the number (once owners may,
 * es_owner_enabled), add a payment method and say so («أضفت البطاقة»), or tell the bot about the
 * shop. Retrying a stopped connect stays in the same «اربط واتساب» screen.
 */

const TONE = {
  good: 'border-emerald-200 bg-emerald-50',
  warn: 'border-amber-200 bg-amber-50',
  bad: 'border-red-200 bg-red-50',
};
const TONE_TEXT = { good: 'text-emerald-900', warn: 'text-amber-900', bad: 'text-red-900' };
const SUPPORT_WA = 'https://wa.me/962776788972';
const MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';

export default function WhatsAppStatusCard({ compact = false }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    api.get('/whatsapp/status')
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر قراءة حالة واتساب'))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  if (error) return <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="rounded-lg border border-gray-200 bg-white px-4 py-4 animate-pulse"><div className="h-3 w-1/3 bg-gray-100 rounded" /></div>;

  const { connection, agent, explain, last_inbound_at, last_outbound_at, setup } = data;
  // The page that holds this shop's knowledge (menu, services or facts), from the setup steps.
  const knowledgeWhere = setup?.steps?.find((s) => ['knowledge', 'menu', 'services'].includes(s.key))?.where || '/settings';
  const controls = explainControls(explain, { managerUrl: MANAGER_URL, knowledgeWhere });

  // On the overview, one honest line where four zeros used to leave the customer guessing.
  if (compact) {
    return (
      <div className={`rounded-lg border px-4 py-2.5 flex items-center gap-3 ${TONE[explain.tone]}`}>
        <StatusDot state={connection.state === 'ok' ? agent.state : connection.state} />
        <span className={`text-[13px] font-medium ${TONE_TEXT[explain.tone]}`}>{explain.title}</span>
        <span className="text-[12px] text-gray-600 truncate hidden sm:inline">{explain.body}</span>
      </div>
    );
  }

  return (
    <section className={`rounded-lg border ${TONE[explain.tone]}`}>
      <div className="flex items-start gap-3 px-4 pt-4">
        <MessageCircle size={20} className={TONE_TEXT[explain.tone]} />
        <div className="flex-1 min-w-0">
          <h3 className={`text-[15px] font-semibold ${TONE_TEXT[explain.tone]}`}>{explain.title}</h3>
          <p className="mt-1 text-[13px] text-gray-700 leading-relaxed">{explain.body}</p>
        </div>
        <button onClick={load} disabled={loading} className="text-gray-400 hover:text-gray-700 disabled:opacity-40" title="تحديث">
          <RefreshCw size={15} />
        </button>
      </div>

      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 px-4 py-3 mt-3 border-t border-black/5 text-[12px]">
        <div><dt className="text-gray-500">الاتصال</dt><dd className="flex items-center gap-1.5 text-gray-800"><StatusDot state={connection.state} />{connection.label}</dd></div>
        <div><dt className="text-gray-500">الوكيل</dt><dd className="flex items-center gap-1.5 text-gray-800"><StatusDot state={agent.state} />{agent.label}</dd></div>
        <div><dt className="text-gray-500">آخر رسالة من زبون</dt><dd className="text-gray-800"><Timestamp value={last_inbound_at} /></dd></div>
        <div><dt className="text-gray-500">آخر رد من الوكيل</dt><dd className="text-gray-800"><Timestamp value={last_outbound_at} /></dd></div>
      </dl>

      {controls.length > 0 && (
        <div className="px-4 pb-4 flex flex-wrap items-center gap-x-4 gap-y-1">
          {controls.map((c) => {
            if (c.kind === 'connect') return <ConnectInline key={c.kind} onDone={load} />;
            if (c.kind === 'claim') return <ClaimCardButton key={c.kind} onDone={load} />;
            if (c.kind === 'manager') {
              return (
                <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-900 underline underline-offset-2">
                  {c.label} <ExternalLink size={12} />
                </a>
              );
            }
            if (c.kind === 'knowledge') {
              return (
                <Link key={c.kind} to={c.to}
                  className="inline-flex items-center gap-1.5 text-[13px] font-medium text-amber-900 underline underline-offset-2">
                  {c.label}
                </Link>
              );
            }
            return (
              <a key={c.kind} href={SUPPORT_WA} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-900 underline underline-offset-2">
                {c.label} <ExternalLink size={12} />
              </a>
            );
          })}
        </div>
      )}
    </section>
  );
}
