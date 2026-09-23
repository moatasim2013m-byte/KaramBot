import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Minus, Play, ExternalLink, Eye } from 'lucide-react';
import api from '../../utils/api';
import { Panel, StateCell, Timestamp, Ltr, SkeletonRows } from '../shared/Primitives';

/**
 * Whether this account can actually serve customers, and what is missing.
 *
 * The checklist is derived on every request rather than stored, so it cannot drift from
 * reality when someone changes a token by hand. A step we genuinely cannot determine shows
 * as a dash, not a tick.
 */

function Tick({ done }) {
  if (done === true) return <Check size={14} className="text-emerald-600" />;
  if (done === false) return <X size={14} className="text-red-500" />;
  return <Minus size={14} className="text-gray-300" />; // unknown — never a tick
}

/** Asks the agent a question and sends nothing. */
function TestMessage({ accountId }) {
  const [text, setText] = useState('مرحبا، شو أسعاركم؟');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const res = await api.post(`/admin/accounts/${accountId}/test-message`, { message: text });
      setResult(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر توليد الرد');
    } finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-3">
      <p className="text-xs text-gray-500">
        يجرّب ردّ الوكيل بإعدادات هذا الحساب. لا تُرسَل أي رسالة على واتساب ولا تُحفَظ في المحادثات.
      </p>
      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !busy && run()}
          className="flex-1 h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          placeholder="اكتب ما قد يكتبه العميل"
        />
        <button
          onClick={run}
          disabled={busy || !text.trim()}
          className="flex items-center gap-1.5 bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          <Play size={13} />
          {busy ? 'جارٍ...' : 'جرّب'}
        </button>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-[13px] rounded-md px-3 py-2">{error}</div>}

      {result && (
        <div className="border border-gray-200 rounded-md">
          <div className="flex items-center justify-between px-3 h-8 border-b border-gray-100 bg-gray-50">
            <span className="text-[11px] text-gray-500">ردّ الوكيل — لم يُرسَل</span>
            <span className="text-[11px] text-gray-400"><Ltr>{result.latency_ms}</Ltr> ms</span>
          </div>
          <p className="px-3 py-2.5 text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{result.reply}</p>
          {result.ai_enabled === false && (
            <p className="px-3 pb-2 text-[11px] text-amber-700">
              الذكاء الاصطناعي موقوف لهذا الحساب — العملاء لن يصلهم هذا الرد.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

export default function AccountHealthTab({ accountId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/admin/accounts/${accountId}`)
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل حالة الحساب'));
  }, [accountId]);

  if (error) return <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>;
  if (!data) return <Panel><SkeletonRows rows={6} cols={2} /></Panel>;

  const { account, onboarding, checklist } = data;

  return (
    <div className="space-y-4">
      <Panel title="الحالة">
        <div className="divide-y divide-gray-50">
          <div className="flex items-center justify-between px-4 h-10">
            <span className="text-[13px] text-gray-600">اتصال واتساب</span>
            <StateCell state={account.connection?.state} label={account.connection?.label} sub={account.connection?.sub} />
          </div>
          <div className="flex items-center justify-between px-4 h-10">
            <span className="text-[13px] text-gray-600">الوكيل</span>
            <StateCell state={account.agent?.state} label={account.agent?.label} sub={account.agent?.sub} />
          </div>
          <div className="flex items-center justify-between px-4 h-10">
            <span className="text-[13px] text-gray-600">آخر رسالة واردة</span>
            <Timestamp value={account.last_inbound_at} className="text-[13px] text-gray-700" />
          </div>
          <div className="flex items-center justify-between px-4 h-10">
            <span className="text-[13px] text-gray-600">آخر رد صادر</span>
            <Timestamp value={account.last_outbound_at} className="text-[13px] text-gray-700" />
          </div>
        </div>
      </Panel>

      <Panel title="خطوات التوصيل">
        <ul className="divide-y divide-gray-50">
          {checklist.map((c) => (
            <li key={c.step} className="flex items-center gap-3 px-4 h-9">
              <Tick done={c.done} />
              <span className={`text-[13px] ${c.done === true ? 'text-gray-500' : 'text-gray-800'}`}>{c.label}</span>
            </li>
          ))}
        </ul>
        {onboarding && !onboarding.payment_method_ok && (
          <div className="px-4 py-3 bg-amber-50 border-t border-amber-100">
            <p className="text-[13px] text-amber-900 font-medium">بانتظار طريقة دفع</p>
            <p className="text-xs text-amber-800 mt-0.5">
              الرسائل التي تبدأ من المنشأة لن تُرسَل حتى يضيف صاحب الحساب طريقة دفع.
            </p>
            <a
              href="https://business.facebook.com/wa/manage/home/"
              target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 mt-1.5 text-xs font-medium text-amber-900 underline"
            >
              WhatsApp Manager <ExternalLink size={11} />
            </a>
          </div>
        )}
        {onboarding?.last_error && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-100">
            <p className="text-[13px] text-red-900 font-medium">آخر خطأ في التوصيل</p>
            <p className="text-xs text-red-800 mt-0.5">{onboarding.last_error}</p>
            <Timestamp value={onboarding.last_error_at} className="text-[11px] text-red-700" />
          </div>
        )}
      </Panel>

      {onboarding && (
        <Panel title="معرّفات Meta">
          <div className="divide-y divide-gray-50">
            {[['حساب واتساب للأعمال', onboarding.waba_id], ['معرّف الرقم', onboarding.phone_number_id]].map(([l, v]) => (
              <div key={l} className="flex items-center justify-between px-4 h-10">
                <span className="text-[13px] text-gray-600">{l}</span>
                <Ltr className="font-mono text-xs text-gray-700">{v || '—'}</Ltr>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel title="فحص المحادثات">
        <div className="p-4">
          <p className="text-xs text-gray-500 mb-2">
            لمعاينة ما قاله الوكيل فعليًا عند شكوى من رد خاطئ. قراءة فقط، وكل دخول يُسجَّل.
          </p>
          <Link
            to={`/admin/accounts/${accountId}/conversations`}
            className="inline-flex items-center gap-1.5 border border-gray-200 text-gray-800 px-3 h-8 rounded-md text-[13px] hover:border-gray-300 hover:bg-gray-50 transition-colors"
          >
            <Eye size={14} />
            عرض مساحة العمل
          </Link>
        </div>
      </Panel>

      <Panel title="تجربة الوكيل">
        <TestMessage accountId={accountId} />
      </Panel>
    </div>
  );
}
