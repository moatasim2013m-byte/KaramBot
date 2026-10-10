import { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCw, ChevronDown, Save } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Ltr, Timestamp, SkeletonRows } from '../shared/Primitives';

/**
 * «واتساب وMeta» — the Meta side of one shop, for SHIFT only.
 *
 * «محاولات الربط» is this shop's slice of the onboarding board's attempts (when, by whom, result,
 * step, the Arabic error and Meta's session id, which is what Meta support asks for). Then the ids,
 * copyable, «اسأل Meta», the card confirmation with its undo, and — collapsed, because the
 * attended connect replaced it — the manual id and token form for hand-wired numbers such as
 * SHIFT's own. The token is write-only: what is stored is never sent back to a browser.
 */

const input = 'w-full h-9 border border-gray-200 rounded-md px-3 text-[13px] focus:outline-none focus:ring-1 focus:ring-gray-400';
const RESULT_TONE = { اكتمل: 'text-emerald-700', خطأ: 'text-red-700', 'تعارض رقم': 'text-red-700', 'بحاجة لشِفت': 'text-amber-700' };
const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));

function CopyId({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-gray-400">—</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* selectable anyway */ }
  };
  return (
    <button type="button" onClick={copy} title="نسخ" className="inline-flex items-center gap-1 font-mono text-[12px] text-gray-700 hover:text-gray-900">
      <Ltr className="max-w-[14rem] truncate">{value}</Ltr> <Copy size={11} />
      {copied && <span className="font-sans text-emerald-700 text-[11px]">نُسخ</span>}
    </button>
  );
}

function ManualForm({ biz }) {
  const [phoneId, setPhoneId] = useState(biz.wa_phone_number_id || '');
  const [wabaId, setWabaId] = useState(biz.wa_business_account_id || '');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState(null);
  const [busy, setBusy] = useState(false);

  const saveIds = async () => {
    if (!phoneId.trim()) { setMsg({ tone: 'error', text: 'معرّف الرقم مطلوب' }); return; }
    setBusy(true); setMsg(null);
    try {
      await api.patch(`/businesses/${biz.id}`, { wa_phone_number_id: phoneId.trim(), wa_business_account_id: wabaId.trim() });
      setMsg({ tone: 'ok', text: 'حُفظت المعرّفات' });
    } catch (err) { setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر الحفظ' }); }
    finally { setBusy(false); }
  };
  const saveToken = async () => {
    if (!token.trim()) return;
    setBusy(true); setMsg(null);
    try {
      await api.patch(`/businesses/${biz.id}/token`, { wa_access_token: token.trim() });
      setToken('');
      setMsg({ tone: 'ok', text: 'حُفظ رمز الوصول (مشفّرًا)' });
    } catch (err) { setMsg({ tone: 'error', text: err.response?.data?.error || 'تعذّر حفظ رمز الوصول' }); }
    finally { setBusy(false); }
  };

  return (
    <div className="p-4 space-y-3 border-t border-gray-100">
      <p className="text-[12px] text-gray-500">للأرقام الموصولة يدويًا فقط (مثل رقم شِفت). الربط العادي يتم من «الحالة» مع صاحب المحل.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block"><span className="block text-[12px] text-gray-600 mb-1">معرّف الرقم (Phone Number ID)</span>
          <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} dir="ltr" className={`${input} font-mono`} /></label>
        <label className="block"><span className="block text-[12px] text-gray-600 mb-1">حساب واتساب للأعمال (WABA ID)</span>
          <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} dir="ltr" className={`${input} font-mono`} /></label>
      </div>
      <button type="button" onClick={saveIds} disabled={busy}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gray-900 text-white text-[12px] disabled:opacity-50"><Save size={12} /> احفظ المعرّفات</button>
      <label className="block"><span className="block text-[12px] text-gray-600 mb-1">رمز وصول جديد</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" autoComplete="new-password" className={input} /></label>
      <p className="text-[11px] text-gray-400">الرمز المحفوظ لا يُعرض أبدًا؛ ما تكتبه هنا يستبدله ويُخزَّن مشفّرًا.</p>
      <button type="button" onClick={saveToken} disabled={busy || !token.trim()}
        className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md bg-gray-900 text-white text-[12px] disabled:opacity-50"><Save size={12} /> احفظ رمز الوصول</button>
      {msg && <p className={`text-[12px] ${msg.tone === 'error' ? 'text-red-700' : 'text-emerald-700'}`}>{msg.text}</p>}
    </div>
  );
}

export default function AccountWhatsAppTab({ accountId, biz }) {
  const [detail, setDetail] = useState(null);
  const [attempts, setAttempts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState(false);

  const load = useCallback(() => {
    api.get(`/admin/accounts/${accountId}`)
      .then((res) => setDetail(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل بيانات واتساب'));
    // This shop's own history, with no 30-day window (the board's list is the fleet's last month).
    api.get(`/admin/accounts/${accountId}/es-attempts`)
      .then((res) => setAttempts(res.data?.attempts || []))
      .catch(() => setAttempts([]));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const askMeta = async () => {
    setBusy(true); setError(null);
    try { await api.post(`/admin/accounts/${accountId}/meta/refresh`); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر سؤال Meta'); }
    finally { setBusy(false); }
  };

  const setCard = async (ok) => {
    if (ok && !window.confirm('تأكيد أن بطاقة الدفع مضافة عند Meta؟ تأكّد منها في WhatsApp Manager أولًا.')) return;
    setBusy(true); setError(null);
    try { await api.patch(`/admin/accounts/${accountId}/payment-method`, { payment_method_ok: ok }); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر التعديل'); }
    finally { setBusy(false); }
  };

  const onb = detail?.onboarding || null;

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <Panel title={`محاولات الربط${attempts?.length ? ` · ${attempts.length}` : ''}`}>
        {!attempts ? <SkeletonRows rows={3} cols={5} /> : attempts.length === 0 ? (
          <p className="px-4 py-4 text-[13px] text-gray-400">لا محاولات ربط مسجّلة لهذا المحل.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="text-right text-[11px] text-gray-500 border-b border-gray-100">
                  {['الوقت', 'بدأها', 'النتيجة', 'الخطوة', 'الخطأ', 'رمز جلسة Meta'].map((h) => <th key={h} className="px-4 h-9 font-medium whitespace-nowrap">{h}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {attempts.map((a, i) => {
                  const result = hasArabic(a.result_ar) ? a.result_ar : '—';
                  return (
                    <tr key={`${a.at}-${i}`} className="align-top">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600"><Timestamp value={a.at} /></td>
                      <td className="px-4 py-2 text-gray-700">{a.started_by_ar || '—'}</td>
                      <td className={`px-4 py-2 font-medium ${RESULT_TONE[result] || 'text-gray-700'}`}>{result}</td>
                      <td className="px-4 py-2 text-gray-700">{a.step_ar || '—'}</td>
                      <td className="px-4 py-2 text-gray-700">{a.error_ar || '—'}</td>
                      <td className="px-4 py-2"><CopyId value={a.session_id} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <Panel title="المعرّفات"
        action={(
          <button type="button" onClick={askMeta} disabled={busy} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40">
            <RefreshCw size={12} /> {busy ? 'جارٍ…' : 'اسأل Meta'}
          </button>
        )}>
        {!detail ? <SkeletonRows rows={3} cols={2} /> : (
          <dl className="divide-y divide-gray-50">
            {[
              ['معرّف الرقم', onb?.phone_number_id || detail.account?.wa_phone_number_id],
              ['حساب واتساب للأعمال', onb?.waba_id || detail.account?.wa_business_account_id],
              ['تطبيق Meta', detail.account?.wa_app_id],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-3 px-4 h-10">
                <dt className="text-[13px] text-gray-600">{label}</dt>
                <dd><CopyId value={value} /></dd>
              </div>
            ))}
            <div className="flex items-center justify-between gap-3 px-4 h-10">
              <dt className="text-[13px] text-gray-600">رمز الوصول</dt>
              <dd className="text-[12px] text-gray-700">{detail.account?.has_token ? 'محفوظ (مشفّر)' : 'غير محفوظ'}</dd>
            </div>
            {onb?.meta?.checked_at && (
              <div className="flex items-center justify-between gap-3 px-4 h-9">
                <dt className="text-[11px] text-gray-400">آخر سؤال لـ Meta</dt>
                <dd><Timestamp value={onb.meta.checked_at} className="text-[11px] text-gray-400" /></dd>
              </div>
            )}
          </dl>
        )}
      </Panel>

      {onb && (
        <Panel title="بطاقة الدفع عند Meta">
          <div className="px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <p className="text-[13px] text-gray-700">
              {onb.payment_blocked_at ? <span className="text-red-700 font-medium">رفضت واتساب الإرسال بسبب طريقة الدفع</span>
                : onb.payment_method_ok ? <>مؤكَّدة{onb.payment_method_marked_by && <span className="text-gray-400"> — أكّدها {onb.payment_method_marked_by}</span>}</>
                  : onb.payment_method_claimed_at ? <>قال الزبون «أضفت البطاقة» <Timestamp value={onb.payment_method_claimed_at} /> — بانتظار تأكيد شِفت</>
                    : 'غير مؤكَّدة'}
            </p>
            {onb.payment_method_ok ? (
              <button type="button" onClick={() => setCard(false)} disabled={busy} className="text-[12px] text-gray-500 hover:text-red-600 underline">تراجَع عن التأكيد</button>
            ) : (
              <button type="button" onClick={() => setCard(true)} disabled={busy}
                className="h-8 px-3 rounded-md bg-gray-900 text-white text-[12px] disabled:opacity-40">أكّد البطاقة</button>
            )}
          </div>
        </Panel>
      )}

      <Panel>
        <button type="button" onClick={() => setManual((v) => !v)}
          className="w-full flex items-center justify-between px-4 h-11 text-[13px] font-semibold text-gray-700">
          متقدم: إدخال يدوي
          <ChevronDown size={15} className={`text-gray-400 transition-transform ${manual ? 'rotate-180' : ''}`} />
        </button>
        {manual && biz && <ManualForm biz={biz} />}
      </Panel>
    </div>
  );
}
