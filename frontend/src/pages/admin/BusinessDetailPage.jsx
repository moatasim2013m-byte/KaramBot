import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { MessageCircle, MoreHorizontal, Eye, Ban, Bot } from 'lucide-react';
import api from '../../utils/api';
import { Ltr, relativeTime } from '../../components/shared/Primitives';
import AccountHealthTab from '../../components/admin/AccountHealthTab';
import AccountAccessTab from '../../components/admin/AccountAccessTab';
import AccountContractsTab from '../../components/admin/AccountContractsTab';
import AccountKnowledgeTab from '../../components/admin/AccountKnowledgeTab';
import AccountSettingsTab from '../../components/admin/AccountSettingsTab';
import AccountWhatsAppTab from '../../components/admin/AccountWhatsAppTab';
import AccountLogTab from '../../components/admin/AccountLogTab';
import BotPauseControl, { pauseResumeAt, resumeLabel } from '../../components/admin/BotPauseControl';
import FixButton from '../../components/admin/FixButton';
import { Button, Card, Pill, Tag, btnClass } from '../../components/admin/ui';
import { ConversationDrawer } from './AccountWorkspacePage';
import {
  attentionItem, fleetRow, maskPhone, sortAttention, waLine, waLink,
} from '../../components/admin/operatorView';

/**
 * One shop — /admin/accounts/:id?tab=health|knowledge|access|contract|settings|whatsapp|log.
 *
 * Everything about it: whether it works, what is left, what it knows, who can log in, what they
 * pay and what changed. The header answers the first three at a glance (pills for setup, service
 * and subscription, the owner's line with «راسله», the number with its name at Meta), a customer
 * left waiting shows right under it, and the tab lives in the URL so «اليوم» can open a shop on
 * the tab its problem is about.
 *
 * The header reads the shop's row from /admin/overview, the same row «الزبائن» shows, so the two
 * cannot disagree; internal shops are asked for explicitly, since the default hides them.
 */

const TABS = [
  ['health', 'الحالة'],
  ['knowledge', 'المعرفة'],
  ['access', 'الدخول'],
  ['contract', 'الاشتراك والعقد'],
  ['settings', 'الإعدادات'],
  ['whatsapp', 'واتساب وMeta'],
  ['log', 'السجل'],
];
const TAB_KEYS = TABS.map(([k]) => k);
// Old links (?tab=contracts, general, ai, policies) still land somewhere sensible.
const TAB_ALIAS = { contracts: 'contract', general: 'settings', ai: 'settings', policies: 'settings' };

const NAME_STATUS = { APPROVED: 'مقبول', DECLINED: 'مرفوض', PENDING_REVIEW: 'قيد المراجعة' };
// Row states and subscription tones, in the kit's pill tones.
const STATE_PILL = { ok: 'ok', degraded: 'warn', down: 'bad', paused: 'warn', idle: 'neutral', unknown: 'neutral' };
const SUB_PILL = { ok: 'ok', warn: 'warn', bad: 'bad', muted: 'neutral' };
// The attention rules that are about a customer waiting in a thread: the alert under the header.
const URGENT_RULES = ['unanswered', 'handoff_waiting'];

/** ⋯ : the rarer actions, out of the way of the pause. */
function MoreMenu({ accountId, status, onSuspend, onTry }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const item = 'w-full flex items-center gap-2 px-3 min-h-[44px] text-right hover:bg-shift-hover';
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="المزيد" aria-expanded={open ? 'true' : 'false'}
        className={`${btnClass('secondary', 'md')} w-11 !px-0`}>
        <MoreHorizontal size={18} />
      </button>
      {open && (
        <div className="absolute left-0 top-12 z-20 w-60 rounded-xl border border-shift-line bg-white shadow-[0_12px_32px_-16px_rgba(15,30,56,.35)] py-1 text-sm text-shift-ink">
          <button type="button" onClick={() => { setOpen(false); onTry(); }} className={item}>
            <Bot size={15} /> جرّب البوت
          </button>
          <Link to={`/admin/accounts/${accountId}/conversations`} className={`${item} no-underline text-shift-ink`}>
            <Eye size={15} /> فحص المحادثات (مُسجّل)
          </Link>
          {status !== 'suspended' && (
            <button type="button" onClick={() => { setOpen(false); onSuspend(); }} className={`${item} text-shift-danger hover:bg-shift-dangerBg`}>
              <Ban size={15} /> إيقاف الحساب
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ShopAttention({ items, owner, onDone }) {
  const [notice, setNotice] = useState(null);
  if (!items.length) return null;
  return (
    <Card pad={false} title={`يحتاج انتباهك · ${items.length}`}>
      {notice && (
        <p role="status" className={`m-0 px-[18px] py-2 text-[13px] ${notice.tone === 'error' ? 'text-shift-danger bg-shift-dangerBg' : 'text-[#14532D] bg-shift-okBg'}`}>{notice.text}</p>
      )}
      <ul className="m-0 p-0 list-none">
        {items.map((it, i) => (
          <li key={`${it.rule}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-[18px] py-2.5 border-t border-shift-line2">
            <Tag tone={it.severity} />
            <span className="flex-1 basis-48 min-w-0 text-sm text-shift-ink">{it.text}</span>
            <span className="text-[12.5px] text-shift-muted shrink-0">{it.since ? relativeTime(it.since) : ''}</span>
            <FixButton item={it} owner={owner} onDone={onDone} onNotice={setNotice} />
          </li>
        ))}
      </ul>
    </Card>
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
  // When SHIFT's timed pause ends («حتى 14:30»); null for an open-ended pause or none.
  const [resumeAt, setResumeAt] = useState(null);
  // ?conv=<id>: «اليوم» sends the operator here with the waiting thread named, and it opens at once.
  const [convOpen, setConvOpen] = useState(() => Boolean(params.get('conv')));

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
      .then((r) => {
        setBiz(r.data.business);
        setBotEnabled(r.data.business?.ai_config?.enabled !== false);
        setResumeAt(pauseResumeAt(r.data.business?.ai_config));
      })
      .catch((e) => setError(e.response?.data?.error || 'لم يتم العثور على المحل'))
      .finally(() => setLoading(false));
    loadOverview();
  }, [id, loadOverview]);

  const row = useMemo(() => {
    const a = (overview?.accounts || []).find((x) => x.id === id);
    return a ? fleetRow(a) : null;
  }, [overview, id]);
  // conversation_id rides along: the server names the thread an unanswered/handoff item is about.
  const items = useMemo(() => sortAttention((overview?.attention || [])
    .map((a) => ({ ...attentionItem(a), conversation_id: a.conversation_id || null }))
    .filter((x) => x.account_id === id)), [overview, id]);
  const urgent = items.find((it) => URGENT_RULES.includes(it.rule)) || null;
  // The thread to open: named in the link, else the one the alert is about. Without either the
  // drawer falls back to guessing the newest waiting thread. Every path is the audited read.
  const linkedConv = params.get('conv');
  const convId = linkedConv || urgent?.conversation_id || null;
  const closeConv = () => {
    setConvOpen(false);
    if (linkedConv) {
      const next = new URLSearchParams(params);
      next.delete('conv');
      setParams(next, { replace: true });
    }
  };

  // The overview reloads after the switch, and its bot_resume_at agrees with what the route said.
  useEffect(() => {
    const a = (overview?.accounts || []).find((x) => x.id === id);
    if (a && 'bot_resume_at' in a) setResumeAt(a.bot_resume_at || null);
  }, [overview, id]);

  const onBotChange = (enabled, data) => {
    setBotEnabled(enabled);
    setResumeAt(enabled ? null : (data?.resume_at || null));
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

  if (loading) return <div className="text-center py-16 text-shift-muted">جاري التحميل...</div>;
  if (error && !biz) return <div role="alert" className="bg-shift-dangerBg text-shift-danger text-sm px-4 py-3 rounded-xl">{error}</div>;
  if (!biz) return null;

  const owner = row?.owner || null;
  const ownerHref = owner ? waLink(owner.phone, waLine(null, biz.name, owner.first_name)) : null;
  const urgentHref = owner && urgent ? waLink(owner.phone, waLine(urgent.rule, biz.name, owner.first_name)) : ownerHref;
  const typeCity = [row?.sector_ar, biz.city || row?.city].filter(Boolean).join(' · ');
  const nameStatus = row?.meta_name_status || null;

  return (
    <div className="max-w-[1200px] flex flex-col gap-4">
      <div className="text-[13.5px] text-shift-body">
        <Link to="/admin/accounts" className="text-shift-accent hover:text-shift-ink no-underline">الزبائن</Link>
        <span aria-hidden="true"> / </span>{biz.name}
      </div>

      <header className="bg-white border border-shift-line rounded-2xl p-3.5 sm:px-[22px] sm:py-5 flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-3">
          <div aria-hidden="true" className="hidden sm:grid w-11 h-11 rounded-xl bg-[#F1F3F7] place-items-center font-display font-bold text-lg text-shift-ink">
            {(biz.name || '—').trim().charAt(0)}
          </div>
          <h1 className="m-0 font-display text-[22px] sm:text-[28px] leading-[1.35] font-semibold text-shift-ink min-w-0 break-words">{biz.name}</h1>
          {typeCity && <span className="text-sm text-shift-body">{typeCity}</span>}
          {/* The pause is what an operator reaches for first when a shop's bot misbehaves. */}
          <div className="w-full sm:w-auto sm:ms-auto grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:flex sm:flex-wrap gap-2">
            {ownerHref ? (
              <a href={ownerHref} target="_blank" rel="noopener noreferrer" className={`${btnClass('secondary', 'md')} no-underline !px-3 !whitespace-normal leading-tight`}>
                <MessageCircle size={15} className="hidden sm:block" /> راسل صاحب المحل
              </a>
            ) : (
              <Button onClick={() => setTab('access')} title="لا يوجد موبايل لصاحب المحل" className="!px-3 !whitespace-normal leading-tight">
                <MessageCircle size={15} className="hidden sm:block" /> أضف صاحب المحل
              </Button>
            )}
            <div className="min-w-0">
              <BotPauseControl accountId={biz.id} name={biz.name} enabled={botEnabled} resumeAt={resumeAt} onChange={onBotChange} compact />
            </div>
            <MoreMenu accountId={biz.id} status={biz.status} onSuspend={suspend} onTry={() => setTab('knowledge')} />
          </div>
        </div>

        <div className="flex flex-wrap gap-x-[18px] gap-y-1.5 text-sm text-shift-body">
          {owner ? (
            <span>
              {owner.first_name || 'صاحب المحل'}
              {owner.phone && <> · <Ltr>{maskPhone(owner.phone)}</Ltr></>}
            </span>
          ) : <button type="button" onClick={() => setTab('access')} className="min-h-[32px] text-shift-accent hover:text-shift-ink">لا يوجد صاحب محل — أضفه من «الدخول»</button>}
          {row?.display_phone && (
            <span>
              رقم المحل <Ltr>{row.display_phone}</Ltr>
              {row.verified_name && <> · الاسم عند Meta «{row.verified_name}»{nameStatus && NAME_STATUS[nameStatus] ? ` ${NAME_STATUS[nameStatus]}` : ''}</>}
            </span>
          )}
          {row && <span>واتساب: {row.wa.label}</span>}
        </div>

        {(row || (biz.status && biz.status !== 'active')) && (
          <div className="flex flex-wrap gap-1.5">
            {row?.stage_ar && <Pill>التفعيل: {row.stage_ar}</Pill>}
            {row && (
              <Pill tone={botEnabled ? STATE_PILL[row.bot.state] : 'warn'}>
                الخدمة: {botEnabled ? row.bot.label : `الرد الآلي متوقف${resumeAt ? ` ${resumeLabel(resumeAt)}` : ''} · الرسائل تصل`}
              </Pill>
            )}
            {row && <Pill tone={SUB_PILL[row.sub.tone] || 'neutral'}>الاشتراك: {row.sub.label}</Pill>}
            {biz.status && biz.status !== 'active' && <Pill tone="bad">الحساب {biz.status === 'suspended' ? 'موقوف' : 'غير نشط'}</Pill>}
          </div>
        )}
      </header>

      {urgent && (
        <section role="alert" className="flex flex-wrap items-center gap-3 p-3.5 sm:p-4 rounded-xl bg-white border border-shift-dangerLine border-s-[3px] border-s-[#D92D20]">
          <div className="flex-1 basis-72 min-w-0">
            <div className="flex items-center gap-2 font-semibold text-[15px] text-shift-ink"><Tag tone="critical" /> محادثة تحتاج تدخلًا</div>
            <div className="text-sm text-shift-body">{urgent.text}{urgent.since ? ` · ${relativeTime(urgent.since)}` : ''}</div>
          </div>
          <Button variant="primary" onClick={() => setConvOpen(true)} className="w-full sm:w-auto">افتح المحادثة</Button>
        </section>
      )}

      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm px-4 py-2 rounded-xl">{error}</div>}

      {/* Tabs: scroll sideways on a phone rather than wrap into two rows. */}
      <div role="tablist" aria-label="أقسام الحساب" className="flex gap-0.5 border-b border-shift-line overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {TABS.map(([key, label]) => (
          <button key={key} type="button" role="tab" aria-selected={tab === key ? 'true' : 'false'} onClick={() => setTab(key)}
            className={`shrink-0 min-h-[44px] px-3.5 text-[14.5px] whitespace-nowrap border-b-2 -mb-px ${
              tab === key ? 'border-shift-ink text-shift-ink font-semibold' : 'border-transparent text-shift-body font-medium hover:text-shift-ink'}`}>
            {label}
          </button>
        ))}
      </div>

      <div role="tabpanel">
        {tab === 'health' && (
          <div className="flex flex-col gap-4">
            <ShopAttention items={items} owner={owner} onDone={loadOverview} />
            {/* Keyed on the pause so the agent state there is re-read after the switch. */}
            <AccountHealthTab key={`${biz.id}-${botEnabled}`} accountId={biz.id} row={row} botEnabled={botEnabled} />
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

      {convOpen && <ConversationDrawer key={convId || 'guess'} accountId={biz.id} conversationId={convId} ownerHref={urgentHref} onClose={closeConv} />}
    </div>
  );
}
