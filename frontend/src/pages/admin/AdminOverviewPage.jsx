import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, Plus, RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { Num, SkeletonRows, relativeTime } from '../../components/shared/Primitives';
import FixButton from '../../components/admin/FixButton';
import OrphanSignups from '../../components/admin/OrphanSignups';
import { PageHeader, Card, Tag, btnClass, chipClass } from '../../components/admin/ui';
import {
  ATTENTION_EVENT, FUNNEL, attentionItem, fixFor, sortAttention, tabFor, fleetRow, eventTime, eventText, jod, dayMonth,
} from '../../components/admin/operatorView';

/**
 * «اليوم» — /admin/overview (docs/panels/spec.md, «Operator panel»).
 *
 * Each morning: which of the ten shops needs SHIFT today, whether the platform itself is healthy,
 * and where the campaign stands. The attention queue is the protagonist; the platform is one quiet
 * line above it, setup and money sit below it, and «آخر ما حصل» says what moved since yesterday.
 *
 * Internal accounts (SHIFT's own number, the -sim shops) are left out everywhere, and the footnote
 * says so, so the counts are never quietly smaller than they look.
 */

// The fix buttons are drawn small for dense tables; here each row's one action is a full tap target.
const ACTION_WRAP = 'flex-1 sm:flex-none [&>*]:w-full sm:[&>*]:w-auto [&>*]:justify-center [&>*]:min-h-[44px] sm:[&>*]:min-h-[40px] '
  + '[&>*]:px-3.5 [&>*]:rounded-[10px] [&>*]:border-shift-field [&>*]:text-[13.5px] [&>*]:font-medium [&>*]:text-shift-ink';

const SEV_FILTERS = [['all', 'الكل'], ['critical', 'عاجل'], ['warning', 'متابعة'], ['info', 'معلومة']];

/** «اثنان عاجلان», «3 عاجلة»: the urgent count in words the heading can carry. */
function urgentPhrase(n) {
  if (!n) return '';
  if (n === 1) return 'واحد عاجل';
  if (n === 2) return 'اثنان عاجلان';
  if (n <= 10) return `${n} عاجلة`;
  return `${n} عاجلًا`;
}

/** «حُدّث قبل 40 ث»: how old this screen is, ticking, with «تحديث». Inline, inside the header line. */
function FreshPill({ at, onRefresh, loading }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const secs = at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 1000)) : null;
  const text = secs === null ? '—' : secs < 60 ? `حُدّث قبل ${secs} ثانية` : `حُدّث ${relativeTime(at)}`;
  const stale = secs !== null && secs > 180;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`tabular-nums ${stale ? 'text-shift-warn font-medium' : 'text-shift-muted'}`}>{text}</span>
      <button type="button" onClick={onRefresh} disabled={loading} aria-label="تحديث"
        className="inline-flex items-center gap-1 min-h-[32px] px-1.5 rounded-lg text-shift-accent hover:text-shift-ink disabled:opacity-40">
        <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> تحديث
      </button>
    </span>
  );
}

const Dot = ({ tone }) => (
  <span aria-hidden="true" className={`w-2 h-2 rounded-full shrink-0 ${
    { ok: 'bg-shift-ok', warn: 'bg-[#DC8A03]', bad: 'bg-[#D92D20]', idle: 'bg-[#9AA6BA]' }[tone] || 'border-[1.5px] border-[#8E97A7]'}`} />
);

/** The platform in one quiet line: the AI provider, today's replies against the ceiling, self-connect. */
function PlatformLine({ platform }) {
  const p = platform || {};
  const provider = p.provider || null;
  const ceiling = Number(p.ceiling) || 0;
  const today = p.replies_today === null || p.replies_today === undefined ? null : Number(p.replies_today) || 0;
  const ratio = ceiling && today !== null ? today / ceiling : 0;
  const down = provider && !provider.ok;
  const full = ratio >= 1;

  return (
    <div role="status" aria-label="حالة المنصة"
      className={`flex flex-wrap items-center gap-x-[22px] gap-y-2 min-h-[44px] px-4 py-2 bg-white border rounded-xl text-[13.5px] text-shift-body ${
        down || full ? 'border-shift-dangerLine' : 'border-shift-line'}`}>
      {!provider ? (
        <span className="inline-flex items-center gap-[7px]"><Dot tone="unknown" /> الذكاء الاصطناعي: غير معروف</span>
      ) : provider.ok ? (
        <span className="inline-flex items-center gap-[7px]"><Dot tone="ok" /> الذكاء الاصطناعي يعمل</span>
      ) : (
        <span className="inline-flex flex-wrap items-center gap-x-[7px] text-shift-danger">
          <Tag tone="critical" />
          <b className="font-semibold">الذكاء الاصطناعي متعطّل {provider.since ? relativeTime(provider.since) : ''}</b>
          <span>· الردود تتحول لفرق المحلات</span>
        </span>
      )}
      <span className={`tabular-nums ${full ? 'text-shift-danger' : ratio >= 0.8 ? 'text-shift-warn' : ''}`}>
        ردود اليوم <b className="font-semibold text-shift-ink">{today === null ? '—' : today.toLocaleString('en-US')}</b>
        {ceiling ? <> من {ceiling.toLocaleString('en-US')}</> : null}
        {full && <> · ردود التجارب متوقفة حتى منتصف الليل</>}
      </span>
      <span>الربط الذاتي: {p.self_connect === 'invite' ? 'مفتوح بالدعوات' : p.self_connect === 'closed' ? 'مغلق' : '—'}</span>
      <Link to="/admin/settings" className="ms-auto text-[13px] text-shift-accent hover:text-shift-ink no-underline">التفاصيل</Link>
    </div>
  );
}

/** «يحتاج تدخلك»: a written tag, the shop and what is wrong, how long, and the one action. */
function AttentionQueue({ items, owners, loading, onDone, onNotice }) {
  const navigate = useNavigate();
  const [sev, setSev] = useState('all');
  const counts = useMemo(() => Object.fromEntries(
    SEV_FILTERS.map(([key]) => [key, key === 'all' ? items.length : items.filter((it) => it.severity === key).length]),
  ), [items]);
  const shown = sev === 'all' ? items : items.filter((it) => it.severity === sev);

  const open = (it) => {
    if (it.account_id) navigate(`/admin/accounts/${it.account_id}?tab=${tabFor(it)}`);
    else if (it.rule === 'orphan_connection') navigate('/admin/onboarding');
    else navigate('/admin/settings');
  };
  const urgent = urgentPhrase(counts.critical);

  return (
    <section aria-labelledby="att" className="bg-white border border-shift-line rounded-2xl px-4 sm:px-5 pt-[18px] pb-1.5">
      <div className="flex flex-wrap items-center gap-3 mb-1.5">
        <h2 id="att" className="m-0 font-display text-lg font-semibold text-shift-ink">
          يحتاج تدخلك
          {items.length > 0 && (
            <span className="text-sm font-medium text-shift-muted"> · <Num>{items.length}</Num>{urgent ? `، ${urgent}` : ''}</span>
          )}
        </h2>
        {items.length > 0 && (
          <div role="group" aria-label="تصفية" className="ms-auto flex flex-wrap gap-1">
            {SEV_FILTERS.map(([key, label]) => (
              <button key={key} type="button" onClick={() => setSev(key)} aria-pressed={sev === key ? 'true' : 'false'}
                className={chipClass(sev === key, 'rect')}>
                {label} <Num>{counts[key]}</Num>
              </button>
            ))}
          </div>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={3} cols={4} />
      ) : shown.length === 0 ? (
        // Empty, it says so in green: that is the product working.
        <div className="flex items-center gap-2.5 py-5 border-t border-shift-line2 text-shift-ok font-medium">
          <Check size={18} aria-hidden="true" />
          {items.length === 0 ? 'لا شيء يحتاجك الآن — كل الحسابات تعمل' : 'لا شيء في هذا التصنيف'}
        </div>
      ) : (
        <ul className="m-0 p-0 list-none">
          {shown.map((it, i) => (
            <li key={`${it.account_id || 'platform'}-${it.rule}-${i}`}
              onClick={() => open(it)}
              className="flex flex-wrap items-center gap-x-3.5 gap-y-2 py-3 px-1.5 -mx-1.5 border-t border-shift-line2 rounded-lg hover:bg-shift-hover cursor-pointer">
              <div className="flex-1 basis-[280px] min-w-0 flex flex-col gap-0.5">
                <span className="flex items-center gap-2 min-w-0">
                  <Tag tone={it.severity} />
                  <span className="truncate text-[14.5px] font-semibold text-shift-ink">{it.name || 'المنصة'}</span>
                </span>
                <span className="text-sm leading-relaxed text-shift-body">{it.text}</span>
              </div>
              <div className="flex items-center gap-3.5 w-full sm:w-auto">
                <span className="order-last sm:order-first text-[13px] text-shift-muted whitespace-nowrap tabular-nums"
                  title={it.since ? new Date(it.since).toLocaleString('ar-JO') : ''}>
                  {it.since ? relativeTime(it.since) : '—'}
                </span>
                <span className={ACTION_WRAP} onClick={(e) => e.stopPropagation()}>
                  {fixFor(it)
                    ? <FixButton item={it} owner={owners.get(it.account_id)} onDone={onDone} onNotice={onNotice} />
                    : it.account_id && (
                      // A rule with no fix button of its own (name_pending) still gets its one action.
                      <Link to={`/admin/accounts/${it.account_id}?tab=${tabFor(it)}`} className={btnClass('secondary', 'sm')}>افتح الحساب</Link>
                    )}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const JOINING_KEYS = FUNNEL.map(([k]) => k).filter((k) => k !== 'live' && k !== 'paused');

/** «التفعيل»: the setup funnel, each line opening «الزبائن?stage=». */
function SetupCard({ funnel }) {
  const f = funnel || {};
  const joining = JOINING_KEYS.reduce((n, k) => n + (Number(f[k]) || 0), 0);
  return (
    <Card className="flex-1 basis-80 min-w-0" title="التفعيل"
      action={<span className="text-[13px] text-shift-muted"><Num>{f.live ?? 0}</Num> يعمل · <Num>{joining}</Num> قيد التجهيز</span>}>
      <div className="flex flex-col text-sm -mt-1">
        {FUNNEL.map(([key, label]) => (
          <Link key={key} to={`/admin/accounts?stage=${key}`}
            className={`flex justify-between items-center min-h-[40px] px-1.5 -mx-1.5 rounded-lg border-t border-shift-line2 no-underline hover:bg-shift-hover ${
              (f[key] || 0) > 0 ? 'text-shift-ink' : 'text-shift-muted'}`}>
            <span>{label}</span>
            <b className="font-semibold tabular-nums">{f[key] ?? 0}</b>
          </Link>
        ))}
      </div>
    </Card>
  );
}

/** The earliest upcoming due date among the shops on screen: the end of a free month, or a renewal. */
function firstDue(rows, now = Date.now()) {
  let best = null;
  for (const r of rows) {
    if (!['trial', 'active'].includes(r.sub.status)) continue;
    const at = r.sub.status === 'trial' ? (r.sub.trial_ends_at || r.sub.next_due_at) : r.sub.next_due_at;
    const t = at ? new Date(at).getTime() : NaN;
    if (Number.isNaN(t) || t < now) continue;
    if (!best || t < best.t) best = { t, at, row: r };
  }
  return best;
}

/** «المال»: free month, not started, overdue — and when the first money is due. */
function MoneyCard({ money, rows }) {
  const m = money || {};
  const due = firstDue(rows);
  const overdue = Number(m.overdue_jod) > 0;
  const Tile = ({ value, label, bad }) => (
    <div className={`rounded-xl px-1.5 py-2.5 text-center ${bad ? 'bg-shift-dangerBg' : 'bg-shift-canvas'}`}>
      <div className={`text-xl font-semibold tabular-nums ${bad ? 'text-shift-danger' : 'text-shift-ink'}`}>{value}</div>
      <div className="text-[12.5px] text-shift-body">{label}</div>
    </div>
  );
  return (
    <Card className="flex-1 basis-80 min-w-0 flex flex-col gap-2.5" title="المال"
      action={<Link to="/admin/billing" className="text-[13px] text-shift-accent hover:text-shift-ink no-underline">الدفعات</Link>}>
      <div className="grid grid-cols-3 gap-2 -mt-1">
        <Tile value={m.trial ?? 0} label="في المجانية" />
        <Tile value={m.unstarted ?? 0} label="لم تبدأ مجانيتها" />
        <Tile value={overdue ? jod(m.overdue_jod) : 0} label="متأخر" bad={overdue} />
      </div>
      <p className="m-0 text-[13.5px] leading-relaxed text-shift-body">
        مدفوع <b className="font-semibold text-shift-ink tabular-nums">{m.paid ?? 0}</b>
        {' · '}مستحق هذا الأسبوع <b className="font-semibold text-shift-ink tabular-nums">{jod(m.due_this_week_jod ?? 0)}</b>
      </p>
      {due && (
        <p className="m-0 text-[13.5px] leading-relaxed text-shift-body">
          أول استحقاق:{' '}
          <Link to={`/admin/accounts/${due.row.id}?tab=contract`} className="font-semibold text-shift-ink hover:underline">{due.row.name}</Link>
          {due.row.sub.amount_jod ? <> · {jod(due.row.sub.amount_jod)}</> : null}
          {' · '}<bdi>{dayMonth(due.at)}</bdi>
        </p>
      )}
    </Card>
  );
}

function RecentEvents({ events }) {
  if (!events || events.length === 0) {
    return <p className="m-0 py-4 border-t border-shift-line2 text-sm text-shift-muted">لا شيء بعد.</p>;
  }
  return (
    <div className="grid grid-cols-[minmax(72px,auto)_minmax(0,1fr)] sm:grid-cols-[96px_minmax(0,1fr)] gap-x-4 text-sm">
      {events.map((e) => [
        <span key={`${e.id}-t`} className="py-2.5 border-t border-shift-line2 text-shift-muted tabular-nums whitespace-nowrap">{eventTime(e.at || e.created_at)}</span>,
        <span key={`${e.id}-x`} className="py-2.5 border-t border-shift-line2 text-shift-ink min-w-0 break-words">
          {e.business_id ? (
            <Link to={`/admin/accounts/${e.business_id}?tab=log`} className="font-semibold text-shift-ink hover:underline">{e.business_name || '—'}</Link>
          ) : <b className="font-semibold">المنصة</b>}
          <span className="text-shift-body"> · {eventText(e)}</span>
        </span>,
      ])}
    </div>
  );
}

/** Kept as an export: «الزبائن» shows the same line under its table. */
export function InternalFootnote({ data, showInternal, onToggle }) {
  if (!data) return null;
  const hidden = data.hidden_internal_count || 0;
  if (!showInternal && hidden === 0) return null;
  const hiddenText = hidden === 1 ? 'حساب داخلي مخفي (شِفت أو تجريبي)'
    : hidden === 2 ? 'حسابان داخليان مخفيان (شِفت، تجريبي)'
      : `${hidden} حسابات داخلية مخفية (شِفت والتجريبية)`;
  return (
    <p className="m-0 text-[13px] text-shift-muted flex flex-wrap items-center gap-x-2">
      <span>{showInternal ? 'تظهر الحسابات الداخلية (شِفت والتجريبية)' : hiddenText}</span>
      {onToggle && (
        <button type="button" onClick={onToggle} className="min-h-[40px] text-shift-accent hover:text-shift-ink">
          {showInternal ? 'إخفاؤها' : 'إظهارها'}
        </button>
      )}
    </p>
  );
}

function greeting(name) {
  const h = new Date().getHours();
  const hi = h < 12 ? 'صباح الخير' : 'مساء الخير';
  const first = name ? String(name).trim().split(/\s+/)[0] : '';
  return first ? `${hi} يا ${first}` : hi;
}

export default function AdminOverviewPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/overview')
      .then((res) => {
        setData(res.data); setError(null);
        // The nav badge on every page reads this count.
        window.dispatchEvent(new CustomEvent(ATTENTION_EVENT, { detail: (res.data?.attention || []).length }));
      })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل «اليوم»'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  // A quiet ops screen goes stale without anyone noticing, so it refreshes itself.
  useEffect(() => {
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [load]);

  const items = useMemo(() => sortAttention((data?.attention || []).map(attentionItem)), [data]);
  const rows = useMemo(() => (data?.accounts || []).map(fleetRow), [data]);
  const owners = useMemo(() => new Map(rows.map((r) => [r.id, r.owner])), [rows]);
  const today = new Date().toLocaleDateString('ar-JO-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div className="flex flex-col gap-4 sm:gap-5 max-w-[1400px]">
      <PageHeader title="اليوم"
        sub={<>{greeting(user?.name)} · {today} · <FreshPill at={data?.generated_at} onRefresh={load} loading={loading} /></>}>
        <Link to="/admin/accounts/new" className={`${btnClass('primary', 'md')} no-underline`}>
          <Plus size={16} aria-hidden="true" /> زبون جديد
        </Link>
      </PageHeader>

      {error && <div className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}
      {notice && (
        <div className={`flex flex-wrap items-center gap-x-3 text-[13.5px] rounded-xl px-4 py-2 border ${
          notice.tone === 'error' ? 'bg-shift-dangerBg border-shift-dangerLine text-shift-danger' : 'bg-shift-okBg border-[#BFE3CB] text-[#14532D]'}`}>
          <span className="flex-1 min-w-0">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="min-h-[36px] text-[13px] underline">إخفاء</button>
        </div>
      )}

      <PlatformLine platform={data?.platform} />

      {/* The protagonist. */}
      <AttentionQueue items={items} owners={owners} loading={loading && !data} onDone={load} onNotice={setNotice} />

      <OrphanSignups accounts={rows} onDone={load} />

      <div className="flex flex-wrap gap-4 sm:gap-5 items-start">
        <SetupCard funnel={data?.funnel} />
        <MoneyCard money={data?.money} rows={rows} />
      </div>

      <Card title="آخر ما حصل" className="!pb-1.5" action={<span className="text-[13px] text-shift-muted">من فعل ماذا، ومتى</span>}>
        {loading && !data ? <SkeletonRows rows={4} cols={3} /> : <RecentEvents events={data?.recent_events} />}
      </Card>

      <InternalFootnote data={data} showInternal={false} />
    </div>
  );
}
