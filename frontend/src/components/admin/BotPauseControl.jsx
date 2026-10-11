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

// The route takes {enabled, reason} only. A timed pause («30 دقيقة») needs the server to lift it,
// so it is shown and not offered until the route accepts a duration.
const DURATIONS = [
  ['manual', 'حتى أعيد تشغيله', true],
  ['30', '30 دقيقة', false],
];

/** The pause confirmation. Also opened by FixButton's «أوقف البوت مؤقتًا». */
export function PauseDialog({ accountId, name, initialReason = '', onClose, onPaused }) {
  const [reason, setReason] = useState(initialReason);
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
      const res = await api.patch(`/admin/accounts/${accountId}/bot`, { enabled: false, reason: reason.trim().slice(0, 300) });
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
          {DURATIONS.map(([id, label, supported]) => (
            <button key={id} type="button" role="radio" aria-checked={id === 'manual' ? 'true' : 'false'}
              disabled={!supported} className={`${chipClass(id === 'manual')} disabled:opacity-50 disabled:cursor-not-allowed`}>
              {label}
            </button>
          ))}
        </div>
        <p className="m-0 -mt-1 text-[12.5px] text-shift-muted">الإيقاف لمدة محددة غير متاح بعد: أعد التشغيل بنفسك.</p>
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

export default function BotPauseControl({ accountId, enabled, onChange, compact = false, name }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Resuming needs no reason and puts nothing at risk, so it is one click.
  const resume = async () => {
    setBusy(true); setError('');
    try {
      const res = await api.patch(`/admin/accounts/${accountId}/bot`, { enabled: true });
      onChange?.(res.data.enabled);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تغيير حالة البوت');
    } finally { setBusy(false); }
  };

  // In the header (compact) it shares a phone row with «راسل صاحب المحل», so it sheds its icon there.
  const fit = compact ? 'w-full sm:w-auto !px-3 !whitespace-normal leading-tight' : '';
  const icon = compact ? 'hidden sm:block' : '';
  const button = enabled ? (
    <Button variant="danger" onClick={() => { setAsking(true); setError(''); }} className={fit}>
      <Pause size={15} className={icon} /> أوقف الرد الآلي
    </Button>
  ) : (
    <Button variant="primary" onClick={resume} disabled={busy} className={fit}>
      <Play size={15} className={icon} /> {busy ? 'جارٍ…' : 'شغّل الرد الآلي'}
    </Button>
  );

  return (
    <>
      {compact ? button : (
        <div className="flex flex-wrap items-center gap-3">
          {enabled ? <Pill tone="ok">يرد الآن</Pill> : <Pill tone="warn">الرد الآلي متوقف · الرسائل تصل</Pill>}
          {button}
        </div>
      )}
      {error && <p role="alert" className="mt-1 text-[13px] text-shift-danger">{error}</p>}
      {asking && enabled && (
        <PauseDialog accountId={accountId} name={name} onClose={() => setAsking(false)}
          onPaused={(data) => { setAsking(false); onChange?.(data.enabled); }} />
      )}
    </>
  );
}
