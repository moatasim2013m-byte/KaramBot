import { useCallback, useEffect, useState } from 'react';
import { History } from 'lucide-react';
import api from '../../utils/api';
import { SkeletonRows, EmptyState } from '../shared/Primitives';
import { Card } from './ui';
import { eventTime, eventText } from './operatorView';

/**
 * «السجل» — what happened to this shop and who did it, newest first.
 *
 * GET /api/admin/events?business_id= merges the AccountEvents (the owner's steps, Meta's webhooks,
 * SHIFT's actions) with admin_access_logs, so «شِفت (معتصم) قرأ محادثة» sits in the same list as
 * the payment it was about. Older pages load with ?before= the oldest time shown.
 *
 * Two columns, when and what, with who did it in bold at the head of the what.
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
    <Card title="السجل">
      {error && <p role="alert" className="m-0 mb-2 px-3 py-2 rounded-lg text-[13px] text-shift-danger bg-shift-dangerBg">{error}</p>}
      {!events ? (error ? null : <SkeletonRows rows={6} cols={3} />) : events.length === 0 ? (
        <EmptyState icon={History} tone="neutral" title="لا شيء في السجل بعد" />
      ) : (
        <>
          <ul className="m-0 p-0 list-none text-sm">
            {events.map((e) => (
              <li key={e.id} className="grid grid-cols-[96px_minmax(0,1fr)] sm:grid-cols-[120px_minmax(0,1fr)] gap-x-4 py-2.5 border-t border-shift-line2">
                <span className="text-[13px] text-shift-muted tabular-nums" title={new Date(e.at || e.created_at).toLocaleString('ar-JO')}>
                  {eventTime(e.at || e.created_at)}
                </span>
                <span className="text-shift-ink min-w-0 break-words">
                  {e.actor_ar && <b className="font-semibold">{e.actor_ar} </b>}
                  {eventText(e)}
                </span>
              </li>
            ))}
          </ul>
          {more && (
            <div className="pt-2 border-t border-shift-line2">
              <button type="button" onClick={older} disabled={busy} className="min-h-[40px] px-2 text-[13.5px] text-shift-accent hover:text-shift-ink disabled:opacity-50">
                {busy ? 'جارٍ…' : 'أقدم'}
              </button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
