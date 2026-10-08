import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Num, SkeletonRows, StatusDot, relativeTime } from '../../components/shared/Primitives';
import FixButton from '../../components/admin/FixButton';
import OrphanSignups from '../../components/admin/OrphanSignups';
import {
  ATTENTION_EVENT, FUNNEL, attentionItem, sortAttention, tabFor, fleetRow, eventTime, eventText, jod,
} from '../../components/admin/operatorView';

/**
 * «اليوم» — /admin/overview (docs/panels/spec.md, «Operator panel»).
 *
 * Each morning: which of the ten shops needs SHIFT today, whether the platform itself is healthy,
 * and where the campaign stands. The attention queue is the protagonist; everything above it is
 * one line of context, and below it «آخر ما حصل» says what moved since yesterday.
 *
 * Internal accounts (SHIFT's own number, the -sim shops) are left out everywhere, and the footnote
 * says so, so the counts are never quietly smaller than they look.
 */

const DOT = { critical: 'down', warning: 'degraded', info: 'idle' };

/** «حُدّث قبل 40 ث»: how old this screen is, ticking, with «تحديث». */
function FreshPill({ at, onRefresh, loading }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 5000);
    return () => clearInterval(t);
  }, []);
  const secs = at ? Math.max(0, Math.floor((Date.now() - new Date(at).getTime()) / 1000)) : null;
  const text = secs === null ? '—' : secs < 60 ? `حُدّث قبل ${secs} ث` : `حُدّث ${relativeTime(at)}`;
  const stale = secs !== null && secs > 180;
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[12px] tabular-nums ${stale ? 'bg-amber-50 text-amber-800' : 'bg-gray-100 text-gray-600'}`}>
        <StatusDot state={stale ? 'degraded' : 'ok'} /> {text}
      </span>
      <button type="button" onClick={onRefresh} disabled={loading}
        className="inline-flex items-center gap-1 h-7 px-2.5 rounded-md border border-gray-200 bg-white text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-40">
        <RefreshCw size={12} className={loading ? 'animate-spin' : ''} /> تحديث
      </button>
    </div>
  );
}

function Cell({ children }) {
  return <div className="flex-1 min-w-[220px] px-4 py-3">{children}</div>;
}

/** Row 1: the AI provider, today's replies against the platform ceiling, and self-connect. */
function PlatformStrip({ platform }) {
  const p = platform || {};
  const provider = p.provider || null;
  const ceiling = Number(p.ceiling) || 0;
  const today = Number(p.replies_today) || 0;
  const ratio = ceiling ? today / ceiling : 0;
  const tone = ratio >= 1 ? 'bad' : ratio >= 0.8 ? 'warn' : 'ok';
  const bar = { ok: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' }[tone];

  return (
    <div className="flex flex-wrap divide-x divide-x-reverse divide-gray-100 bg-white border border-gray-200 rounded-lg">
      <Cell>
        {!provider ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-gray-500"><StatusDot state="unknown" /> الذكاء الاصطناعي: غير معروف</span>
        ) : provider.ok ? (
          <span className="inline-flex items-center gap-2 text-[13px] text-gray-800"><StatusDot state="ok" /> الذكاء الاصطناعي: يعمل</span>
        ) : (
          <div className="text-[13px] text-red-700">
            <span className="inline-flex items-center gap-2 font-medium">
              <StatusDot state="down" /> متعطّل {provider.since ? relativeTime(provider.since) : ''}
            </span>
            <p className="text-[12px] text-red-600 mt-0.5">الردود تتحول لفرق المحلات</p>
          </div>
        )}
      </Cell>
      <Cell>
        <div className="text-[13px] text-gray-800">
          ردود البوت اليوم: <Num className="font-semibold">{today.toLocaleString('en-US')}</Num>
          {ceiling ? <> من سقف <Num>{ceiling.toLocaleString('en-US')}</Num></> : null}
        </div>
        {ceiling > 0 && (
          <div className="mt-1.5 h-1.5 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
          </div>
        )}
        {tone === 'bad' && <p className="text-[12px] text-red-700 mt-1">ردود التجارب متوقفة حتى منتصف الليل</p>}
      </Cell>
      <Cell>
        <Link to="/admin/settings" className="inline-flex items-center gap-2 text-[13px] text-gray-800 hover:underline">
          <StatusDot state={p.self_connect === 'invite' ? 'ok' : 'idle'} />
          الربط الذاتي: {p.self_connect === 'invite' ? 'مفتوح بالدعوات' : p.self_connect === 'closed' ? 'مغلق' : '—'}
        </Link>
      </Cell>
    </div>
  );
}

/** Row 2: «مسار الانضمام», each count opening «الزبائن?stage=», and the money line. */
function FunnelAndMoney({ funnel, money }) {
  const f = funnel || {};
  const m = money || {};
  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[12px] text-gray-500 ml-1">مسار الانضمام</span>
        {FUNNEL.map(([key, label]) => (
          <Link key={key} to={`/admin/accounts?stage=${key}`}
            className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] hover:border-gray-400 ${
              (f[key] || 0) > 0 ? 'border-gray-300 text-gray-800' : 'border-gray-100 text-gray-400'}`}>
            {label} <Num className="font-semibold">{f[key] ?? 0}</Num>
          </Link>
        ))}
      </div>
      <p className="text-[12px] text-gray-600">
        <Link to="/admin/billing" className="hover:underline">
          فترة مجانية <Num className="font-semibold text-gray-800">{m.trial ?? 0}</Num>
          {' · '}مدفوع <Num className="font-semibold text-gray-800">{m.paid ?? 0}</Num>
          {m.unstarted ? <>{' · '}لم يبدأ <Num className="font-semibold text-gray-800">{m.unstarted}</Num></> : null}
          {' · '}مستحق هذا الأسبوع <Num className="font-semibold text-gray-800">{jod(m.due_this_week_jod ?? 0)}</Num>
          {' · '}متأخر <Num className={`font-semibold ${Number(m.overdue_jod) > 0 ? 'text-red-700' : 'text-gray-800'}`}>{jod(m.overdue_jod ?? 0)}</Num>
        </Link>
      </p>
    </div>
  );
}

function AttentionQueue({ items, owners, loading, onDone, onNotice }) {
  const navigate = useNavigate();
  if (loading) return <SkeletonRows rows={3} cols={4} />;
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center gap-2 py-8 text-[14px] font-medium text-emerald-700 bg-emerald-50/60">
        ✓ لا شيء يحتاجك الآن — كل الحسابات تعمل
      </div>
    );
  }
  const open = (it) => {
    if (it.account_id) navigate(`/admin/accounts/${it.account_id}?tab=${tabFor(it)}`);
    else if (it.rule === 'orphan_connection') navigate('/admin/onboarding');
    else navigate('/admin/settings');
  };
  return (
    <ul className="divide-y divide-gray-100">
      {items.map((it, i) => (
        <li key={`${it.account_id || 'platform'}-${it.rule}-${i}`}
          onClick={() => open(it)}
          className="flex items-center gap-3 px-4 min-h-[36px] py-1 hover:bg-gray-50 cursor-pointer">
          <StatusDot state={DOT[it.severity]} title={it.severity === 'critical' ? 'حرج' : it.severity === 'warning' ? 'تنبيه' : 'للعلم'} />
          <span className="w-36 shrink-0 truncate text-[13px] font-medium text-gray-900">{it.name || 'المنصة'}</span>
          <span className="flex-1 min-w-0 truncate text-[13px] text-gray-700" title={it.text}>{it.text}</span>
          <span className="hidden sm:inline w-20 shrink-0 text-[12px] text-gray-400 tabular-nums" title={it.since ? new Date(it.since).toLocaleString('ar-JO') : ''}>
            {it.since ? relativeTime(it.since) : '—'}
          </span>
          <span className="shrink-0">
            <FixButton item={it} owner={owners.get(it.account_id)} onDone={onDone} onNotice={onNotice} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function RecentEvents({ events }) {
  if (!events || events.length === 0) {
    return <p className="px-4 py-4 text-[13px] text-gray-400">لا شيء بعد.</p>;
  }
  return (
    <ul className="divide-y divide-gray-50">
      {events.map((e) => (
        <li key={e.id} className="flex items-baseline gap-2 px-4 py-2 text-[13px]">
          <span className="w-24 shrink-0 text-[12px] text-gray-400 tabular-nums">{eventTime(e.at || e.created_at)}</span>
          {e.business_id ? (
            <Link to={`/admin/accounts/${e.business_id}?tab=log`} className="shrink-0 font-medium text-gray-800 hover:underline">{e.business_name || '—'}</Link>
          ) : <span className="shrink-0 text-gray-500">المنصة</span>}
          <span className="text-gray-600 min-w-0">· {eventText(e)}</span>
        </li>
      ))}
    </ul>
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
    <p className="text-[11px] text-gray-400 px-1 flex items-center gap-2">
      <span>{showInternal ? 'تظهر الحسابات الداخلية (شِفت والتجريبية)' : hiddenText}</span>
      {onToggle && (
        <button type="button" onClick={onToggle} className="underline underline-offset-2 hover:text-gray-700">
          {showInternal ? 'إخفاؤها' : 'إظهارها'}
        </button>
      )}
    </p>
  );
}

export default function AdminOverviewPage() {
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

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-lg font-bold text-gray-900">اليوم</h1>
        <FreshPill at={data?.generated_at} onRefresh={load} loading={loading} />
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {notice && (
        <div className={`text-[13px] rounded-lg px-4 py-2.5 border ${notice.tone === 'error' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
          {notice.text}
          <button type="button" onClick={() => setNotice(null)} className="mr-3 text-[12px] underline">إخفاء</button>
        </div>
      )}

      <PlatformStrip platform={data?.platform} />
      <FunnelAndMoney funnel={data?.funnel} money={data?.money} />

      {/* The protagonist. Empty, it says so in green: that is the product working. */}
      <Panel title={`يحتاج انتباهك${items.length ? ` · ${items.length}` : ''}`}>
        <AttentionQueue items={items} owners={owners} loading={loading && !data} onDone={load} onNotice={setNotice} />
      </Panel>

      <OrphanSignups accounts={rows} onDone={load} />

      <Panel title="آخر ما حصل">
        {loading && !data ? <SkeletonRows rows={4} cols={3} /> : <RecentEvents events={data?.recent_events} />}
      </Panel>

      <InternalFootnote data={data} showInternal={false} />
    </div>
  );
}
