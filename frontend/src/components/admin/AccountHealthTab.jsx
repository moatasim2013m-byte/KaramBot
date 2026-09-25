import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Minus, ExternalLink, Eye } from 'lucide-react';
import api from '../../utils/api';
import { Panel, StateCell, Timestamp, Ltr, SkeletonRows } from '../shared/Primitives';
import TryTheBot from '../whatsapp/TryTheBot';
import BusinessKnowledge from '../whatsapp/BusinessKnowledge';

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

      {/* Staff can fill this in during onboarding, before handing the account over. */}
      {!['restaurant', 'clinic', 'shift'].includes(account.business_type) && (
        <BusinessKnowledge businessId={accountId} />
      )}

      {/* Runs the account's real workflow now — the model-only check certified dead bots. */}
      <TryTheBot endpoint={`/admin/accounts/${accountId}/test-message`} />
    </div>
  );
}
