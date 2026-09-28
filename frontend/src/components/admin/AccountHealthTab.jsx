import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Minus, ExternalLink, Eye, RefreshCw } from 'lucide-react';
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

const QUALITY = { GREEN: ['ok', 'أخضر'], YELLOW: ['degraded', 'أصفر'], RED: ['down', 'أحمر'] };
const NAME_STATUS = { APPROVED: ['ok', 'مقبول'], DECLINED: ['down', 'مرفوض'], PENDING_REVIEW: ['degraded', 'قيد المراجعة'] };

export default function AccountHealthTab({ accountId }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/admin/accounts/${accountId}`)
    .then((res) => { setData(res.data); setError(null); })
    .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل حالة الحساب'));

  useEffect(() => { load(); }, [accountId]);

  const refreshMeta = async () => {
    setBusy(true); setError(null);
    try { await api.post(`/admin/accounts/${accountId}/meta/refresh`); await load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر سؤال Meta'); }
    finally { setBusy(false); }
  };

  const setPaymentMethod = async (ok) => {
    setBusy(true); setError(null);
    try { await api.patch(`/admin/accounts/${accountId}/payment-method`, { payment_method_ok: ok }); await load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر التعديل'); }
    finally { setBusy(false); }
  };

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
            <p className="text-[13px] text-amber-900 font-medium">لا توجد طريقة دفع — مهلة 30 أيلول</p>
            <p className="text-xs text-amber-800 mt-0.5">
              من 1 تشرين الأول تتوقف Meta عن تسليم رسائل الخدمة لأي حساب بلا طريقة دفع: أي أن الوكيل
              يتوقف عن الرد على الزبائن. Meta لا تُخبرنا بذلك، فأكّدها يدويًا بعد أن تراها مضافة.
            </p>
            <div className="flex items-center gap-3 mt-2">
              <a href="https://business.facebook.com/wa/manage/home/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline">
                WhatsApp Manager <ExternalLink size={11} />
              </a>
              <button onClick={() => setPaymentMethod(true)} disabled={busy}
                className="text-xs font-medium bg-amber-900 text-white px-2.5 h-7 rounded disabled:opacity-40">
                رأيتها مضافة — أكّد
              </button>
            </div>
          </div>
        )}
        {onboarding?.payment_method_ok && (
          <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between">
            <p className="text-[12px] text-gray-600">
              طريقة الدفع مؤكَّدة
              {onboarding.payment_method_marked_by && <span className="text-gray-400"> — أكّدها {onboarding.payment_method_marked_by}</span>}
              {onboarding.payment_method_marked_at && <> <Timestamp value={onboarding.payment_method_marked_at} /></>}
            </p>
            <button onClick={() => setPaymentMethod(false)} disabled={busy} className="text-[11px] text-gray-400 hover:text-red-600 underline">
              تراجَع
            </button>
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

      {onboarding?.meta && (
        <Panel
          title="ما تقوله Meta"
          action={
            <button onClick={refreshMeta} disabled={busy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
              <RefreshCw size={12} /> {busy ? 'جارٍ…' : 'اسأل Meta'}
            </button>
          }
        >
          {!onboarding.meta.checked_at ? (
            <p className="px-4 py-3 text-[13px] text-gray-500">لم نسأل Meta بعد عن هذا الحساب.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              <div className="flex items-center justify-between px-4 h-10">
                <span className="text-[13px] text-gray-600">تقييم الجودة</span>
                <StateCell state={(QUALITY[onboarding.meta.quality_rating] || ['unknown'])[0]}
                  label={(QUALITY[onboarding.meta.quality_rating] || [null, onboarding.meta.quality_rating || 'غير معروف'])[1]} />
              </div>
              <div className="flex items-center justify-between px-4 h-10">
                <span className="text-[13px] text-gray-600">حالة الرقم</span>
                {/* A missing reading is not an outage: an empty answer from Meta must render as
                    unknown, or we invent a problem the account does not have. */}
                <StateCell
                  state={!onboarding.meta.number_status ? 'unknown' : (onboarding.meta.number_status === 'CONNECTED' ? 'ok' : 'down')}
                  label={onboarding.meta.number_status || 'غير معروف'} />
              </div>
              <div className="flex items-center justify-between px-4 h-10">
                <span className="text-[13px] text-gray-600">الاسم الظاهر</span>
                <StateCell state={(NAME_STATUS[onboarding.meta.name_status] || ['unknown'])[0]}
                  label={(NAME_STATUS[onboarding.meta.name_status] || [null, onboarding.meta.name_status || 'غير معروف'])[1]} />
              </div>
              <div className="flex items-center justify-between px-4 h-10">
                <span className="text-[13px] text-gray-600">سعة الإرسال · مراجعة الحساب</span>
                <span className="text-[13px] text-gray-700">
                  <Ltr>{onboarding.meta.throughput || '—'}</Ltr> · <Ltr>{onboarding.meta.review_status || '—'}</Ltr>
                </span>
              </div>
              <div className="flex items-center justify-between px-4 h-9">
                <span className="text-[11px] text-gray-400">آخر سؤال لـ Meta</span>
                <Timestamp value={onboarding.meta.checked_at} className="text-[11px] text-gray-400" />
              </div>
            </div>
          )}
        </Panel>
      )}

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
