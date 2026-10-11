import { useCallback, useEffect, useState } from 'react';
import { Copy, RefreshCw, Save } from 'lucide-react';
import api from '../../utils/api';
import { Ltr, Timestamp, SkeletonRows } from '../shared/Primitives';
import { Button, Card, Tag, fieldClass, labelClass } from './ui';

/**
 * «واتساب وMeta» — the Meta side of one shop, for SHIFT only.
 *
 * First the connection in a line, the ids, copyable one by one or all at once, and «تحديث الحالة»
 * (ask Meta); then the card confirmation with its undo. «تشخيص الربط» is this shop's slice of the
 * onboarding board's attempts (when, by whom, result, step, the Arabic error and Meta's session id,
 * which is what Meta support asks for), folded. Last — folded too, because the attended connect
 * replaced it — the manual id and token form for hand-wired numbers such as SHIFT's own. The
 * token is write-only: what is stored is never sent back to a browser.
 */

const input = fieldClass;
const RESULT_TONE = { اكتمل: 'text-shift-ok', خطأ: 'text-shift-danger', 'تعارض رقم': 'text-shift-danger', 'بحاجة لشِفت': 'text-shift-warn' };
const RESULT_TAG = { خطأ: 'critical', 'تعارض رقم': 'critical', 'بحاجة لشِفت': 'warning' };
const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));

function CopyId({ value }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-shift-muted">—</span>;
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* selectable anyway */ }
  };
  return (
    <button type="button" onClick={copy} title="نسخ" className="inline-flex items-center gap-1.5 min-h-[40px] max-w-full font-mono text-[12.5px] text-shift-ink hover:text-shift-accent">
      <Ltr className="max-w-[14rem] truncate select-all">{value}</Ltr> <Copy size={13} className="shrink-0" />
      {copied && <span role="status" className="font-sans text-shift-ok text-[12px]">نُسخ</span>}
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
    <div className="mt-3 flex flex-col gap-3">
      <p className="m-0 text-[13px] text-shift-body">للأرقام الموصولة يدويًا فقط (مثل رقم شِفت). الربط العادي يتم من «الحالة» مع صاحب المحل.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 min-w-0"><span className={labelClass}>معرّف الرقم (Phone Number ID)</span>
          <input value={phoneId} onChange={(e) => setPhoneId(e.target.value)} dir="ltr" className={`${input} font-mono`} /></label>
        <label className="flex flex-col gap-1.5 min-w-0"><span className={labelClass}>حساب واتساب للأعمال (WABA ID)</span>
          <input value={wabaId} onChange={(e) => setWabaId(e.target.value)} dir="ltr" className={`${input} font-mono`} /></label>
      </div>
      <Button variant="primary" onClick={saveIds} disabled={busy} className="self-start"><Save size={15} /> احفظ المعرّفات</Button>
      <label className="flex flex-col gap-1.5"><span className={labelClass}>رمز وصول جديد</span>
        <input type="password" value={token} onChange={(e) => setToken(e.target.value)} dir="ltr" autoComplete="new-password" className={input} /></label>
      <p className="m-0 text-[12.5px] text-shift-muted">الرمز المحفوظ لا يُعرض أبدًا؛ ما تكتبه هنا يستبدله ويُخزَّن مشفّرًا.</p>
      <Button variant="primary" onClick={saveToken} disabled={busy || !token.trim()} className="self-start"><Save size={15} /> احفظ رمز الوصول</Button>
      {msg && <p role={msg.tone === 'error' ? 'alert' : 'status'} className={`m-0 text-[13px] ${msg.tone === 'error' ? 'text-shift-danger' : 'text-shift-ok'}`}>{msg.text}</p>}
    </div>
  );
}

export default function AccountWhatsAppTab({ accountId, biz }) {
  const [detail, setDetail] = useState(null);
  const [attempts, setAttempts] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

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
  const ids = detail ? [
    ['معرّف الرقم', onb?.phone_number_id || detail.account?.wa_phone_number_id],
    ['حساب واتساب للأعمال', onb?.waba_id || detail.account?.wa_business_account_id],
    ['تطبيق Meta', detail.account?.wa_app_id],
  ] : [];

  // All the ids in one paste, labelled, for a Meta support ticket.
  const copyAll = async () => {
    const text = ids.filter(([, v]) => v).map(([l, v]) => `${l}: ${v}`).join('\n');
    if (!text) return;
    try { await navigator.clipboard.writeText(text); setCopiedAll(true); setTimeout(() => setCopiedAll(false), 1500); } catch { /* each id is selectable */ }
  };

  const card = onb?.payment_blocked_at ? ['critical', 'رفضت واتساب الإرسال بسبب طريقة الدفع']
    : onb?.payment_method_ok ? [null, 'مؤكَّدة']
      : onb?.payment_method_claimed_at ? ['warning', null]
        : ['warning', 'غير مؤكَّدة'];

  return (
    <div className="flex flex-col gap-4">
      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}

      <Card title="واتساب وMeta"
        action={(
          <Button size="sm" onClick={askMeta} disabled={busy} className="!min-h-[40px]">
            <RefreshCw size={13} /> {busy ? 'جارٍ…' : 'تحديث الحالة'}
          </Button>
        )}>
        {!detail ? <SkeletonRows rows={3} cols={2} /> : (
          <div className="flex flex-col gap-3 text-sm text-shift-ink">
            <div className="flex flex-wrap gap-x-6 gap-y-1">
              <span>{detail.account?.connection?.label || '—'}{(biz?.connected_at || detail.account?.connected_at) && <> · متصل منذ <Timestamp value={biz?.connected_at || detail.account.connected_at} /></>}</span>
              <span>رمز الوصول: {detail.account?.has_token ? 'محفوظ (مشفّر)' : 'غير محفوظ'}</span>
              {onb?.meta?.checked_at && <span className="text-shift-muted">آخر سؤال لـ Meta <Timestamp value={onb.meta.checked_at} /></span>}
            </div>
            <dl className="m-0 flex flex-col">
              {ids.map(([label, value]) => (
                <div key={label} className="flex flex-wrap items-center justify-between gap-x-3 border-t border-shift-line2">
                  <dt className="text-shift-body">{label}</dt>
                  <dd className="m-0 min-w-0"><CopyId value={value} /></dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={copyAll} disabled={!ids.some(([, v]) => v)}><Copy size={15} /> نسخ المعرّفات</Button>
              {copiedAll && <span role="status" className="text-[13px] text-shift-ok">نُسخت</span>}
            </div>
          </div>
        )}
      </Card>

      {onb && (
        <Card title="الدفع لدى Meta">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="m-0 text-sm text-shift-ink flex flex-wrap items-center gap-2">
              {card[0] && <Tag tone={card[0]} />}
              {onb.payment_method_claimed_at && !onb.payment_method_ok && !onb.payment_blocked_at
                ? <span>قال الزبون «أضفت البطاقة» <Timestamp value={onb.payment_method_claimed_at} /> — بانتظار تأكيد شِفت</span>
                : <span className={onb.payment_blocked_at ? 'text-shift-danger font-semibold' : ''}>{card[1]}</span>}
              {onb.payment_method_ok && onb.payment_method_marked_by && <span className="text-shift-muted">— أكّدها {onb.payment_method_marked_by}</span>}
            </p>
            {onb.payment_method_ok ? (
              <button type="button" onClick={() => setCard(false)} disabled={busy} className="min-h-[40px] px-2 text-[13px] text-shift-muted hover:text-shift-danger underline">تراجَع عن التأكيد</button>
            ) : (
              <Button variant="primary" onClick={() => setCard(true)} disabled={busy}>أكّد البطاقة</Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <details>
          <summary className="cursor-pointer min-h-[40px] flex items-center font-display text-base font-semibold text-shift-ink">
            تشخيص الربط{attempts ? ` · ${attempts.length === 0 ? 'لا محاولات' : attempts.length === 1 ? 'محاولة واحدة' : `${attempts.length} محاولات`}` : ''}
          </summary>
          {!attempts ? <SkeletonRows rows={3} cols={5} /> : attempts.length === 0 ? (
            <p className="m-0 mt-2 text-sm text-shift-body">لا محاولات ربط مسجّلة لهذا المحل.</p>
          ) : (
            <ul className="m-0 mt-2 p-0 list-none">
              {attempts.map((a, i) => {
                const result = hasArabic(a.result_ar) ? a.result_ar : '—';
                return (
                  <li key={`${a.at}-${i}`} className="py-2.5 border-t border-shift-line2 text-sm text-shift-body flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Timestamp value={a.at} className="text-shift-ink" />
                    <span>· بدأها {a.started_by_ar || '—'}</span>
                    <span className={`font-semibold ${RESULT_TONE[result] || 'text-shift-ink'}`}>· {result}</span>
                    {RESULT_TAG[result] && <Tag tone={RESULT_TAG[result]} />}
                    {a.step_ar && <span>· الخطوة: {a.step_ar}</span>}
                    {a.error_ar && <span className="basis-full text-shift-danger">{a.error_ar}</span>}
                    {a.session_id && <span className="basis-full flex flex-wrap items-center gap-x-2">رمز جلسة Meta <CopyId value={a.session_id} /></span>}
                  </li>
                );
              })}
            </ul>
          )}
        </details>
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer min-h-[40px] flex items-center font-display text-base font-semibold text-shift-ink">متقدم: إدخال يدوي</summary>
          {biz && <ManualForm biz={biz} />}
        </details>
      </Card>
    </div>
  );
}
