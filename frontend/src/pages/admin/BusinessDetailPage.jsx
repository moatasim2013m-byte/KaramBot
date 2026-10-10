import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowRight, MessageCircle, MoreHorizontal, Eye, Ban, Bot } from 'lucide-react';
import api from '../../utils/api';
import { Panel, StatusDot, Ltr, Num, relativeTime } from '../../components/shared/Primitives';
import AccountHealthTab from '../../components/admin/AccountHealthTab';
import AccountAccessTab from '../../components/admin/AccountAccessTab';
import AccountContractsTab from '../../components/admin/AccountContractsTab';
import AccountKnowledgeTab from '../../components/admin/AccountKnowledgeTab';
import AccountSettingsTab from '../../components/admin/AccountSettingsTab';
import AccountWhatsAppTab from '../../components/admin/AccountWhatsAppTab';
import AccountLogTab from '../../components/admin/AccountLogTab';
import BotPauseControl from '../../components/admin/BotPauseControl';
import FixButton from '../../components/admin/FixButton';
import {
  attentionItem, fleetRow, maskPhone, sortAttention, waLine, waLink, usageTone,
} from '../../components/admin/operatorView';

/**
 * One shop — /admin/accounts/:id?tab=health|knowledge|access|contract|settings|whatsapp|log.
 *
 * Everything about it: whether it works, what is left, what it knows, who can log in, what they
 * pay and what changed. The header answers the first three at a glance (chips for WhatsApp, the
 * bot and the subscription, the owner's line with «راسله», the number with its name at Meta), and
 * the tab lives in the URL so «اليوم» can open a shop on the tab its problem is about.
 *
 * The header reads the shop's row from /admin/overview, the same row «الزبائن» shows, so the two
 * cannot disagree; internal shops are asked for explicitly, since the default hides them.
 */

const TABS = [
  ['health', 'الحالة'],
  ['knowledge', 'المعرفة'],
  ['access', 'الدخول'],
  ['contract', 'العقد'],
  ['settings', 'الإعدادات'],
  ['whatsapp', 'واتساب وMeta'],
  ['log', 'السجل'],
];
const TAB_KEYS = TABS.map(([k]) => k);
// Old links (?tab=contracts, general, ai, policies) still land somewhere sensible.
const TAB_ALIAS = { contracts: 'contract', general: 'settings', ai: 'settings', policies: 'settings' };

const NAME_STATUS = { APPROVED: 'مقبول', DECLINED: 'مرفوض', PENDING_REVIEW: 'قيد المراجعة' };
const DOT = { critical: 'down', warning: 'degraded', info: 'idle' };
const TONE_CHIP = {
  ok: 'bg-emerald-50 text-emerald-800 border-emerald-100',
  warn: 'bg-amber-50 text-amber-800 border-amber-100',
  bad: 'bg-red-50 text-red-700 border-red-100',
  muted: 'bg-gray-50 text-gray-600 border-gray-200',
};
const STATE_TONE = { ok: 'ok', degraded: 'warn', down: 'bad', paused: 'muted', idle: 'muted', unknown: 'muted' };

function Chip({ tone, dot, children }) {
  return (
    <span className={`inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full border text-[12px] ${TONE_CHIP[tone] || TONE_CHIP.muted}`}>
      {dot && <StatusDot state={dot} />} {children}
    </span>
  );
}

/** ⋯ : the rarer actions, out of the way of the pause. */
function MoreMenu({ accountId, status, onSuspend }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="المزيد"
        className="inline-flex items-center justify-center h-7 w-8 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
        <MoreHorizontal size={15} />
      </button>
      {open && (
        <div className="absolute left-0 top-8 z-20 w-56 rounded-md border border-gray-200 bg-white shadow-lg py-1 text-[13px]">
          <Link to={`/admin/accounts/${accountId}/conversations`} className="flex items-center gap-2 px-3 h-9 text-gray-700 hover:bg-gray-50">
            <Eye size={14} /> فحص المحادثات (مُسجّل)
          </Link>
          {status !== 'suspended' && (
            <button type="button" onClick={() => { setOpen(false); onSuspend(); }} className="w-full flex items-center gap-2 px-3 h-9 text-red-700 hover:bg-red-50">
              <Ban size={14} /> إيقاف الحساب
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ThisMonth({ row }) {
  if (!row) return null;
  const u = row.usage;
  const tone = u ? usageTone(u.ai_replies_month, u.cap) : 'none';
  return (
    <Panel title="هذا الشهر">
      <div className="flex flex-wrap divide-x divide-x-reverse divide-gray-100">
        <div className="flex-1 min-w-[160px] px-4 py-3">
          <p className="text-[11px] text-gray-500">ردود البوت / الحد</p>
          <p className={`text-[15px] font-semibold tabular-nums ${tone === 'bad' ? 'text-red-700' : tone === 'warn' ? 'text-amber-700' : 'text-gray-900'}`} dir="ltr">
            {u ? `${u.ai_replies_month.toLocaleString('en-US')} / ${u.cap ? u.cap.toLocaleString('en-US') : '—'}` : '—'}
          </p>
        </div>
        <div className="flex-1 min-w-[160px] px-4 py-3">
          <p className="text-[11px] text-gray-500">محادثات آخر 7 أيام</p>
          <p className="text-[15px] font-semibold text-gray-900"><Num>{row.conversations_7d ?? '—'}</Num></p>
        </div>
        {u && u.media_today !== undefined && u.media_today !== null && (
          <div className="flex-1 min-w-[160px] px-4 py-3">
            <p className="text-[11px] text-gray-500">صور وصوتيات اليوم</p>
            <p className="text-[15px] font-semibold text-gray-900"><Num>{u.media_today}</Num></p>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ShopAttention({ items, owner, onDone }) {
  const [notice, setNotice] = useState(null);
  if (!items.length) return null;
  return (
    <Panel title={`يحتاج انتباهك · ${items.length}`}>
      {notice && <p className={`px-4 py-2 text-[12px] ${notice.tone === 'error' ? 'text-red-700 bg-red-50' : 'text-emerald-800 bg-emerald-50'}`}>{notice.text}</p>}
      <ul className="divide-y divide-gray-100">
        {items.map((it, i) => (
          <li key={`${it.rule}-${i}`} className="flex items-center gap-3 px-4 min-h-[36px] py-1">
            <StatusDot state={DOT[it.severity]} />
            <span className="flex-1 min-w-0 text-[13px] text-gray-700">{it.text}</span>
            <span className="text-[12px] text-gray-400 shrink-0">{it.since ? relativeTime(it.since) : ''}</span>
            <FixButton item={it} owner={owner} onDone={onDone} onNotice={setNotice} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export default function BusinessDetailPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const [biz, setBiz] = useState(null);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [botEnabled, setBotEnabled] = useState(true);

  const raw = params.get('tab');
  const tab = TAB_KEYS.includes(raw) ? raw : (TAB_ALIAS[raw] || 'health');
  const setTab = (key) => {
    const next = new URLSearchParams(params);
    next.set('tab', key);
    setParams(next, { replace: true });
  };

  const loadOverview = useCallback(() => {
    api.get('/admin/overview', { params: { include_internal: 1 } })
      .then((res) => setOverview(res.data))
      .catch(() => setOverview(null)); // the header degrades to the shop's own fields
  }, []);

  useEffect(() => {
    setLoading(true);
    api.get(`/businesses/${id}`)
      .then((r) => { setBiz(r.data.business); setBotEnabled(r.data.business?.ai_config?.enabled !== false); })
      .catch((e) => setError(e.response?.data?.error || 'لم يتم العثور على المحل'))
      .finally(() => setLoading(false));
    loadOverview();
  }, [id, loadOverview]);

  const row = useMemo(() => {
    const a = (overview?.accounts || []).find((x) => x.id === id);
    return a ? fleetRow(a) : null;
  }, [overview, id]);
  const items = useMemo(() => sortAttention((overview?.attention || []).map(attentionItem).filter((x) => x.account_id === id)), [overview, id]);

  const onBotChange = (enabled) => {
    setBotEnabled(enabled);
    setBiz((b) => (b ? { ...b, ai_config: { ...(b.ai_config || {}), enabled } } : b));
    loadOverview();
  };

  const suspend = async () => {
    if (!window.confirm(`إيقاف حساب ${biz.name}؟ يتوقف البوت، ورسائل الزبائن تبقى تصل لصندوق المحل. يمكن إعادته من «الإعدادات».`)) return;
    try {
      const res = await api.patch(`/businesses/${id}`, { status: 'suspended' });
      setBiz((b) => ({ ...b, ...(res.data?.business || { status: 'suspended' }) }));
      loadOverview();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إيقاف الحساب');
    }
  };

  if (loading) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;
  if (error && !biz) return <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>;
  if (!biz) return null;

  const owner = row?.owner || null;
  const ownerHref = owner ? waLink(owner.phone, waLine(null, biz.name, owner.first_name)) : null;
  const sectorCity = [row?.sector_ar, biz.city || row?.city].filter(Boolean).join(' · ');
  const nameStatus = row?.meta_name_status || null;

  return (
    <div className="max-w-[1200px]">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3 min-w-0">
          <Link to="/admin/accounts" className="text-gray-400 hover:text-gray-600 mt-1"><ArrowRight size={18} /></Link>
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-gray-900">{biz.name}</h1>
            {sectorCity && <p className="text-[12px] text-gray-500">{sectorCity}</p>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {row && <Chip tone={STATE_TONE[row.wa.state]} dot={row.wa.state}>واتساب: {row.wa.label}</Chip>}
              {row && <Chip tone={STATE_TONE[row.bot.state]} dot={row.bot.state}>البوت: {row.bot.label}</Chip>}
              {row && <Chip tone={row.sub.tone}>{row.sub.label}</Chip>}
              {biz.status && biz.status !== 'active' && <Chip tone="bad">الحساب {biz.status === 'suspended' ? 'موقوف' : 'غير نشط'}</Chip>}
            </div>
            <p className="mt-2 text-[12px] text-gray-600 flex flex-wrap items-center gap-x-2 gap-y-1">
              {owner ? (
                <>
                  <span>{owner.first_name || 'صاحب المحل'}</span>
                  {owner.phone && <>· <Ltr>{maskPhone(owner.phone)}</Ltr></>}
                  {ownerHref && (
                    <a href={ownerHref} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline">
                      · <MessageCircle size={12} /> راسله
                    </a>
                  )}
                </>
              ) : <button type="button" onClick={() => setTab('access')} className="underline text-gray-500">لا يوجد صاحب محل — أضفه من «الدخول»</button>}
            </p>
            {row?.display_phone && (
              <p className="text-[12px] text-gray-600">
                <Ltr>{row.display_phone}</Ltr>
                {row.verified_name && <> · الاسم عند Meta: {row.verified_name}{nameStatus && NAME_STATUS[nameStatus] ? ` (${NAME_STATUS[nameStatus]})` : ''}</>}
              </p>
            )}
          </div>
        </div>
        {/* The pause is what an operator reaches for first when a shop's bot misbehaves. */}
        <div className="flex items-start gap-2">
          <BotPauseControl accountId={biz.id} enabled={botEnabled} onChange={onBotChange} compact />
          <button type="button" onClick={() => setTab('knowledge')}
            className="inline-flex items-center gap-1 border border-gray-200 text-gray-800 px-2.5 h-7 rounded-md text-[12px] hover:bg-gray-50">
            <Bot size={12} /> جرّب البوت
          </button>
          <MoreMenu accountId={biz.id} status={biz.status} onSuspend={suspend} />
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2 rounded-lg mt-3">{error}</div>}

      {/* Tabs: scroll sideways on a phone rather than wrap into two rows. */}
      <div className="flex gap-1 border-b border-gray-200 mb-5 mt-4 overflow-x-auto">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)}
            className={`shrink-0 px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key ? 'border-green-500 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'health' && (
        <div className="space-y-4">
          <ShopAttention items={items} owner={owner} onDone={loadOverview} />
          <ThisMonth row={row} />
          {/* Keyed on the pause so the agent state there is re-read after the switch. */}
          <AccountHealthTab key={`${biz.id}-${botEnabled}`} accountId={biz.id} />
        </div>
      )}
      {tab === 'knowledge' && <AccountKnowledgeTab accountId={biz.id} businessType={biz.business_type} />}
      {tab === 'access' && <AccountAccessTab accountId={biz.id} />}
      {tab === 'contract' && <AccountContractsTab accountId={biz.id} />}
      {tab === 'settings' && (
        <AccountSettingsTab key={biz.id} biz={biz} botEnabled={botEnabled} onBotChange={onBotChange}
          onSaved={(b) => setBiz((prev) => ({ ...prev, ...b }))} />
      )}
      {tab === 'whatsapp' && <AccountWhatsAppTab accountId={biz.id} biz={biz} />}
      {tab === 'log' && <AccountLogTab accountId={biz.id} />}
    </div>
  );
}
