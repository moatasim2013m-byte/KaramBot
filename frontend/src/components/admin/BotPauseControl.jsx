import { useEffect, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import api from '../../utils/api';
import { Button, Pill, chipClass, fieldClass, labelClass } from './ui';

/**
 * «أوقف الرد الآلي» / «شغّل الرد الآلي» — the one switch for a shop's bot.
 *
 * It replaces the «تفعيل الذكاء الاصطناعي» checkbox, which was saved with the whole AI form: a
 * stale form could switch a paused bot back on, and nothing recorded why it was off. This calls
 * PATCH /api/admin/accounts/:id/bot on its own, and a pause is confirmed in a dialog that asks
 * for its reason, because the reason goes into the account's log for whoever looks next.
 *
 * Pausing stops the bot's replies only; the shop's inbox and alerts keep working.
 */

// [id, label, duration_minutes]. A timed pause is lifted by the server's minute sweep
// (shiftSweeper.sweepBotPauses), so it ends on time even with every panel closed.
const DURATIONS = [
  ['manual', 'حتى أعيد تشغيله', null],
  ['30', '30 دقيقة', 30],
];

/**
 * When SHIFT's timed pause ends, from a shop's ai_config: the same rule as the server's
 * accountHealth.botResumeAt (the owner's pause and the late policy's have no end time here).
 */
export function pauseResumeAt(aiConfig) {
  const c = aiConfig || {};
  if (c.enabled !== false || c.paused_by !== 'shift' || c.pause_reason || typeof c.resume_at !== 'string') return null;
  return Number.isNaN(Date.parse(c.resume_at)) ? null : c.resume_at;
}

/** «حتى 14:30», Amman time; an end that has passed reads as due, since the sweep lifts it within the minute. */
export function resumeLabel(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  if (d.getTime() <= Date.now()) return 'يعود خلال دقيقة';
  return `حتى ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Amman' })}`;
}

/** The pause confirmation. Also opened by FixButton's «أوقف البوت مؤقتًا». */
export function PauseDialog({ accountId, name, initialReason = '', onClose, onPaused }) {
  const [reason, setReason] = useState(initialReason);
  const [duration, setDuration] = useState('manual');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const confirm = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { setError('اكتب سبب الإيقاف'); return; }
    setBusy(true); setError('');
    try {
      const minutes = (DURATIONS.find(([id]) => id === duration) || [])[2];
      const body = { enabled: false, reason: reason.trim().slice(0, 300), ...(minutes ? { duration_minutes: minutes } : {}) };
      const res = await api.patch(`/admin/accounts/${accountId}/bot`, body);
      onPaused?.(res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إيقاف البوت');
      setBusy(false);
    }
  };

  return (
    // Clicks stop here: the dialog can be opened from inside a clickable attention row.
    <div className="fixed inset-0 z-[60] bg-shift-ink/35 grid place-items-center p-4"
      onMouseDown={() => { if (!busy) onClose(); }} onClick={(e) => e.stopPropagation()}>
      <form role="dialog" aria-modal="true" aria-labelledby="pause-title" onSubmit={confirm}
        onMouseDown={(e) => e.stopPropagation()}
        className="w-full max-w-[440px] bg-white rounded-2xl p-[22px] flex flex-col gap-3 shadow-[0_18px_44px_-20px_rgba(15,30,56,.45)] text-right">
        <h2 id="pause-title" className="m-0 font-display text-lg font-semibold text-shift-ink">
          إيقاف الرد الآلي{name ? ` لـ${name}` : ''}؟
        </h2>
        <p className="m-0 text-sm text-shift-body">ستصل الرسائل، لكن البوت لن يرد عليها. تبقى تصل لصندوق المحل وتنبيهاته.</p>
        <div role="radiogroup" aria-label="المدة" className="flex flex-wrap gap-2">
          {DURATIONS.map(([id, label]) => (
            <button key={id} type="button" role="radio" aria-checked={id === duration ? 'true' : 'false'}
              onClick={() => setDuration(id)} disabled={busy} className={chipClass(id === duration)}>
              {label}
            </button>
          ))}
        </div>
        {duration !== 'manual' && <p className="m-0 -mt-1 text-[12.5px] text-shift-muted">يعود البوت للرد وحده بعد انتهاء المدة، ويُسجَّل ذلك في السجل.</p>}
        <label htmlFor="pause-reason" className={labelClass}>السبب (يظهر في السجل)</label>
        <input id="pause-reason" autoFocus value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300}
          placeholder="مثلًا: شكوى سعر خاطئ، تأخر الدفع، طلب صاحب المحل" className={fieldClass} />
        {error && <p role="alert" className="m-0 text-[13px] text-shift-danger">{error}</p>}
        <div className="flex flex-wrap justify-end gap-2">
          <Button onClick={onClose} disabled={busy}>إلغاء</Button>
          <button type="submit" disabled={busy || !reason.trim()}
            className="inline-flex items-center justify-center min-h-[44px] px-4 rounded-xl bg-shift-danger text-white text-sm font-semibold hover:bg-[#912018] disabled:opacity-50">
            {busy ? 'جارٍ…' : 'أوقف الرد الآلي'}
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * `resumeAt` is when SHIFT's timed pause ends (the server's bot_resume_at), shown as «حتى 14:30».
 * onChange(enabled, data) gets the route's answer too, whose resume_at a timed pause carries.
 */
export default function BotPauseControl({ accountId, enabled, onChange, compact = false, name, resumeAt = null }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Resuming needs no reason and puts nothing at risk, so it is one click.
  const resume = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.patch(`/admin/accounts/${accountId}/bot`, { enabled: true });
      onChange?.(res.data.enabled, res.data);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تغيير حالة البوت');
    } finally { setBusy(false); }
  };

  // In the header (compact) it shares a phone row with «راسل صاحب المحل», so it sheds its icon there.
  const fit = compact ? 'w-full sm:w-auto !px-3 !whitespace-normal leading-tight' : '';
  const icon = compact ? 'hidden sm:block' : '';
  const until = enabled ? '' : resumeLabel(resumeAt);
  const button = enabled ? (
    <Button variant="danger" onClick={() => { setAsking(true); setError(''); }} className={fit}>
      <Pause size={15} className={icon} /> أوقف الرد الآلي
    </Button>
  ) : (
    <Button variant="primary" onClick={resume} disabled={busy} className={fit} title={until ? `موقوف ${until}` : undefined}>
      <Play size={15} className={icon} /> {busy ? 'جارٍ…' : 'شغّل الرد الآلي'}
    </Button>
  );

  return (
    <>
      {compact ? button : (
        <div className="flex flex-wrap items-center gap-3">
          {enabled ? <Pill tone="ok">يرد الآن</Pill> : <Pill tone="warn">الرد الآلي متوقف{until ? ` ${until}` : ''} · الرسائل تصل</Pill>}
          {button}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[13px] text-shift-danger">{error}</p>}
      {asking && enabled && (
        <PauseDialog accountId={accountId} name={name} onClose={() => setAsking(false)}
          onPaused={(data) => { setAsking(false); onChange?.(data.enabled, data); }} />
      )}
    </>
  );
}
