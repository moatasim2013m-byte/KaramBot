import React, { useCallback, useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, AlertTriangle, XCircle, Loader2, ExternalLink, MessageCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import SetupGuide from '../components/whatsapp/SetupGuide';
import KnowledgeGaps from '../components/whatsapp/KnowledgeGaps';
import { ConnectInline } from '../components/whatsapp/OwnerSetupActions';
import ReplyMeter from '../components/whatsapp/ReplyMeter';
import {
  statusLine, planBanner, graceDaysOf, isConnected, ownerCanConnect, shiftWaLink, helpText,
} from '../components/whatsapp/panelView';

/**
 * «الرئيسية» — three questions, in this order: is the bot working, what happened today, and what
 * did it not know?
 *
 * Both walkthrough personas signed in to four zeros and could not tell «not connected yet» from «a
 * quiet day» from «cut off». So the top is one honest line (panelView.statusLine) with the one
 * button that fixes it, the numbers only appear once there is a number to count for, and the
 * questions the bot gave up on sit right under them with a one-tap fix.
 */

const MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';

const LINE_TONE = {
  good: { box: 'border-shift-okBg bg-shift-okBg', text: 'text-[#116B32]', Icon: CheckCircle2 },
  warn: { box: 'border-[#F1D29A] bg-shift-warnBg', text: 'text-shift-warn', Icon: AlertTriangle },
  bad: { box: 'border-shift-dangerLine bg-shift-dangerBg', text: 'text-shift-danger', Icon: XCircle },
};

const BANNER_TONE = {
  info: 'bg-white border-shift-selLine text-shift-selText',
  good: 'bg-shift-okBg border-shift-okBg text-[#116B32]',
  warn: 'bg-shift-warnBg border-[#F1D29A] text-shift-warn',
  bad: 'bg-shift-dangerBg border-shift-dangerLine text-shift-danger',
};

function Card({ title, children, action }) {
  return (
    <section className="rounded-2xl border border-shift-line bg-white">
      <header className="flex items-center justify-between px-4 h-11 border-b border-shift-line2">
        <h3 className="font-display text-[15px] font-semibold text-shift-ink">{title}</h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

/** One of the day's tiles; `warn` (chats waiting) turns it amber so the eye lands on it first. */
function Figure({ value, label, warn = false }) {
  return (
    <div className={`min-w-0 rounded-xl px-3 py-2.5 ${warn ? 'bg-shift-warnBg' : 'bg-shift-canvas'}`}>
      <div className={`font-display text-[24px] leading-tight font-bold tabular-nums ${warn ? 'text-shift-warn' : 'text-shift-ink'}`}>{value ?? '—'}</div>
      <div className={`text-[12px] mt-0.5 ${warn ? 'text-shift-warn' : 'text-shift-muted'}`}>{label}</div>
    </div>
  );
}

/** Seven bars, no axis: the shape of the week is the whole message. */
function Sparkline({ values }) {
  if (!values || values.length === 0) return null;
  const max = Math.max(...values, 1);
  return (
    <div className="flex items-end gap-1 h-8" aria-hidden="true">
      {values.map((v, i) => (
        <div key={i} className="flex-1 bg-shift-selLine rounded-sm" style={{ height: `${Math.max(6, (v / max) * 100)}%` }} />
      ))}
    </div>
  );
}

function StatusLine({ status, role, businessId, onReload, who }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const line = statusLine(status, { role });
  if (!line) return null;
  const tone = LINE_TONE[line.tone] || LINE_TONE.warn;

  // The owner's own switch, through the same PATCH the «البوت» page uses: the server records
  // bot_resumed with the owner as the actor.
  const resume = async () => {
    setBusy(true); setError(null);
    try {
      await api.patch(`/businesses/${businessId}`, { ai_config: { enabled: true } });
      onReload();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تشغيل البوت، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`rounded-2xl border px-4 py-3 ${tone.box}`}>
      <div className="flex items-start gap-2.5">
        <tone.Icon size={18} className={`mt-0.5 shrink-0 ${tone.text}`} />
        <p className={`flex-1 text-[15px] font-semibold leading-relaxed ${tone.text}`}>{line.text}</p>
      </div>
      <div className="mr-7">
        {line.action === 'connect' && <ConnectInline onDone={onReload} />}
        {line.action === 'reconnect' && <ConnectInline onDone={onReload} label="أعد الربط" />}
        {line.action === 'resume' && (
          <button type="button" onClick={resume} disabled={busy}
            className="inline-flex items-center gap-1.5 mt-2 h-10 px-4 rounded-md bg-shift-ok text-white text-[14px] font-medium disabled:opacity-50">
            {busy && <Loader2 size={14} className="animate-spin" />} شغّل البوت
          </button>
        )}
        {line.action === 'manager' && (
          <a href={MANAGER_URL} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-[13px] font-medium underline underline-offset-2 text-shift-danger">
            افتح WhatsApp Manager <ExternalLink size={12} />
          </a>
        )}
        {line.action === 'billing' && (
          <Link to="/billing" className="inline-flex items-center gap-1 mt-2 text-[13px] font-medium underline underline-offset-2">
            الاشتراك وطريقة الدفع <ArrowLeft size={12} />
          </Link>
        )}
        {line.action === 'inbox' && (
          <Link to="/inbox" className="inline-flex items-center gap-1 mt-2 text-[13px] font-medium underline underline-offset-2">
            افتح المحادثات <ArrowLeft size={12} />
          </Link>
        )}
        {line.action === 'contact' && (
          <a href={shiftWaLink(`${who}، بخصوص: ${line.text}`)} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-2 text-[13px] font-medium underline underline-offset-2">
            راسل شِفت على واتساب <ExternalLink size={12} />
          </a>
        )}
        {error && <p className="mt-1 text-[12px] text-shift-danger">{error}</p>}
      </div>
    </section>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [week, setWeek] = useState(null);
  const [todayExtra, setTodayExtra] = useState(null);

  const role = user?.role;
  const bizType = user?.business_type;

  const load = useCallback(() => {
    api.get('/whatsapp/status')
      .then((res) => { setStatus(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر قراءة حالة الحساب'));
  }, []);

  useEffect(() => { if (role !== 'staff') load(); }, [load, role]);

  // The sparkline and the type's own «طلبات اليوم» / «مواعيد اليوم»: extras, so a failure leaves
  // them out rather than the page.
  useEffect(() => {
    if (role === 'staff') return;
    api.get('/reports/summary', { params: { days: 7 } })
      .then((res) => setWeek((res.data.per_day || []).map((d) => Number(d.bot_replies) || 0)))
      .catch(() => setWeek(null));
    if (bizType === 'restaurant') {
      api.get('/orders/today')
        .then((res) => setTodayExtra({ label: 'طلبات اليوم', value: (res.data.orders || []).length, to: '/orders' }))
        .catch(() => {});
    } else if (bizType === 'clinic') {
      api.get('/clinic/appointments')
        .then((res) => {
          const today = new Date().toDateString();
          const n = (res.data.appointments || []).filter((a) => a.scheduled_at && new Date(a.scheduled_at).toDateString() === today && a.status !== 'cancelled').length;
          setTodayExtra({ label: 'مواعيد اليوم', value: n, to: '/orders' });
        })
        .catch(() => {});
    }
  }, [role, bizType]);

  // Staff answer chats; their home is the inbox (spec «الرئيسية»: staff go to /inbox).
  if (role === 'staff') return <Navigate to="/inbox" replace />;

  if (error) return <div className="rounded-xl border border-shift-dangerLine bg-shift-dangerBg px-4 py-3 text-sm text-shift-danger">{error}</div>;
  if (!status) {
    return (
      <div className="space-y-3 animate-pulse">
        <div className="h-14 rounded-xl bg-white border border-shift-line" />
        <div className="h-28 rounded-xl bg-white border border-shift-line" />
      </div>
    );
  }

  const owner = role === 'business_owner' || role === 'platform_admin';
  const connected = isConnected(status);
  // The same grace days «الاشتراك» reads (status.late_policy), so the two banners agree.
  const banner = planBanner(status.plan, { graceDays: graceDaysOf(status.late_policy) });
  const today = status.today || null;
  const usage = status.usage || null;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      {banner && (
        owner ? (
          <Link to="/billing" className={`flex items-center justify-between gap-2 rounded-2xl border px-4 py-3 text-[13px] font-semibold ${BANNER_TONE[banner.tone]}`}>
            <span>{banner.text}</span>
            <ArrowLeft size={14} className="shrink-0" />
          </Link>
        ) : (
          <div className={`rounded-2xl border px-4 py-3 text-[13px] font-semibold ${BANNER_TONE[banner.tone]}`}>{banner.text}</div>
        )
      )}

      <StatusLine status={status} role={role} businessId={user?.business_id} onReload={load} who={helpText(user)} />

      {/* Disappears on its own once every step is done. */}
      {owner && <SetupGuide setup={status.setup || null} onReload={load} />}

      {connected ? (
        <>
          <Card title="اليوم">
            <div className={`grid gap-2 ${todayExtra ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3'}`}>
              <Figure value={today?.inbound} label="زبائن راسلوك" />
              <Figure value={today?.ai_replies} label="ردّ عليهم البوت" />
              <Figure value={today?.waiting} label="بانتظارك" warn={today?.waiting > 0} />
              {todayExtra && <Figure value={todayExtra.value} label={todayExtra.label} />}
            </div>
            {today?.waiting > 0 && (
              <Link to="/inbox" className="mt-3 flex items-center justify-center gap-1.5 h-11 rounded-xl bg-shift-ink text-white text-[14px] font-semibold">
                افتح المحادثات بانتظارك <ArrowLeft size={14} />
              </Link>
            )}
          </Card>

          {usage && (
            <Card title="هذا الشهر">
              <ReplyMeter usage={usage} plan={status.plan} />
              {week && week.length > 0 && (
                <div className="mt-3">
                  <Sparkline values={week} />
                  <p className="mt-1 text-[11px] text-shift-muted">ردود البوت في آخر 7 أيام</p>
                </div>
              )}
            </Card>
          )}
        </>
      ) : (
        // Not connected: no zeros. The one thing that makes the numbers mean anything is the link.
        <Card title="بعد ربط واتساب">
          <p className="text-[13px] text-shift-body leading-relaxed">
            هنا ترى كل يوم كم زبونًا راسلك، وكم ردّ عليهم البوت، ومن ينتظر ردك أنت.
          </p>
          {owner && ownerCanConnect(status) && statusLine(status, { role }).action !== 'connect' && (
            <ConnectInline onDone={load} />
          )}
        </Card>
      )}

      <KnowledgeGaps limit={3} onChange={load} />

      <a href={shiftWaLink(helpText(user))} target="_blank" rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 py-3 text-[13px] text-shift-body">
        <MessageCircle size={14} className="text-shift-ok" /> تحتاج مساعدة؟ راسل شِفت
      </a>
    </div>
  );
}
