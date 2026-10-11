import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Copy, CreditCard, Link2, MessageCircle, Plus, Send, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { EmptyState, Freshness, SkeletonRows, Timestamp, relativeTime } from '../../components/shared/Primitives';
import { Card, Footnote, PageHeader, Pill, Tag, btnClass } from '../../components/admin/ui';
import { cardActions, cardBadges, cardLines, cardNextActor } from './boardCardView';

/**
 * «الانضمام» — /admin/onboarding, the October campaign board (docs/panels/spec.md, «Operator
 * panel»).
 *
 * Where each invited shop is between the link and «يعمل», who acts next and why. The stage is
 * derived on the server from stored data and AccountEvents and never stored, so this page only
 * draws what GET /api/admin/onboarding says.
 *
 * Two views of the same cards: «قائمة» (the default, ?view=list) is every shop not yet live, one
 * row each with its step, who the next move belongs to and that move first; «لوحة» (?view=board)
 * is the six stage columns, scrolling sideways inside their own strip on a phone. Below both, the
 * Meta attempts, collapsed: they are for diagnosing a stuck connect, not for the daily read.
 */

// The board's order, right to left. The server sends the label too; this is the fallback and the
// order when a column comes back empty or missing.
const STAGES = [
  ['invite_sent', 'أُرسل الرابط'],
  ['connecting', 'يربط واتساب'],
  ['awaiting_card', 'بانتظار البطاقة'],
  ['teaching', 'يعلّم البوت'],
  ['awaiting_first_customer', 'بانتظار أول زبون'],
  ['live', 'يعمل'],
];

// The server's result codes, read in Arabic. An unknown code shows as a dash, never raw.
const RESULT_AR = {
  connected: 'اكتمل',
  completed: 'اكتمل',
  cancelled: 'أُلغي',
  canceled: 'أُلغي',
  error: 'خطأ',
  failed: 'خطأ',
  conflict: 'تعارض رقم',
  number_taken: 'تعارض رقم',
  needs_operator: 'بحاجة لشِفت',
  started: 'بدأ',
  ownership_mismatch: 'رقم لا يخص الحساب',
};
const RESULT_TONE = {
  اكتمل: 'text-shift-ok', خطأ: 'text-shift-danger', 'تعارض رقم': 'text-shift-danger',
  'رقم لا يخص الحساب': 'text-shift-danger', 'بحاجة لشِفت': 'text-shift-warn', 'أُلغي': 'text-shift-warn',
};
const hasArabic = (s) => /[؀-ۿ]/.test(String(s || ''));
function resultLabel(r) {
  if (RESULT_AR[r]) return RESULT_AR[r];
  return hasArabic(r) ? r : '—';
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function ownerWaLink(card) {
  const digits = String(card.owner_phone || '').replace(/\D/g, '');
  if (!digits) return null;
  const hi = card.owner_first_name ? `مرحبًا ${card.owner_first_name}، ` : 'مرحبًا، ';
  return `https://wa.me/${digits}?text=${encodeURIComponent(`${hi}معك شِفت بخصوص تفعيل كرم بوت لـ${card.name}.`)}`;
}

/**
 * Who the next move belongs to (the server's next_actor, through cardNextActor), and which of
 * cardActions is that move. Everything else cardActions offers stays on the row, after it.
 */
function nextMove(card, stage) {
  const kinds = cardActions(card, stage).map((a) => a.kind);
  const who = cardNextActor(card, stage);
  if (card.payment_claimed) return { who, primary: 'confirm_card' };
  if (who === 'shift' && stage === 'invite_sent') return { who, primary: 'resend' };
  if (who === 'shift' && kinds.includes('connect_with')) return { who, primary: 'connect_with' };
  return { who, primary: 'message' };
}

const WHO_AR = { shift: 'شِفت', owner: 'صاحب المحل' };

const ACTION_BTN = `${btnClass('secondary', 'sm')} !min-h-[40px]`;

/** One of cardActions as a button or a link. `primary` gets the full-weight outline. */
function ActionButton({ action, card, busy, primary, onResend, onRevoke, onConfirmCard }) {
  const cls = primary ? ACTION_BTN : `${ACTION_BTN} !border-shift-line !text-shift-body`;
  if (action.kind === 'message') {
    const wa = ownerWaLink(card);
    return wa ? (
      <a href={wa} target="_blank" rel="noopener noreferrer" className={cls}><MessageCircle size={14} /> {action.label}</a>
    ) : (
      <Link to={`/admin/accounts/${card.account_id}`} className={cls}><MessageCircle size={14} /> {action.label}</Link>
    );
  }
  // A link can be reissued or withdrawn only before the owner signs in: after that the server
  // answers 409, so these are offered in the first stage only (cardActions).
  if (action.kind === 'resend') {
    return <button type="button" disabled={busy} onClick={() => onResend(card)} className={cls}><Send size={14} /> {action.label}</button>;
  }
  if (action.kind === 'revoke') {
    return (
      <button type="button" disabled={busy} onClick={() => onRevoke(card)}
        className={`${btnClass('danger', 'sm')} !min-h-[40px] !font-medium`}><XCircle size={14} /> {action.label}</button>
    );
  }
  if (action.kind === 'connect_with') {
    return <Link to={action.to} className={cls}><Link2 size={14} /> {action.label}</Link>;
  }
  if (action.kind === 'confirm_card') {
    return <button type="button" disabled={busy} onClick={() => onConfirmCard(card)} className={cls}><CreditCard size={14} /> {action.label}</button>;
  }
  return null;
}

function Actions({ card, stage, primary, ...handlers }) {
  const actions = cardActions(card, stage);
  const ordered = [...actions.filter((a) => a.kind === primary), ...actions.filter((a) => a.kind !== primary)];
  return (
    <div className="flex flex-wrap gap-1.5">
      {ordered.map((a, i) => <ActionButton key={a.kind} action={a} card={card} primary={i === 0} {...handlers} />)}
    </div>
  );
}

// cardBadges as written tags: «بحاجة لشِفت» and the unconfirmed card are warnings, «فتحه» is info.
const BADGE_TONE = { needs_operator: 'warning', payment_claimed: 'warning', opened: 'info' };

function Badges({ card, stage }) {
  const badges = cardBadges(card, stage);
  return (
    <>
      {card.stuck && <Tag tone="warning">بحاجة لمتابعة</Tag>}
      {badges.map((b) => <Tag key={b.kind} tone={BADGE_TONE[b.kind] || 'info'}>{b.label}</Tag>)}
    </>
  );
}

/** The step's detail: the server's «توقف عند: …» line, else why the card sits where it is. */
function StepDetail({ card }) {
  const lines = cardLines(card);
  const detail = lines.step || card.reason_ar;
  return (
    <>
      {detail && <p className="mt-0.5 text-[13px] text-shift-body">{detail}</p>}
      {lines.step && lines.reason && (
        <p className="mt-0.5 flex items-start gap-1 text-[13px] text-shift-danger">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {lines.reason}
        </p>
      )}
    </>
  );
}

const sinceTitle = (card) => (card.since ? new Date(card.since).toLocaleString('ar-JO') : '');

/** «قائمة»: who acts next, the shops that need a follow-up first and the oldest first among them. */
function NextList({ rows, handlers, busyId }) {
  return (
    <Card pad={false} className="overflow-x-auto">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <thead>
          <tr className="text-right text-[12.5px] text-shift-body">
            <th scope="col" className="px-[18px] py-3 font-semibold border-b border-shift-line">الزبون</th>
            <th scope="col" className="px-2.5 py-3 font-semibold border-b border-shift-line">الخطوة الحالية</th>
            <th scope="col" className="px-2.5 py-3 font-semibold border-b border-shift-line">المطلوب من</th>
            <th scope="col" className="px-2.5 py-3 font-semibold border-b border-shift-line">منذ</th>
            <th scope="col" className="ps-2.5 pe-[18px] py-3 font-semibold border-b border-shift-line">الإجراء التالي</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ card, stage, label, move }) => (
            <tr key={card.account_id} className="align-top hover:bg-shift-hover">
              <td className="px-[18px] py-3 border-b border-shift-line2">
                <Link to={`/admin/accounts/${card.account_id}`} className="font-semibold text-shift-ink no-underline hover:underline">{card.name}</Link>
                <div className="text-[12.5px] text-shift-body">{card.owner_first_name || '—'}</div>
              </td>
              <td className="px-2.5 py-3 border-b border-shift-line2">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-shift-ink">{label}</span>
                  <Badges card={card} stage={stage} />
                </div>
                <StepDetail card={card} />
              </td>
              <td className="px-2.5 py-3 border-b border-shift-line2 whitespace-nowrap">
                {move.who ? <Pill tone={move.who === 'shift' ? 'trial' : 'neutral'}>{WHO_AR[move.who]}</Pill> : '—'}
              </td>
              <td className="px-2.5 py-3 border-b border-shift-line2 whitespace-nowrap text-shift-body">
                <span title={sinceTitle(card)}>{relativeTime(card.since)}</span>
              </td>
              <td className="ps-2.5 pe-[18px] py-3 border-b border-shift-line2">
                <Actions card={card} stage={stage} primary={move.primary} busy={busyId === card.account_id} {...handlers} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

function StageCard({ card, stage, busy, handlers }) {
  return (
    <li className="flex flex-col gap-1 rounded-xl border border-shift-line bg-white p-3">
      <Link to={`/admin/accounts/${card.account_id}`} className="min-w-0 text-shift-ink no-underline">
        <b className="block truncate text-sm font-semibold hover:underline">{card.name}</b>
        <span className="text-[13px] text-shift-body">
          {card.owner_first_name || '—'} · <span title={sinceTitle(card)}>{relativeTime(card.since)}</span>
        </span>
      </Link>
      <div className="flex flex-wrap gap-1"><Badges card={card} stage={stage} /></div>
      {/* The server's line already says «توقف عند: …» or «فشل عند: …». */}
      <StepDetail card={card} />
      <div className="mt-1.5">
        <Actions card={card} stage={stage} primary={nextMove(card, stage).primary} busy={busy} {...handlers} />
      </div>
    </li>
  );
}

function Board({ columns, handlers, busyId }) {
  return (
    <>
      {/* RTL: the first stage sits on the right. The strip scrolls inside itself, never the page. */}
      <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1.5">
        {columns.map((col) => (
          <section key={col.stage} aria-label={col.label_ar}
            className="flex-[0_0_272px] snap-start rounded-2xl bg-shift-line2 p-3 flex flex-col gap-2">
            <h2 className="m-0 flex justify-between px-1 py-0.5 text-[13.5px] font-semibold text-shift-body">
              {col.label_ar} <span className="tabular-nums">{col.cards.length}</span>
            </h2>
            {col.cards.length === 0 ? (
              <p className="px-1 text-[13px] text-shift-muted">—</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {col.cards.map((card) => (
                  <StageCard key={card.account_id} card={card} stage={col.stage} busy={busyId === card.account_id} handlers={handlers} />
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
      <p className="m-0 text-[13px] text-shift-body">المراحل يحسبها النظام من البيانات؛ لا تُسحب البطاقات يدويًا.</p>
    </>
  );
}

function SessionId({ id }) {
  const [copied, setCopied] = useState(false);
  if (!id) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <bdi dir="ltr" className="font-mono text-[12.5px] text-shift-body select-all break-all">{id}</bdi>
      <button type="button"
        onClick={async () => { if (await copyText(id)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
        className={`${btnClass('secondary', 'sm')} !min-h-[36px] !text-[12.5px]`}>
        <Copy size={12} /> {copied ? 'نُسخ' : 'نسخ الرمز الكامل'}
      </button>
    </span>
  );
}

/** «تشخيص الربط مع Meta»: every attempt, including the abandoned ones, collapsed by default. */
function Attempts({ attempts, loading }) {
  return (
    <details className="rounded-2xl border border-shift-line bg-white px-[18px] py-3.5">
      <summary className="cursor-pointer min-h-[40px] flex items-center font-display text-base font-semibold text-shift-ink">
        تشخيص الربط مع Meta{attempts.length ? ` · ${attempts.length} محاولة` : ''}
      </summary>
      {loading ? (
        <SkeletonRows rows={3} cols={5} />
      ) : attempts.length === 0 ? (
        <EmptyState tone="neutral" title="لا محاولات بعد" hint="كل ضغطة على «اربط واتساب» تظهر هنا، حتى التي لم تكتمل." />
      ) : (
        <ul className="mt-2.5 flex flex-col text-sm">
          {attempts.map((a, i) => {
            const result = resultLabel(a.result_ar || a.result);
            return (
              <li key={`${a.account_id}-${a.at}-${i}`} className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-shift-line2 py-2.5">
                {a.account_id
                  ? <Link to={`/admin/accounts/${a.account_id}`} className="font-semibold text-shift-ink no-underline hover:underline">{a.name || '—'}</Link>
                  : <b className="font-semibold text-shift-ink">{a.name || '—'}</b>}
                <span className="text-shift-body">
                  <Timestamp value={a.at} />{a.started_by_ar && <> · بدأها {a.started_by_ar}</>}
                </span>
                <span className={`font-medium ${RESULT_TONE[result] || 'text-shift-body'}`}>{result}</span>
                {a.step_ar && <span className="text-shift-body">الخطوة: {a.step_ar}</span>}
                {a.error_ar && <span className="text-shift-danger">{a.error_ar}</span>}
                <SessionId id={a.session_id} />
              </li>
            );
          })}
        </ul>
      )}
    </details>
  );
}

export default function OnboardingBoardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'board' ? 'board' : 'list';

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/onboarding')
      .then((res) => { setData(res.data); setError(null); setAt(new Date().toISOString()); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل لوحة الانضمام'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const resend = async (card) => {
    // The new link is shared from SHIFT's own WhatsApp like the first. The tab is opened inside
    // the click (empty) and pointed at wa.me once the server answers, so no popup blocker eats it.
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null; // wa.me gets no handle back to this page
    setBusyId(card.account_id); setNotice(null);
    try {
      const res = await api.post(`/admin/accounts/${card.account_id}/join-link`);
      if (res.data?.wa_share_url && tab) tab.location.href = res.data.wa_share_url;
      else if (tab) tab.close();
      api.post(`/admin/accounts/${card.account_id}/events`, { type: 'invite_shared' }).catch(() => {});
      setNotice({ tone: 'ok', text: `رابط جديد لـ${card.name} — الرابط السابق لم يعد يعمل.` });
      load();
    } catch (err) {
      if (tab) tab.close();
      setNotice({ tone: 'error', text: err.response?.data?.error || 'تعذّر إصدار رابط جديد' });
    } finally {
      setBusyId(null);
    }
  };

  const revoke = async (card) => {
    if (!window.confirm(`إلغاء دعوة ${card.name}؟ يتوقف الرابط ويُعطَّل حساب صاحب المحل الذي لم يُستخدم.`)) return;
    setBusyId(card.account_id); setNotice(null);
    try {
      await api.delete(`/admin/accounts/${card.account_id}/invite`);
      setNotice({ tone: 'ok', text: `أُلغيت دعوة ${card.name}.` });
      load();
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.error || 'تعذّر إلغاء الدعوة' });
    } finally {
      setBusyId(null);
    }
  };

  // «رأيت البطاقة — أكّد»: the same confirmation as the account's «الحالة» tab, from the board.
  const confirmCard = async (card) => {
    if (!window.confirm(`هل رأيت بطاقة الدفع لـ${card.name} في WhatsApp Manager؟`)) return;
    setBusyId(card.account_id); setNotice(null);
    try {
      await api.patch(`/admin/accounts/${card.account_id}/payment-method`, { payment_method_ok: true });
      setNotice({ tone: 'ok', text: `أُكّدت بطاقة الدفع لـ${card.name}.` });
      load();
    } catch (err) {
      setNotice({ tone: 'error', text: err.response?.data?.error || 'تعذّر تأكيد البطاقة' });
    } finally {
      setBusyId(null);
    }
  };

  const handlers = { onResend: resend, onRevoke: revoke, onConfirmCard: confirmCard };

  const byStage = Object.fromEntries((data?.columns || []).map((c) => [c.stage, c]));
  const columns = STAGES.map(([stage, label]) => ({
    stage,
    label_ar: byStage[stage]?.label_ar || label,
    cards: byStage[stage]?.cards || [],
  }));
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  const liveCount = columns.find((c) => c.stage === 'live').cards.length;
  const attempts = data?.attempts || [];
  const orphans = data?.orphans_count || 0;

  // The list: every shop not yet live. «بحاجة لمتابعة» (the server's stuck: no progress for more
  // than a day) and SHIFT's own moves first, then the oldest.
  const rows = columns.filter((c) => c.stage !== 'live').flatMap((c) => c.cards.map((card) => ({
    card, stage: c.stage, label: c.label_ar, move: nextMove(card, c.stage),
  })));
  const rank = (r) => (r.card.stuck ? 0 : 2) + (r.move.who === 'shift' ? 0 : 1);
  const time = (r) => (r.card.since ? new Date(r.card.since).getTime() : Infinity);
  rows.sort((a, b) => rank(a) - rank(b) || time(a) - time(b));

  const setView = (v) => setParams((p) => { const n = new URLSearchParams(p); if (v === 'list') n.delete('view'); else n.set('view', v); return n; }, { replace: true });

  return (
    <div className="flex flex-col gap-[18px]">
      <PageHeader title="الانضمام"
        sub={data ? `${liveCount} اكتمل تفعيلها · ${total - liveCount} قيد التجهيز` : 'أين كل محل بين رابط الانضمام و«يعمل»، ومن عالق ولماذا.'}>
        <div role="group" aria-label="طريقة العرض" className="flex gap-1 rounded-xl bg-shift-line2 p-1">
          {[['list', 'قائمة'], ['board', 'لوحة']].map(([id, label]) => (
            <button key={id} type="button" aria-pressed={view === id ? 'true' : 'false'} onClick={() => setView(id)}
              className={`min-h-[36px] px-3.5 rounded-[9px] text-[13.5px] font-medium ${view === id
                ? 'bg-white text-shift-ink shadow-[0_1px_2px_rgba(15,30,56,.12)]' : 'bg-transparent text-shift-body hover:text-shift-ink'}`}>
              {label}
            </button>
          ))}
        </div>
        <Freshness at={at} onRefresh={load} loading={loading} />
        <Link to="/admin/accounts/new" className={btnClass('primary', 'md')}><Plus size={16} /> زبون جديد</Link>
      </PageHeader>

      {error && <p role="alert" className="m-0 rounded-xl border border-shift-dangerLine bg-shift-dangerBg px-4 py-3 text-sm text-shift-danger">{error}</p>}
      {notice && (
        <p role="status" className={`m-0 rounded-xl px-4 py-3 text-sm ${notice.tone === 'ok' ? 'bg-shift-okBg text-[#14532D]' : 'border border-shift-dangerLine bg-shift-dangerBg text-shift-danger'}`}>{notice.text}</p>
      )}

      {orphans > 0 && (
        <Link to="/admin/overview" className="flex flex-wrap items-center gap-2 rounded-xl border border-shift-line bg-white px-4 py-3 text-sm text-shift-ink no-underline hover:bg-shift-hover">
          <Tag tone="warning" />
          <span>ربط بدون حساب: {orphans} — افتح «نظرة عامة» لربطه بزبون</span>
        </Link>
      )}

      {!data && loading ? (
        <Card pad={false}><SkeletonRows rows={4} cols={5} /></Card>
      ) : data && total === 0 ? (
        <Card>
          <EmptyState tone="neutral" title="لا محلات في الانضمام بعد" hint="أنشئ «زبون جديد» وأرسل له الرابط، وتظهر بطاقته هنا." />
        </Card>
      ) : data && view === 'board' ? (
        <Board columns={columns} handlers={handlers} busyId={busyId} />
      ) : data ? (
        rows.length === 0 ? (
          <Card>
            <EmptyState tone="good" title="كل المحلات تعمل" hint="لا أحد في منتصف التفعيل. «لوحة» تعرض المحلات التي اكتملت." />
          </Card>
        ) : (
          <>
            <NextList rows={rows} handlers={handlers} busyId={busyId} />
            {liveCount > 0 && (
              <p className="m-0 text-[13px] text-shift-body">
                و{liveCount} اكتمل تفعيلها —{' '}
                <button type="button" onClick={() => setView('board')} className="min-h-[40px] bg-transparent border-0 p-0 text-shift-accent hover:text-shift-ink">في عرض اللوحة</button>
              </p>
            )}
          </>
        )
      ) : null}

      <Attempts attempts={attempts} loading={!data && loading} />

      <Footnote>«بحاجة لمتابعة»: لا تقدّم منذ أكثر من يوم.</Footnote>
    </div>
  );
}
