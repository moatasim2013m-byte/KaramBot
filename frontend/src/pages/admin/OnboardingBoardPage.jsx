import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Copy, MessageCircle, Plus, Send, XCircle } from 'lucide-react';
import api from '../../utils/api';
import { EmptyState, Freshness, Ltr, Panel, SkeletonRows, Timestamp, relativeTime } from '../../components/shared/Primitives';

/**
 * «الانضمام» — /admin/onboarding, the October campaign board (docs/panels/spec.md, «Operator
 * panel»).
 *
 * Where each invited shop is between the link and «يعمل», who is stuck and why. The stage is
 * derived on the server from stored data and AccountEvents and never stored, so this page only
 * draws what GET /api/admin/onboarding says. Below the board: every Meta attempt, including the
 * abandoned ones that left no trace before, and a pointer to «ربط بدون حساب».
 *
 * RTL six columns on a wide screen; on a phone the same columns stack as a list grouped by stage.
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
  اكتمل: 'text-emerald-700', خطأ: 'text-red-700', 'تعارض رقم': 'text-red-700',
  'رقم لا يخص الحساب': 'text-red-700', 'بحاجة لشِفت': 'text-amber-700',
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

function StageCard({ card, stage, busy, onResend, onRevoke }) {
  const wa = ownerWaLink(card);
  return (
    <li className={`rounded-lg border bg-white p-3 ${card.stuck ? 'border-red-200 border-r-4 border-r-red-500' : 'border-gray-200'}`}>
      <div className="flex items-start justify-between gap-2">
        <Link to={`/admin/accounts/${card.account_id}`} className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-gray-900 hover:underline">{card.name}</p>
          <p className="text-[12px] text-gray-500">
            {card.owner_first_name || '—'} · <span title={card.since ? new Date(card.since).toLocaleString('ar-JO') : ''}>{relativeTime(card.since)}</span>
          </p>
        </Link>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {card.needs_operator && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">بحاجة لشِفت</span>
          )}
          {stage === 'invite_sent' && card.opened && (
            <span className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium text-blue-700">فتحه</span>
          )}
        </div>
      </div>

      {card.last_es_step_ar && (
        <p className="mt-1.5 text-[12px] text-gray-700">توقف عند: {card.last_es_step_ar}</p>
      )}
      {card.stuck && card.reason_ar && (
        <p className="mt-1 flex items-start gap-1 text-[12px] text-red-700">
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {card.reason_ar}
        </p>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        {wa ? (
          <a href={wa} target="_blank" rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 h-8 text-[12px] text-gray-700 hover:bg-gray-50">
            <MessageCircle size={12} /> راسله
          </a>
        ) : (
          <Link to={`/admin/accounts/${card.account_id}`}
            className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 h-8 text-[12px] text-gray-700 hover:bg-gray-50">
            <MessageCircle size={12} /> راسله
          </Link>
        )}
        {/* A link can be reissued or withdrawn only before the owner signs in: after that the
            server answers 409, so the buttons are not offered past the first column. */}
        {stage === 'invite_sent' && (
          <>
            <button type="button" disabled={busy} onClick={() => onResend(card)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 h-8 text-[12px] text-gray-700 hover:bg-gray-50 disabled:opacity-50">
              <Send size={12} /> أعد إرسال الرابط
            </button>
            <button type="button" disabled={busy} onClick={() => onRevoke(card)}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200 px-2 h-8 text-[12px] text-red-700 hover:bg-red-50 disabled:opacity-50">
              <XCircle size={12} /> ألغِ الدعوة
            </button>
          </>
        )}
      </div>
    </li>
  );
}

function SessionId({ id }) {
  const [copied, setCopied] = useState(false);
  if (!id) return <span className="text-gray-400">—</span>;
  return (
    <button type="button" title="نسخ"
      onClick={async () => { if (await copyText(id)) { setCopied(true); setTimeout(() => setCopied(false), 1500); } }}
      className="inline-flex items-center gap-1 font-mono text-[11px] text-gray-600 hover:text-gray-900">
      <Ltr className="max-w-[9rem] truncate">{id}</Ltr>
      <Copy size={11} /> {copied && <span className="font-sans text-emerald-700">نُسخ</span>}
    </button>
  );
}

export default function OnboardingBoardPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const [at, setAt] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [notice, setNotice] = useState(null);

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

  const byStage = Object.fromEntries((data?.columns || []).map((c) => [c.stage, c]));
  const columns = STAGES.map(([stage, label]) => ({
    stage,
    label_ar: byStage[stage]?.label_ar || label,
    cards: byStage[stage]?.cards || [],
  }));
  const total = columns.reduce((n, c) => n + c.cards.length, 0);
  const attempts = data?.attempts || [];
  const orphans = data?.orphans_count || 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">الانضمام</h1>
          <p className="text-xs text-gray-500 mt-0.5">أين كل محل بين رابط الانضمام و«يعمل»، ومن عالق ولماذا.</p>
        </div>
        <div className="flex items-center gap-3">
          <Freshness at={at} onRefresh={load} loading={loading} />
          <Link to="/admin/accounts/new"
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-3 h-9 text-sm text-white hover:bg-green-700">
            <Plus size={15} /> زبون جديد
          </Link>
        </div>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      {notice && (
        <p className={`rounded-lg px-4 py-3 text-sm ${notice.tone === 'ok' ? 'bg-emerald-50 text-emerald-800' : 'bg-red-50 text-red-700'}`}>{notice.text}</p>
      )}

      {orphans > 0 && (
        <Link to="/admin/overview" className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 hover:bg-amber-100">
          <AlertTriangle size={15} />
          <span>ربط بدون حساب: {orphans} — افتح «نظرة عامة» لربطه بزبون</span>
        </Link>
      )}

      {!data && loading ? (
        <Panel><SkeletonRows rows={4} cols={6} /></Panel>
      ) : data && total === 0 ? (
        <Panel>
          <EmptyState tone="neutral" title="لا محلات في الانضمام بعد" hint="أنشئ «زبون جديد» وأرسل له الرابط، وتظهر بطاقته هنا." />
        </Panel>
      ) : data ? (
        // RTL grid: the first stage sits on the right. Below lg, one column per row (a list
        // grouped by stage), which is how it reads on a phone.
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-6">
          {columns.map((col) => (
            <section key={col.stage} className="rounded-lg bg-gray-100/70 p-2">
              <header className="flex items-center justify-between px-1 pb-2">
                <h2 className="text-[13px] font-semibold text-gray-700">{col.label_ar}</h2>
                <span className="text-[12px] tabular-nums text-gray-500">{col.cards.length}</span>
              </header>
              {col.cards.length === 0 ? (
                <p className="px-1 pb-1 text-[12px] text-gray-400">—</p>
              ) : (
                <ul className="space-y-2">
                  {col.cards.map((card) => (
                    <StageCard key={card.account_id} card={card} stage={col.stage}
                      busy={busyId === card.account_id} onResend={resend} onRevoke={revoke} />
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      ) : null}

      <Panel title={`محاولات الربط مع Meta${attempts.length ? ` · ${attempts.length}` : ''}`}>
        {!data && loading ? (
          <SkeletonRows rows={3} cols={6} />
        ) : attempts.length === 0 ? (
          <EmptyState tone="neutral" title="لا محاولات بعد" hint="كل ضغطة على «اربط واتساب» تظهر هنا، حتى التي لم تكتمل." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-[13px]">
              <thead>
                <tr className="border-b border-gray-100 text-right text-[12px] text-gray-500">
                  <th className="px-4 py-2 font-medium">الوقت</th>
                  <th className="px-4 py-2 font-medium">الزبون</th>
                  <th className="px-4 py-2 font-medium">بدأها</th>
                  <th className="px-4 py-2 font-medium">النتيجة</th>
                  <th className="px-4 py-2 font-medium">الخطوة</th>
                  <th className="px-4 py-2 font-medium">الخطأ</th>
                  <th className="px-4 py-2 font-medium">رمز جلسة Meta</th>
                </tr>
              </thead>
              <tbody>
                {attempts.map((a, i) => {
                  const result = resultLabel(a.result_ar || a.result);
                  return (
                    <tr key={`${a.account_id}-${a.at}-${i}`} className="border-b border-gray-50 align-top">
                      <td className="px-4 py-2 whitespace-nowrap text-gray-600"><Timestamp value={a.at} /></td>
                      <td className="px-4 py-2">
                        {a.account_id
                          ? <Link to={`/admin/accounts/${a.account_id}`} className="text-gray-900 hover:underline">{a.name || '—'}</Link>
                          : <span className="text-gray-900">{a.name || '—'}</span>}
                      </td>
                      <td className="px-4 py-2 text-gray-700">{a.started_by_ar || '—'}</td>
                      <td className={`px-4 py-2 font-medium ${RESULT_TONE[result] || 'text-gray-700'}`}>{result}</td>
                      <td className="px-4 py-2 text-gray-700">{a.step_ar || '—'}</td>
                      <td className="px-4 py-2 text-gray-700">{a.error_ar || '—'}</td>
                      <td className="px-4 py-2"><SessionId id={a.session_id} /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
