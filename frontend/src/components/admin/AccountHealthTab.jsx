import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, X, Minus, ExternalLink, Eye, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { Timestamp, Ltr, Num, SkeletonRows } from '../shared/Primitives';
import ConnectWhatsApp, { adminEndpoints } from '../whatsapp/ConnectWhatsApp';
import { Card, Tag, btnClass } from './ui';
import { usageTone } from './operatorView';

/**
 * Whether this account can actually serve customers, and what is missing.
 *
 * «الخدمة الآن» is four tiles (WhatsApp, the bot, this month's replies, last week's
 * conversations) over the setup checklist, folded once it is complete; «ما تقوله Meta» sits beside
 * it. The checklist is derived on every request rather than stored, so it cannot drift from
 * reality when someone changes a token by hand. A step we genuinely cannot determine shows as a
 * dash, not a tick.
 *
 * `row` is the shop's «الزبائن» row (usage, conversations), when the overview has loaded.
 */

function Tick({ done }) {
  if (done === true) return <Check size={15} className="text-shift-ok shrink-0" aria-label="تم" />;
  if (done === false) return <X size={15} className="text-shift-danger shrink-0" aria-label="لم يتم" />;
  return <Minus size={15} className="text-shift-muted shrink-0" aria-label="غير معروف" />; // unknown — never a tick
}

const QUALITY = { GREEN: ['ok', 'جيدة'], YELLOW: ['degraded', 'متوسطة'], RED: ['down', 'منخفضة'] };
const NAME_STATUS = { APPROVED: ['ok', 'مقبول'], DECLINED: ['down', 'مرفوض'], PENDING_REVIEW: ['degraded', 'قيد المراجعة'] };
// A state's written severity, next to its words: colour never says it alone.
const STATE_TAG = { down: 'critical', degraded: 'warning' };

function Severity({ state }) {
  return STATE_TAG[state] ? <Tag tone={STATE_TAG[state]} /> : null;
}

function Tile({ label, children }) {
  return (
    <div className="bg-shift-canvas rounded-xl p-3 min-w-0">
      <div className="text-[13px] text-shift-body">{label}</div>
      <div className="mt-0.5 font-semibold text-shift-ink break-words">{children}</div>
    </div>
  );
}

function MetaRow({ label, state, children }) {
  return (
    <div className="flex items-center justify-between gap-3 min-h-[32px]">
      <span className="text-shift-body">{label}</span>
      <span className="flex items-center gap-1.5 text-left">{children}<Severity state={state} /></span>
    </div>
  );
}

export default function AccountHealthTab({ accountId, row = null, botEnabled = true }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = () => api.get(`/admin/accounts/${accountId}`)
    .then((res) => { setData(res.data); setError(null); })
    .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل حالة الحساب'));

  useEffect(() => { load(); }, [accountId]);

  // Built once per account: a new object each render would refetch the signup status.
  const esEndpoints = useMemo(() => adminEndpoints(accountId), [accountId]);
  // A connect, retry or PIN changes the checklist and Meta's panel below, so they reload with it.
  const onConnectChange = useCallback(() => { load(); }, [accountId]);

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

  if (error && !data) return <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>;
  if (!data) return <Card pad={false}><SkeletonRows rows={6} cols={2} /></Card>;

  const { account, onboarding, checklist } = data;
  const connected = Boolean(account.wa_phone_number_id);
  const done = checklist.filter((c) => c.done === true).length;
  const complete = done === checklist.length;
  const u = row?.usage || null;
  const tone = u ? usageTone(u.ai_replies_month, u.cap) : 'none';
  const meta = onboarding?.meta || null;
  const quality = meta ? (QUALITY[meta.quality_rating] || ['unknown', meta.quality_rating || 'غير معروفة']) : null;
  const name = meta ? (NAME_STATUS[meta.name_status] || ['unknown', meta.name_status || 'غير معروف']) : null;
  // A missing reading is not an outage: an empty answer from Meta must render as unknown, or we
  // invent a problem the account does not have.
  const numberState = !meta?.number_status ? 'unknown' : (meta.number_status === 'CONNECTED' ? 'ok' : 'down');

  // SHIFT's attended Embedded Signup, bound to the account in the URL (the admin mirror).
  // It is the owner who logs in to Meta: the number and the WhatsApp account stay theirs.
  const connect = (
    <Card title="ربط واتساب">
      <ConnectWhatsApp
        endpoints={esEndpoints}
        framed={false}
        onChange={onConnectChange}
        beforeConnectNote="سلّم الشاشة لصاحب المحل: يدخل بحساب فيسبوك الخاص به. لا تطلب كلمة مروره أبدًا."
      />
    </Card>
  );

  return (
    <div className="flex flex-col gap-4">
      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}
      {/* Before a number is connected, connecting it is the whole job: it leads. */}
      {!connected && connect}

      <div className="flex flex-wrap gap-4 items-start">
        <Card title="الخدمة الآن" className="flex-[2_1_480px] min-w-0">
          <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(150px,1fr))]">
            <Tile label="واتساب">
              {account.connection?.label || '—'}{account.connection?.sub && <span className="font-normal text-shift-body"> · {account.connection.sub}</span>}
              {' '}<Severity state={account.connection?.state} />
            </Tile>
            <Tile label="البوت">
              {botEnabled ? (account.agent?.label || '—') : 'متوقف · الرسائل تصل'}
              {botEnabled && account.agent?.sub && <span className="font-normal text-shift-body"> · {account.agent.sub}</span>}
              {' '}{botEnabled && <Severity state={account.agent?.state} />}
            </Tile>
            <Tile label="ردود الشهر">
              <bdi dir="ltr" className="tabular-nums">
                {u ? `${u.ai_replies_month.toLocaleString('en-US')} / ${u.cap ? u.cap.toLocaleString('en-US') : '—'}` : '—'}
              </bdi>
              {tone === 'bad' && <> <Tag tone="critical">بلغ الحد</Tag></>}
              {tone === 'warn' && <> <Tag tone="warning">قارب الحد</Tag></>}
            </Tile>
            <Tile label="محادثات آخر 7 أيام"><Num>{row?.conversations_7d ?? '—'}</Num></Tile>
            {u && u.media_today !== undefined && u.media_today !== null && (
              <Tile label="صور وصوتيات اليوم"><Num>{u.media_today}</Num></Tile>
            )}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-shift-body">
            <span>آخر رسالة واردة: <Timestamp value={account.last_inbound_at} /></span>
            <span>آخر رد صادر: <Timestamp value={account.last_outbound_at} /></span>
          </div>

          <details open={!complete} className="mt-3 border-t border-shift-line2 pt-2.5">
            <summary className="cursor-pointer min-h-[40px] flex items-center gap-2 text-sm font-medium text-shift-ink">
              {complete ? <Check size={16} className="text-shift-ok" /> : <Minus size={16} className="text-shift-muted" />}
              {complete ? 'اكتمل التفعيل' : 'خطوات التفعيل'} · <Num>{done}</Num> من <Num>{checklist.length}</Num>
            </summary>
            <ul className="m-0 mt-2 p-0 list-none grid gap-x-4 gap-y-1.5 grid-cols-[repeat(auto-fit,minmax(220px,1fr))] text-[13.5px]">
              {checklist.map((c) => (
                <li key={c.step} className="flex items-center gap-2">
                  <Tick done={c.done} />
                  <span className={c.done === true ? 'text-shift-body' : 'text-shift-ink'}>{c.label}</span>
                </li>
              ))}
            </ul>
          </details>

          {/* The wording comes from the server (config/metaNotices.js), the one copy every panel
              shares — the dated copy that was here read as a missed deadline once its date passed. */}
          {onboarding?.payment_notice && (
            <div className={`mt-3 rounded-xl p-3 border ${onboarding.payment_notice.state === 'blocked' ? 'bg-shift-dangerBg border-shift-dangerLine' : 'bg-shift-warnBg border-[#EBD3A8]'}`}>
              <p className={`m-0 text-sm font-semibold flex items-center gap-2 ${onboarding.payment_notice.state === 'blocked' ? 'text-shift-danger' : 'text-shift-warn'}`}>
                <Tag tone={onboarding.payment_notice.state === 'blocked' ? 'critical' : 'warning'} /> {onboarding.payment_notice.short}
              </p>
              <p className="m-0 mt-1 text-[13px] text-shift-body">{onboarding.payment_notice.long}</p>
              {onboarding.payment_method_claimed_at && onboarding.payment_notice.state === 'claimed' && (
                <p className="m-0 mt-1 text-[12.5px] text-shift-warn">ضغط الزبون «أضفت البطاقة» <Timestamp value={onboarding.payment_method_claimed_at} /></p>
              )}
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <a href={onboarding.payment_notice.whatsapp_manager_url} target="_blank" rel="noopener noreferrer"
                  className={`${btnClass('secondary', 'sm')} !min-h-[40px] no-underline`}>
                  WhatsApp Manager <ExternalLink size={13} />
                </a>
                {!onboarding.payment_method_ok && (
                  <button type="button" onClick={() => setPaymentMethod(true)} disabled={busy} className={`${btnClass('primary', 'sm')} !min-h-[40px]`}>
                    رأيتها مضافة — أكّد
                  </button>
                )}
              </div>
            </div>
          )}
          {onboarding?.payment_method_ok && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[13px] text-shift-body">
              <p className="m-0">
                الدفع لدى Meta: مؤكَّد
                {onboarding.payment_method_marked_by && <span className="text-shift-muted"> — أكّده {onboarding.payment_method_marked_by}</span>}
                {onboarding.payment_method_marked_at && <> <Timestamp value={onboarding.payment_method_marked_at} /></>}
              </p>
              <button type="button" onClick={() => setPaymentMethod(false)} disabled={busy}
                className="min-h-[40px] px-2 text-[12.5px] text-shift-muted hover:text-shift-danger underline">
                تراجَع
              </button>
            </div>
          )}
          {onboarding?.last_error && (
            <div className="mt-3 rounded-xl p-3 bg-shift-dangerBg border border-shift-dangerLine">
              <p className="m-0 text-sm text-shift-danger font-semibold flex items-center gap-2"><Tag tone="critical" /> آخر خطأ في التوصيل</p>
              <p className="m-0 mt-1 text-[13px] text-shift-body">{onboarding.last_error}</p>
              <Timestamp value={onboarding.last_error_at} className="text-[12px] text-shift-muted" />
            </div>
          )}
        </Card>

        {meta && (
          <Card title="ما تقوله Meta" className="flex-[1_1_280px] min-w-0"
            action={(
              <button type="button" onClick={refreshMeta} disabled={busy} className={`${btnClass('secondary', 'sm')} !min-h-[40px]`}>
                <RefreshCw size={13} /> {busy ? 'جارٍ…' : 'تحديث الحالة'}
              </button>
            )}>
            {!meta.checked_at ? (
              <p className="m-0 text-sm text-shift-body">لم نسأل Meta بعد عن هذا الحساب.</p>
            ) : (
              <div className="flex flex-col gap-1 text-sm text-shift-ink">
                <MetaRow label="حالة الرقم" state={numberState}><Ltr>{meta.number_status || 'غير معروف'}</Ltr></MetaRow>
                <MetaRow label="الجودة" state={quality[0]}>{quality[1]}</MetaRow>
                <MetaRow label="الاسم الظاهر" state={name[0]}>{name[1]}</MetaRow>
                <MetaRow label="سعة الإرسال"><Ltr>{meta.throughput || '—'}</Ltr></MetaRow>
                <MetaRow label="مراجعة الحساب"><Ltr>{meta.review_status || '—'}</Ltr></MetaRow>
                <p className="m-0 mt-1 text-[13px] text-shift-muted">آخر فحص <Timestamp value={meta.checked_at} /></p>
              </div>
            )}
          </Card>
        )}
      </div>

      {connected && connect}

      {/* The ids, copyable, moved to «واتساب وMeta». */}
      <Card title="فحص المحادثات">
        <p className="m-0 mb-3 text-[13.5px] text-shift-body">
          لمعاينة ما قاله البوت فعليًا عند شكوى من رد خاطئ. قراءة فقط، وكل دخول يُسجَّل باسمك.
        </p>
        <Link to={`/admin/accounts/${accountId}/conversations`} className={`${btnClass('secondary', 'md')} no-underline`}>
          <Eye size={15} /> فحص المحادثات (مُسجّل)
        </Link>
      </Card>

      {/* Knowledge and «جرّب البوت» live on «المعرفة» now, with the menu and services. */}
    </div>
  );
}
