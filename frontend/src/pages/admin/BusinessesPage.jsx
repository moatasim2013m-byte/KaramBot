import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, Building2, MessageCircle, ArrowUpDown, ArrowUp, ArrowDown, X } from 'lucide-react';
import api from '../../utils/api';
import {
  Panel, StateCell, StatusDot, Ltr, Num, Freshness, SkeletonRows, EmptyState, relativeTime,
} from '../../components/shared/Primitives';
import { InternalFootnote } from './AdminOverviewPage';
import {
  FLEET_FILTERS, STAGE_TONE, attentionItem, fleetRow, matchesFilter, matchesSearch, sortRows,
  ownerLoginLabel, usageTone, waLine, waLink, worstByAccount, stageLabel, stageMatches,
} from '../../components/admin/operatorView';

/**
 * «الزبائن» — /admin/accounts (?stage=, ?filter=), every shop on one sortable line.
 *
 * Built from the same /admin/overview payload as «اليوم», so the two screens can never disagree
 * about a shop. Columns are docs/panels/spec.md's fleet_table_columns, each sortable in the
 * browser (fine at ten; server paging waits for fifty). A row with open attention items is
 * tinted. On a phone each row becomes a card. There are deliberately no bulk changes to live bots.
 */

const TONE_TEXT = { ok: 'text-gray-700', warn: 'text-amber-700', bad: 'text-red-700', muted: 'text-gray-400' };
const TINT = { critical: 'bg-red-50/60', warning: 'bg-amber-50/60' };
const THREE_DAYS_MS = 3 * 86400000;

const COLUMNS = [
  ['name', 'الزبون'],
  ['stage', 'المرحلة'],
  ['wa', 'واتساب'],
  ['bot', 'البوت'],
  ['usage', 'ردود الشهر'],
  ['conversations_7d', 'محادثات 7 أيام'],
  ['subscription', 'الاشتراك'],
  ['owner', 'صاحب المحل'],
  ['last_activity', 'آخر نشاط'],
];

function StageChip({ stage }) {
  return (
    <span className={`inline-flex items-center h-6 px-2 rounded-full text-[11px] font-medium whitespace-nowrap ${STAGE_TONE[stage] || 'bg-gray-100 text-gray-700'}`}>
      {stageLabel(stage)}
    </span>
  );
}

function UsageCell({ usage }) {
  if (!usage || !usage.cap) return <span className="text-gray-300">—</span>;
  const tone = usageTone(usage.ai_replies_month, usage.cap);
  const ratio = usage.ai_replies_month / usage.cap;
  const bar = { ok: 'bg-gray-400', warn: 'bg-amber-500', bad: 'bg-red-500' }[tone];
  return (
    <div className="min-w-[96px]">
      <span dir="ltr" className={`tabular-nums text-[12px] ${TONE_TEXT[tone]}`}>
        {usage.ai_replies_month.toLocaleString('en-US')} / {usage.cap.toLocaleString('en-US')}
      </span>
      {tone === 'bad' && <span className="text-[11px] text-red-700 mr-1">وصل الحد</span>}
      <div className="mt-1 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${Math.min(100, Math.round(ratio * 100))}%` }} />
      </div>
    </div>
  );
}

function OwnerCell({ row }) {
  const o = row.owner;
  if (!o) return <span className="text-gray-300">—</span>;
  const login = ownerLoginLabel(o);
  const href = waLink(o.phone, waLine(null, row.name, o.first_name));
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <span className="text-gray-800">{o.first_name || '—'}</span>
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          className="text-emerald-600 hover:text-emerald-800" title="راسله على واتساب">
          <MessageCircle size={14} />
        </a>
      )}
      <span className={`text-[11px] ${TONE_TEXT[login.tone]}`}>{login.text}</span>
    </span>
  );
}

function LastActivity({ row }) {
  if (!row.last_activity) return <span className="text-gray-300">—</span>;
  // Three silent days on a live shop is worth a look before it is worth an alert.
  const quiet = row.stage === 'live' && Date.now() - new Date(row.last_activity).getTime() > THREE_DAYS_MS;
  return (
    <span className={quiet ? 'text-amber-700' : 'text-gray-500'} title={new Date(row.last_activity).toLocaleString('ar-JO')}>
      {relativeTime(row.last_activity)}
    </span>
  );
}

function SortHead({ id, label, sort, onSort }) {
  const active = sort.key === id;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <th className="text-right font-medium px-3 h-9 whitespace-nowrap">
      <button type="button" onClick={() => onSort(id)}
        className={`inline-flex items-center gap-1 hover:text-gray-800 ${active ? 'text-gray-800' : ''}`}>
        {label} <Icon size={11} className={active ? '' : 'text-gray-300'} />
      </button>
    </th>
  );
}

/** A phone's view of one row: name, stage chip, the two status dots and the free-month days. */
function RowCard({ row, tint }) {
  return (
    <Link to={`/admin/accounts/${row.id}`} className={`block px-4 py-3 ${TINT[tint] || ''}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[14px] text-gray-900 truncate">{row.name}</span>
        <StageChip stage={row.stage} />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] text-gray-600">
        <span className="inline-flex items-center gap-1.5"><StatusDot state={row.wa.state} /> {row.wa.label}</span>
        <span className="inline-flex items-center gap-1.5"><StatusDot state={row.bot.state} /> {row.bot.label}</span>
        <span className={TONE_TEXT[row.sub.tone]}>{row.sub.label}</span>
      </div>
    </Link>
  );
}

export default function BusinessesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  // Same default as «اليوم»: SHIFT's own row and the -sim shops only when asked for.
  const [showInternal, setShowInternal] = useState(false);

  const filter = params.get('filter') || 'all';
  const stage = params.get('stage') || null;

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/overview', { params: showInternal ? { include_internal: 1 } : {} })
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الزبائن'))
      .finally(() => setLoading(false));
  }, [showInternal]);

  useEffect(() => { load(); }, [load]);

  const all = useMemo(() => (data?.accounts || []).map(fleetRow), [data]);
  const worst = useMemo(() => worstByAccount((data?.attention || []).map(attentionItem)), [data]);
  const attentionIds = useMemo(() => new Set(worst.keys()), [worst]);

  const counts = useMemo(() => Object.fromEntries(
    FLEET_FILTERS.map(([key]) => [key, all.filter((r) => matchesFilter(r, key, attentionIds)).length]),
  ), [all, attentionIds]);

  const rows = useMemo(() => {
    const shown = all.filter((r) => stageMatches(r.stage, stage)
      && matchesFilter(r, filter, attentionIds)
      && matchesSearch(r, q));
    return sort.key ? sortRows(shown, sort.key, sort.dir) : shown;
  }, [all, stage, filter, attentionIds, q, sort]);

  const setFilter = (key) => {
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('filter'); else next.set('filter', key);
    next.delete('stage');
    setParams(next, { replace: true });
  };
  const clearStage = () => {
    const next = new URLSearchParams(params);
    next.delete('stage');
    setParams(next, { replace: true });
  };
  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));

  return (
    <div className="space-y-4 max-w-[1500px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">الزبائن</h1>
          <p className="text-xs text-gray-500 mt-0.5">كل محل في سطر: المرحلة، الحالة، الاستهلاك، الاشتراك وصاحب المحل</p>
        </div>
        <div className="flex items-center gap-3">
          <Freshness at={data?.generated_at} onRefresh={load} loading={loading} />
          <button type="button" onClick={() => navigate('/admin/accounts/new')}
            className="flex items-center gap-1.5 bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800">
            <Plus size={15} /> زبون جديد
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative w-full sm:w-auto">
          <Search size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)}
            placeholder="ابحث بالاسم أو الموبايل أو صاحب المحل"
            className="h-8 w-full sm:w-72 pr-8 pl-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400" />
        </div>
        {FLEET_FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`h-8 px-3 rounded-md text-[12px] transition-colors ${
              filter === key && !stage ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}>
            {label} (<Num>{counts[key] ?? 0}</Num>)
          </button>
        ))}
        {stage && (
          <span className="inline-flex items-center gap-1 h-8 px-3 rounded-md bg-gray-900 text-white text-[12px]">
            المرحلة: {stageLabel(stage)}
            <button type="button" onClick={clearStage} aria-label="إزالة" className="mr-1 text-gray-300 hover:text-white"><X size={12} /></button>
          </span>
        )}
        <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-600 mr-auto">
          <input type="checkbox" checked={showInternal} onChange={(e) => setShowInternal(e.target.checked)} />
          إظهار الحسابات الداخلية
        </label>
      </div>

      <Panel>
        {loading && !data ? (
          <SkeletonRows rows={6} cols={6} />
        ) : rows.length === 0 ? (
          <EmptyState icon={Building2} tone="neutral"
            title={all.length === 0 ? 'لا يوجد زبائن بعد — ابدأ بـ «زبون جديد»' : 'لا نتائج مطابقة'}
            hint={all.length === 0 ? undefined : 'جرّب بحثًا أو تصفية أخرى'} />
        ) : (
          <>
            <ul className="md:hidden divide-y divide-gray-100">
              {rows.map((r) => <li key={r.id}><RowCard row={r} tint={worst.get(r.id)} /></li>)}
            </ul>
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                    {COLUMNS.map(([id, label]) => <SortHead key={id} id={id} label={label} sort={sort} onSort={onSort} />)}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map((r) => (
                    <tr key={r.id} onClick={() => navigate(`/admin/accounts/${r.id}`)}
                      className={`cursor-pointer hover:bg-gray-50 ${TINT[worst.get(r.id)] || ''}`}>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        <Link to={`/admin/accounts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium text-gray-900 hover:underline">{r.name}</Link>
                        {showInternal && r.is_internal && <span className="mr-2 text-[10px] text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">داخلي</span>}
                        <div className="text-[11px] text-gray-400">
                          {[r.sector_ar, r.city].filter(Boolean).join(' · ')}
                          {r.display_phone && <> · <Ltr>{r.display_phone}</Ltr></>}
                        </div>
                      </td>
                      <td className="px-3 h-9"><StageChip stage={r.stage} /></td>
                      <td className="px-3 h-9 whitespace-nowrap"><StateCell state={r.wa.state} label={r.wa.label} /></td>
                      <td className="px-3 h-9 whitespace-nowrap"><StateCell state={r.bot.state} label={r.bot.label} /></td>
                      <td className="px-3 py-1.5"><UsageCell usage={r.usage} /></td>
                      <td className="px-3 h-9">
                        {r.conversations_7d === null || (!r.display_phone && r.wa.state !== 'ok')
                          ? <span className="text-gray-300">—</span> : <Num className="text-gray-700">{r.conversations_7d}</Num>}
                      </td>
                      <td className={`px-3 h-9 whitespace-nowrap ${TONE_TEXT[r.sub.tone]}`}>{r.sub.label}</td>
                      <td className="px-3 h-9"><OwnerCell row={r} /></td>
                      <td className="px-3 h-9 whitespace-nowrap text-[12px]"><LastActivity row={r} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </Panel>

      <InternalFootnote data={data} showInternal={showInternal} onToggle={() => setShowInternal((v) => !v)} />
    </div>
  );
}
