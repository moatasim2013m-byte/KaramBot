import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import api from '../../utils/api';
import { Panel, SkeletonRows, EmptyState } from '../shared/Primitives';
import { eventTime, eventText } from './operatorView';

/**
 * «السجل» — what happened to this shop and who did it, newest first.
 *
 * GET /api/admin/events?business_id= merges the AccountEvents (the owner's steps, Meta's webhooks,
 * SHIFT's actions) with admin_access_logs, so «شِفت (معتصم) قرأ محادثة» sits in the same list as
 * the payment it was about. Older pages load with ?before= the oldest time shown.
 */

const PAGE = 50;

export default function AccountLogTab({ accountId }) {
  const [events, setEvents] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const fetchPage = useCallback(async (before) => {
    const res = await api.get('/admin/events', { params: { business_id: accountId, limit: PAGE, ...(before ? { before } : {}) } });
    return res.data?.events || [];
  }, [accountId]);

  useEffect(() => {
    setEvents(null); setError(null);
    fetchPage(null)
      .then((rows) => { setEvents(rows); setMore(rows.length >= PAGE); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل السجل'));
  }, [fetchPage]);

  const older = async () => {
    const last = events?.[events.length - 1];
    if (!last) return;
    setBusy(true);
    try {
      const rows = await fetchPage(last.at || last.created_at);
      const seen = new Set(events.map((e) => e.id));
      setEvents([...events, ...rows.filter((e) => !seen.has(e.id))]);
      setMore(rows.length >= PAGE);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تحميل المزيد');
    } finally { setBusy(false); }
  };

  return (
    <Panel title="السجل">
      {error && <p className="px-4 py-2 text-[13px] text-red-700 bg-red-50 border-b border-red-100">{error}</p>}
      {!events ? (error ? null : <SkeletonRows rows={6} cols={3} />) : events.length === 0 ? (
        <EmptyState icon={History} tone="neutral" title="لا شيء في السجل بعد" />
      ) : (
        <>
          <ul className="divide-y divide-gray-50">
            {events.map((e) => (
              <li key={e.id} className="flex items-baseline gap-3 px-4 py-2 text-[13px]">
                <span className="w-28 shrink-0 text-[12px] text-gray-400 tabular-nums" title={new Date(e.at || e.created_at).toLocaleString('ar-JO')}>
                  {eventTime(e.at || e.created_at)}
                </span>
                {e.actor_ar && <span className="shrink-0 text-[12px] text-gray-500">{e.actor_ar}</span>}
                <span className="text-gray-800 min-w-0">{eventText(e)}</span>
              </li>
            ))}
          </ul>
          {more && (
            <div className="px-4 py-3 border-t border-gray-100">
              <button type="button" onClick={older} disabled={busy} className="text-[12px] text-gray-600 underline underline-offset-2 disabled:opacity-40">
                {busy ? 'جارٍ…' : 'أقدم'}
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}
