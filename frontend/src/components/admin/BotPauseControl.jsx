import { useState } from 'react';
import { Pause, Play } from 'lucide-react';
import api from '../../utils/api';
import { StatusDot } from '../shared/Primitives';

/**
 * «أوقف البوت مؤقتًا» / «شغّل البوت» — the one switch for a shop's bot.
 *
 * It replaces the «تفعيل الذكاء الاصطناعي» checkbox, which was saved with the whole AI form: a
 * stale form could switch a paused bot back on, and nothing recorded why it was off. This calls
 * PATCH /api/admin/accounts/:id/bot on its own, and a pause asks for its reason here, in the
 * page, because the reason goes into the account's log for whoever looks next.
 *
 * Pausing stops the bot's replies only; the shop's inbox and alerts keep working.
 */
export default function BotPauseControl({ accountId, enabled, onChange, compact = false }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const send = async (next) => {
    if (!next && !reason.trim()) { setError('اكتب سبب الإيقاف'); return; }
    setBusy(true); setError('');
    try {
      const res = await api.patch(`/admin/accounts/${accountId}/bot`, { enabled: next, reason: reason.trim() || undefined });
      setAsking(false); setReason('');
      onChange?.(res.data.enabled);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تغيير حالة البوت');
    } finally { setBusy(false); }
  };

  return (
    <div className={compact ? 'flex flex-col items-end gap-1.5' : 'space-y-2'}>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="inline-flex items-center gap-1.5 text-[13px] text-gray-700">
          <StatusDot state={enabled ? 'ok' : 'paused'} title={enabled ? 'البوت يعمل' : 'موقوف مؤقتًا'} />
          {enabled ? 'البوت يعمل' : 'البوت موقوف مؤقتًا'}
        </span>
        {enabled ? (
          !asking && (
            <button type="button" onClick={() => { setAsking(true); setError(''); }}
              className="inline-flex items-center gap-1 border border-gray-200 text-gray-800 px-2.5 h-7 rounded-md text-[12px] hover:border-gray-300 hover:bg-gray-50">
              <Pause size={12} /> أوقف البوت مؤقتًا
            </button>
          )
        ) : (
          <button type="button" onClick={() => send(true)} disabled={busy}
            className="inline-flex items-center gap-1 bg-gray-900 text-white px-2.5 h-7 rounded-md text-[12px] hover:bg-gray-800 disabled:opacity-50">
            <Play size={12} /> {busy ? 'جارٍ…' : 'شغّل البوت'}
          </button>
        )}
      </div>

      {asking && enabled && (
        <div className="flex items-center gap-2 flex-wrap w-full max-w-md">
          <input
            autoFocus
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') send(false); if (e.key === 'Escape') setAsking(false); }}
            maxLength={300}
            placeholder="سبب الإيقاف (مثلًا: تأخر الدفع، طلب صاحب المحل)"
            className="flex-1 min-w-[200px] h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
          />
          <button type="button" onClick={() => send(false)} disabled={busy || !reason.trim()}
            className="bg-red-600 text-white px-3 h-8 rounded-md text-[12px] hover:bg-red-700 disabled:opacity-40">
            {busy ? 'جارٍ…' : 'أوقف'}
          </button>
          <button type="button" onClick={() => { setAsking(false); setReason(''); setError(''); }}
            className="text-[12px] text-gray-500 hover:text-gray-800">
            إلغاء
          </button>
        </div>
      )}
      {asking && enabled && (
        <p className="text-[11px] text-gray-400">تتوقف ردود البوت فقط؛ رسائل الزبائن تبقى تصل لصندوق المحل وتنبيهاته.</p>
      )}
      {error && <p className="text-red-500 text-xs">{error}</p>}
    </div>
  );
}
