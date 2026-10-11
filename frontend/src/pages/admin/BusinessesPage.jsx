import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plus, Search, MessageCircle, ArrowUpDown, ArrowUp, ArrowDown, X, Copy, MoreHorizontal, RefreshCw, Eye, EyeOff } from 'lucide-react';
import api from '../../utils/api';
import { Ltr, Num, SkeletonRows, relativeTime } from '../../components/shared/Primitives';
import { PageHeader, Tag, Button, btnClass, chipClass } from '../../components/admin/ui';
import { InternalFootnote } from './AdminOverviewPage';
import {
  FLEET_FILTERS, attentionItem, fleetRow, matchesFilter, matchesSearch, sortRows, sortAttention,
  ownerLoginLabel, usageTone, waLine, waLink, stageLabel, stageMatches,
} from '../../components/admin/operatorView';

/**
 * «الزبائن» — /admin/accounts (?stage=, ?filter=), every shop on one line.
 *
 * Built from the same /admin/overview payload as «اليوم», so the two screens can never disagree
 * about a shop. Five columns, as the approved design has them: the shop, its service right now,
 * setup, subscription and last activity. By default what needs SHIFT comes first, then the name;
 * each column header still sorts in the browser (fine at ten; server paging waits for fifty). On a
 * phone the columns wrap into a card. There are deliberately no bulk changes to live bots.
 */

const TONE_TEXT = { ok: 'text-shift-body', warn: 'text-shift-warn', bad: 'text-shift-danger', muted: 'text-shift-muted', none: 'text-shift-muted' };
const THREE_DAYS_MS = 3 * 86400000;
const SEV_RANK = { critical: 0, warning: 1, info: 2 };
const JOINING = ['invite_sent', 'invite_opened', 'connecting', 'awaiting_card', 'teaching', 'awaiting_first_customer'];

// Flex columns rather than a <table>, so a row can wrap into a card at phone width.
const COLUMNS = [
  ['name', 'الزبون', 'flex-[2_1_230px] min-w-0'],
  ['service', 'الخدمة الآن', 'flex-[1.6_1_200px] min-w-0'],
  ['stage', 'التفعيل', 'flex-[1.4_1_180px] min-w-0'],
  ['subscription', 'الاشتراك', 'flex-[1.3_1_160px] min-w-0'],
  ['last_activity', 'آخر نشاط', 'flex-[0.7_1_90px] min-w-0'],
];
const COL = Object.fromEntries(COLUMNS.map(([id, , cls]) => [id, cls]));

const DOT = { ok: 'bg-shift-ok', degraded: 'bg-[#DC8A03]', down: 'bg-[#D92D20]', idle: 'bg-[#9AA6BA]', paused: 'bg-shift-muted' };
const Dot = ({ state }) => (
  <span aria-hidden="true" className={`w-[9px] h-[9px] rounded-full shrink-0 ${DOT[state] || 'border-[1.5px] border-[#8E97A7]'}`} />
);

/** Attention first (worst severity), then the name: the order the page opens in. */
function attentionFirst(rows, top) {
  const rank = (r) => (top.has(r.id) ? SEV_RANK[top.get(r.id).severity] : 3);
  return [...rows].sort((a, b) => (rank(a) - rank(b)) || a.name.localeCompare(b.name, 'ar'));
}

/**
 * «الخدمة الآن»: an open attention item speaks first, as a written tag and its own words; otherwise
 * WhatsApp when it is not connected, else the bot, as a dot and text.
 */
function ServiceCell({ row, item }) {
  if (item) {
    return (
      <span className="flex items-start gap-2 min-w-0">
        <Tag tone={item.severity} />
        <span className="min-w-0 text-shift-ink leading-snug">{item.text}</span>
      </span>
    );
  }
  const part = row.wa.state !== 'ok' ? row.wa : row.bot;
  return <span className="inline-flex items-center gap-2 min-w-0"><Dot state={part.state} /><span className="truncate">{part.label}</span></span>;
}

function UsageLine({ usage }) {
  if (!usage || !usage.cap) return null;
  const tone = usageTone(usage.ai_replies_month, usage.cap);
  return (
    <span className={`block text-[12.5px] ${tone === 'ok' ? 'text-shift-muted' : TONE_TEXT[tone]}`}>
      ردود الشهر <span dir="ltr" className="tabular-nums">{usage.ai_replies_month.toLocaleString('en-US')} / {usage.cap.toLocaleString('en-US')}</span>
      {tone === 'bad' && ' · وصل الحد'}
    </span>
  );
}

/** Under the name: type · owner (with «راسله على واتساب») · whether they have signed in. */
function MetaLine({ row, showInternal }) {
  const o = row.owner;
  const login = o ? ownerLoginLabel(o) : null;
  const href = o ? waLink(o.phone, waLine(null, row.name, o.first_name)) : null;
  return (
    <span className="flex flex-wrap items-center gap-x-1 text-[13px] text-shift-body">
      <span>{row.sector_ar}</span>
      {o?.first_name && <span>· {o.first_name}</span>}
      {href && (
        <a href={href} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()}
          className="inline-grid place-items-center w-8 h-8 -my-1.5 rounded-lg text-shift-ok hover:bg-shift-okBg" title="راسله على واتساب" aria-label={`راسل ${o.first_name || 'صاحب المحل'} على واتساب`}>
          <MessageCircle size={15} />
        </a>
      )}
      {login && login.text !== '—' && <span className={login.tone === 'ok' ? '' : TONE_TEXT[login.tone]}>· {login.text}</span>}
      {row.display_phone && <span>· <Ltr>{row.display_phone}</Ltr></span>}
      {showInternal && row.is_internal && <span className="ms-1 text-[11px] text-shift-body bg-shift-line2 rounded px-1.5 py-px">داخلي</span>}
    </span>
  );
}

function LastActivity({ row }) {
  if (!row.last_activity) return <span className="text-shift-muted">—</span>;
  // Three silent days on a live shop is worth a look before it is worth an alert.
  const quiet = row.stage === 'live' && Date.now() - new Date(row.last_activity).getTime() > THREE_DAYS_MS;
  return (
    <span className={quiet ? 'text-shift-warn font-medium' : 'text-shift-muted'} title={new Date(row.last_activity).toLocaleString('ar-JO')}>
      {relativeTime(row.last_activity)}
    </span>
  );
}

function SortHead({ id, label, sort, onSort }) {
  const active = sort.key === id;
  const Icon = !active ? ArrowUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <span className={COL[id]}>
      <button type="button" onClick={() => onSort(id)} aria-label={`رتّب حسب ${label}`}
        className={`inline-flex items-center gap-1 min-h-[32px] hover:text-shift-ink ${active ? 'text-shift-ink' : ''}`}>
        {label} <Icon size={11} className={active ? '' : 'text-shift-field'} />
      </button>
    </span>
  );
}

/** «⋯»: what used to sit in the toolbar and is needed now and then, not every visit. */
function MoreMenu({ generatedAt, loading, onRefresh, showInternal, onToggleInternal, onCopyInvites, invitesBusy, canCopy }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey); };
  }, [open]);
  const item = 'flex items-center gap-2.5 w-full min-h-[44px] px-3 rounded-[10px] text-start text-sm text-shift-ink hover:bg-shift-hover disabled:opacity-50 disabled:cursor-not-allowed';
  const pick = (fn) => () => { setOpen(false); fn(); };
  return (
    <div ref={ref} className="relative">
      <Button variant="secondary" aria-label="المزيد" aria-haspopup="menu" aria-expanded={open ? 'true' : 'false'}
        onClick={() => setOpen((v) => !v)} className="!px-3">
        <MoreHorizontal size={18} />
      </Button>
      {open && (
        <div role="menu" className="absolute end-0 top-full mt-1.5 z-30 w-[min(300px,calc(100vw-32px))] bg-white border border-shift-line rounded-xl p-1.5 shadow-[0_18px_44px_-20px_rgba(15,30,56,.45)]">
          <button type="button" role="menuitem" className={item} onClick={pick(onRefresh)} disabled={loading}>
            <RefreshCw size={15} className={`text-shift-muted ${loading ? 'animate-spin' : ''}`} />
            <span className="flex-1">تحديث</span>
            <span className="text-[12px] text-shift-muted">آخر تحديث {relativeTime(generatedAt)}</span>
          </button>
          <button type="button" role="menuitemcheckbox" aria-checked={showInternal ? 'true' : 'false'} className={item} onClick={pick(onToggleInternal)}>
            {showInternal ? <EyeOff size={15} className="text-shift-muted" /> : <Eye size={15} className="text-shift-muted" />}
            {showInternal ? 'إخفاء الحسابات الداخلية' : 'إظهار الحسابات الداخلية'}
          </button>
          <button type="button" role="menuitem" className={item} onClick={pick(onCopyInvites)} disabled={invitesBusy || !canCopy}>
            <Copy size={15} className="text-shift-muted" /> انسخ روابط الدعوات غير المستخدمة
          </button>
        </div>
      )}
    </div>
  );
}

export default function BusinessesPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [q, setQ] = useState('');
  // No key: attention first, then the name. A header click switches to that column.
  const [sort, setSort] = useState({ key: null, dir: 'asc' });
  // Same default as «اليوم»: SHIFT's own row and the -sim shops only when asked for.
  const [showInternal, setShowInternal] = useState(false);

  // «انسخ روابط الدعوات غير المستخدمة»: {text, count} once made, shown selectable under the toolbar.
  const [invites, setInvites] = useState(null);
  const [invitesBusy, setInvitesBusy] = useState(false);

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
  // Each shop's worst open item (sortAttention puts it first): its severity tints nothing now, it is
  // written in «الخدمة الآن» and decides the default order.
  const top = useMemo(() => {
    const out = new Map();
    for (const it of sortAttention((data?.attention || []).map(attentionItem))) {
      if (it.account_id && !out.has(it.account_id)) out.set(it.account_id, it);
    }
    return out;
  }, [data]);
  const attentionIds = useMemo(() => new Set(top.keys()), [top]);

  const counts = useMemo(() => Object.fromEntries(
    FLEET_FILTERS.map(([key]) => [key, all.filter((r) => matchesFilter(r, key, attentionIds)).length]),
  ), [all, attentionIds]);
  const live = all.filter((r) => r.stage === 'live').length;
  const joining = all.filter((r) => JOINING.includes(r.stage)).length;

  const rows = useMemo(() => {
    const shown = all.filter((r) => stageMatches(r.stage, stage)
      && matchesFilter(r, filter, attentionIds)
      && matchesSearch(r, q));
    if (!sort.key) return attentionFirst(shown, top);
    if (sort.key === 'service') {
      const s = attentionFirst(shown, top);
      return sort.dir === 'asc' ? s : s.reverse();
    }
    return sortRows(shown, sort.key, sort.dir);
  }, [all, stage, filter, attentionIds, q, sort, top]);

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
  // «اعرض الكل»: the empty state's way back — no filter, no stage, no search.
  const showAll = () => {
    setQ('');
    const next = new URLSearchParams(params);
    next.delete('filter'); next.delete('stage');
    setParams(next, { replace: true });
  };
  // The links are stored hashed, so each unused one is reissued (the server says so in its log)
  // and the old link stops working: hence the confirm. Only the shops on screen are included.
  const copyUnusedInvites = async () => {
    if (!window.confirm('سيُنشأ رابط جديد لكل صاحب محل لم يستخدم دعوته بعد، وتتوقف روابطهم القديمة. متابعة؟')) return;
    setInvitesBusy(true); setError(null);
    try {
      const res = await api.post('/admin/accounts/invites/unused-links', { account_ids: rows.map((r) => r.id) });
      const links = res.data?.links || [];
      const text = links.map((l) => `${l.name}\n${l.share_text}`).join('\n\n');
      let copied = false;
      if (text) {
        try { await navigator.clipboard.writeText(text); copied = true; } catch { /* selectable below */ }
      }
      setInvites({ text, count: links.length, copied });
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تجهيز روابط الدعوات');
    } finally {
      setInvitesBusy(false);
    }
  };

  const onSort = (key) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const open = (id) => navigate(`/admin/accounts/${id}`);

  return (
    <div className="flex flex-col gap-4 max-w-[1500px]">
      <PageHeader title="الزبائن"
        sub={data ? <><Num>{all.length}</Num> محلات · <Num>{live}</Num> يعمل · <Num>{joining}</Num> قيد التجهيز</> : '—'}>
        {/* On a phone the two split the line, so the menu opens inward from the left edge. */}
        <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-start">
          <Link to="/admin/accounts/new" className={`${btnClass('primary', 'md')} no-underline`}>
            <Plus size={16} aria-hidden="true" /> زبون جديد
          </Link>
          <MoreMenu generatedAt={data?.generated_at} loading={loading} onRefresh={load}
            showInternal={showInternal} onToggleInternal={() => setShowInternal((v) => !v)}
            onCopyInvites={copyUnusedInvites} invitesBusy={invitesBusy} canCopy={rows.length > 0} />
        </div>
      </PageHeader>

      {error && <div className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}

      {invites && (
        <div className="bg-white border border-shift-line rounded-xl px-4 py-3 flex flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <p className="m-0 text-[13.5px] text-shift-body">
              {invites.count === 0
                ? 'لا توجد دعوات غير مستخدمة بين المحلات الظاهرة'
                : <>جُهّز <Num>{invites.count}</Num> رابط{invites.copied ? ' ونُسخت' : ' — انسخها من هنا'}. الروابط القديمة لم تعد تعمل.</>}
            </p>
            <button type="button" onClick={() => setInvites(null)} aria-label="إغلاق"
              className="w-10 h-10 grid place-items-center rounded-[10px] text-shift-muted hover:bg-shift-hover hover:text-shift-ink"><X size={16} /></button>
          </div>
          {invites.text && (
            <textarea readOnly value={invites.text} rows={Math.min(10, invites.count * 3)}
              onFocus={(e) => e.target.select()}
              className="w-full text-[13px] border border-shift-field rounded-xl p-2.5 text-shift-body" />
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5">
        <label className="flex-[1_1_280px] flex items-center gap-2.5 h-11 px-3.5 bg-white border border-shift-field rounded-xl min-w-0">
          <Search size={16} className="text-shift-muted shrink-0" aria-hidden="true" />
          <input value={q} onChange={(e) => setQ(e.target.value)} aria-label="بحث في الزبائن"
            placeholder="الاسم أو الموبايل أو صاحب المحل"
            className="flex-1 min-w-0 border-0 outline-none bg-transparent text-[15px] text-shift-ink placeholder:text-shift-muted" />
          {q && (
            <button type="button" onClick={() => setQ('')} aria-label="امسح البحث" className="w-8 h-8 grid place-items-center text-shift-muted hover:text-shift-ink"><X size={14} /></button>
          )}
        </label>
        <div role="group" aria-label="تصفية الزبائن" className="flex flex-wrap gap-1.5">
          {FLEET_FILTERS.map(([key, label]) => {
            const on = filter === key && !stage;
            return (
              <button key={key} type="button" onClick={() => setFilter(key)} aria-pressed={on ? 'true' : 'false'} className={chipClass(on, 'rect')}>
                {label} <Num>{counts[key] ?? 0}</Num>
              </button>
            );
          })}
          {stage && (
            <span className={`${chipClass(true, 'rect')} inline-flex items-center gap-1`}>
              المرحلة: {stageLabel(stage)}
              <button type="button" onClick={clearStage} aria-label="إزالة" className="w-7 h-7 grid place-items-center hover:text-shift-ink"><X size={13} /></button>
            </span>
          )}
        </div>
      </div>

      <section aria-label="قائمة الزبائن" className="bg-white border border-shift-line rounded-2xl overflow-hidden">
        <div className="hidden md:flex flex-wrap gap-x-4 gap-y-1 px-5 py-2 border-b border-shift-line text-[12.5px] font-semibold text-shift-body">
          {COLUMNS.map(([id, label]) => <SortHead key={id} id={id} label={label} sort={sort} onSort={onSort} />)}
        </div>
        {loading && !data ? (
          <SkeletonRows rows={6} cols={5} />
        ) : rows.length === 0 ? (
          <div className="px-5 py-7 text-sm text-shift-body">
            {all.length === 0 ? 'لا يوجد زبائن بعد — ابدأ بـ «زبون جديد».' : (
              <>
                لا يوجد زبون بهذا التصنيف.{' '}
                <button type="button" onClick={showAll} className="min-h-[40px] text-shift-accent hover:text-shift-ink font-medium">اعرض الكل</button>
              </>
            )}
          </div>
        ) : (
          <ul className="m-0 p-0 list-none">
            {rows.map((r) => (
              <li key={r.id} onClick={() => open(r.id)}
                className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 md:px-5 py-3 border-b border-shift-line2 last:border-b-0 text-sm text-shift-ink cursor-pointer hover:bg-shift-hover">
                <span className={COL.name}>
                  <Link to={`/admin/accounts/${r.id}`} onClick={(e) => e.stopPropagation()}
                    className="block font-semibold text-[14.5px] text-shift-ink no-underline hover:underline">{r.name}</Link>
                  <MetaLine row={r} showInternal={showInternal} />
                </span>
                <span className={COL.service}><ServiceCell row={r} item={top.get(r.id)} /></span>
                <span className={`${COL.stage} text-shift-body`}>{r.stage_ar || stageLabel(r.stage)}</span>
                <span className={`${COL.subscription} ${TONE_TEXT[r.sub.tone]}`}>
                  {r.sub.label}
                  <UsageLine usage={r.usage} />
                </span>
                <span className={`${COL.last_activity} text-[13px]`}>
                  <LastActivity row={r} />
                  {r.conversations_7d !== null && (r.display_phone || r.wa.state === 'ok') && (
                    <span className="block text-[12.5px] text-shift-muted"><Num>{r.conversations_7d}</Num> محادثة / 7 أيام</span>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="flex flex-col gap-1">
        <p className="m-0 text-[13px] text-shift-muted">
          {sort.key ? (
            <>
              الترتيب حسب العمود المختار ·{' '}
              <button type="button" onClick={() => setSort({ key: null, dir: 'asc' })} className="min-h-[40px] text-shift-accent hover:text-shift-ink">أعد الترتيب الافتراضي</button>
            </>
          ) : 'الترتيب: ما يحتاج تدخلك أولًا، ثم الاسم'}
        </p>
        <InternalFootnote data={data} showInternal={showInternal} onToggle={() => setShowInternal((v) => !v)} />
      </div>
    </div>
  );
}
