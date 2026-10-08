import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Receipt } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Num, Freshness, SkeletonRows, EmptyState } from '../../components/shared/Primitives';
import RecordPaymentDrawer from '../../components/admin/RecordPaymentDrawer';
import {
  BILLING_FILTERS, METHOD_AR, SUB_STATUS_AR, billingCsv, billingMatches, dayMonth, daysUntil, jod, usageTone,
} from '../../components/admin/operatorView';

/**
 * «الاشتراكات والدفعات» — /admin/billing, money across all shops, recorded by hand.
 *
 * CliQ, a bank transfer or cash: what is due, what came in, and whose free month ends. The strip
 * is the month in one line; the table is one row per shop with its live contract; «سجّل دفعة»
 * opens under the row (and opens by itself for ?pay=<shop> from «اليوم»). The CSV is generated
 * here, in the browser, from exactly the rows on screen.
 *
 * The late policy is the daily sweep's, not a button: after the grace days a late shop's bot is
 * paused by SHIFT with its inbox still working, and recording the payment here resumes it.
 */

const STATUS_TONE = {
  trial: 'text-gray-700', active: 'text-emerald-700', past_due: 'text-red-700', paused: 'text-amber-700',
  cancelled: 'text-gray-400', none: 'text-gray-400',
};
const TONE_TEXT = { ok: 'text-gray-700', warn: 'text-amber-700', bad: 'text-red-700', none: 'text-gray-400' };

function Totals({ totals }) {
  const t = totals || {};
  const cells = [
    ['المتوقع هذا الشهر', jod(t.expected_month_jod ?? 0), 'text-gray-900'],
    ['المحصّل', jod(t.collected_month_jod ?? 0), 'text-emerald-700'],
    ['متأخر', jod(t.overdue_jod ?? 0), Number(t.overdue_jod) > 0 ? 'text-red-700' : 'text-gray-900'],
    ['في الفترة المجانية', t.in_trial ?? 0, 'text-gray-900'],
  ];
  return (
    <div className="flex flex-wrap divide-x divide-x-reverse divide-gray-100 bg-white border border-gray-200 rounded-lg">
      {cells.map(([label, value, cls]) => (
        <div key={label} className="flex-1 min-w-[150px] px-4 py-3">
          <p className="text-[11px] text-gray-500">{label}</p>
          <p className={`text-[16px] font-semibold tabular-nums ${cls}`}>{value}</p>
        </div>
      ))}
    </div>
  );
}

function TrialEnds({ row }) {
  if (row.status !== 'trial' || !row.trial_ends_at) return <span className="text-gray-300">—</span>;
  const left = daysUntil(row.trial_ends_at);
  return (
    <span className={left !== null && left <= 3 ? 'text-amber-700' : 'text-gray-700'} title={new Date(row.trial_ends_at).toLocaleDateString('ar-JO')}>
      {dayMonth(row.trial_ends_at)}{left !== null && left >= 0 ? <span className="text-[11px] text-gray-400"> · باقي {left} ي</span> : null}
    </span>
  );
}

function NextDue({ row }) {
  if (!row.next_due_at) return <span className="text-gray-300">—</span>;
  const d = daysUntil(row.next_due_at);
  const late = d !== null && d < 0;
  return (
    <span className={late ? 'text-red-700' : 'text-gray-700'}>
      {dayMonth(row.next_due_at)}{late ? <span className="text-[11px]"> · متأخر {Math.abs(d)} ي</span> : null}
    </span>
  );
}

export default function BillingAdminPage() {
  const [params, setParams] = useSearchParams();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [filter, setFilter] = useState('all');
  const [at, setAt] = useState(null);
  const pay = params.get('pay');

  const load = useCallback(() => {
    setLoading(true);
    api.get('/admin/billing')
      .then((res) => { setData(res.data); setError(null); setAt(res.data?.generated_at || new Date().toISOString()); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الاشتراكات'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { load(); }, [load]);

  const all = data?.rows || [];
  const rows = useMemo(() => all.filter((r) => billingMatches(r, filter)), [all, filter]);
  const counts = useMemo(() => Object.fromEntries(BILLING_FILTERS.map(([k]) => [k, all.filter((r) => billingMatches(r, k)).length])), [all]);

  const openPay = (id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('pay', id); else next.delete('pay');
    setParams(next, { replace: true });
  };

  const exportCsv = () => {
    const blob = new Blob([billingCsv(rows)], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shift-billing-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <div className="space-y-4 max-w-[1400px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-bold text-gray-900">الاشتراكات والدفعات</h1>
          <p className="text-xs text-gray-500 mt-0.5">الدفعات تُسجَّل يدويًا: كليك، تحويل بنكي أو نقدًا</p>
        </div>
        <div className="flex items-center gap-3">
          <Freshness at={at} onRefresh={load} loading={loading} />
          <button type="button" onClick={exportCsv} disabled={!rows.length}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-gray-200 bg-white text-[13px] text-gray-700 hover:bg-gray-50 disabled:opacity-40">
            <Download size={14} /> تصدير CSV
          </button>
        </div>
      </div>

      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {notice && (
        <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-[13px] rounded-lg px-4 py-2.5">
          {notice} <button type="button" onClick={() => setNotice(null)} className="mr-3 text-[12px] underline">إخفاء</button>
        </div>
      )}

      <Totals totals={data?.totals} />

      <div className="flex flex-wrap items-center gap-2">
        {BILLING_FILTERS.map(([key, label]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
            className={`h-8 px-3 rounded-md text-[12px] ${filter === key ? 'bg-gray-900 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:border-gray-300'}`}>
            {label} (<Num>{counts[key] ?? 0}</Num>)
          </button>
        ))}
      </div>

      <Panel>
        {loading && !data ? <SkeletonRows rows={6} cols={6} /> : rows.length === 0 ? (
          <EmptyState icon={Receipt} tone="neutral" title={all.length ? 'لا نتائج مطابقة' : 'لا يوجد زبائن بعد'} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                  {['الزبون', 'الحالة', 'المبلغ', 'تنتهي المجانية', 'الاستحقاق القادم', 'آخر دفعة', 'الردود/الحد', ''].map((h) => (
                    <th key={h} className="text-right font-medium px-3 h-9 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((r) => {
                  const status = r.status || 'none';
                  const lp = r.last_payment;
                  const u = r.usage;
                  return (
                    <Fragment key={r.account_id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-3 h-10 whitespace-nowrap">
                          <Link to={`/admin/accounts/${r.account_id}?tab=contract`} className="font-medium text-gray-900 hover:underline">{r.name}</Link>
                        </td>
                        <td className={`px-3 h-10 whitespace-nowrap ${STATUS_TONE[status] || 'text-gray-700'}`}>{SUB_STATUS_AR[status] || '—'}</td>
                        <td className="px-3 h-10 whitespace-nowrap tabular-nums">{r.amount_jod ? jod(r.amount_jod) : '—'}</td>
                        <td className="px-3 h-10 whitespace-nowrap"><TrialEnds row={r} /></td>
                        <td className="px-3 h-10 whitespace-nowrap"><NextDue row={r} /></td>
                        <td className="px-3 h-10 whitespace-nowrap text-[12px] text-gray-600">
                          {lp ? (
                            <>{dayMonth(lp.paid_at)} · {METHOD_AR[lp.method] || '—'}{lp.reference && <> · <span dir="ltr" className="font-mono text-[11px]">{lp.reference}</span></>}</>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 h-10 whitespace-nowrap">
                          {u && u.cap ? (
                            <span dir="ltr" className={`tabular-nums text-[12px] ${TONE_TEXT[usageTone(u.ai_replies_month || 0, u.cap)]}`}>
                              {(u.ai_replies_month || 0).toLocaleString('en-US')} / {u.cap.toLocaleString('en-US')}
                            </span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-3 h-10 text-left whitespace-nowrap">
                          {status !== 'none' && status !== 'cancelled' ? (
                            <button type="button" onClick={() => openPay(pay === r.account_id ? null : r.account_id)}
                              className="text-[12px] text-gray-700 underline underline-offset-2">سجّل دفعة</button>
                          ) : (
                            <Link to={`/admin/accounts/${r.account_id}?tab=contract`} className="text-[12px] text-gray-500 underline underline-offset-2">سجّل عقدًا</Link>
                          )}
                        </td>
                      </tr>
                      {pay === r.account_id && (
                        <tr>
                          <td colSpan={8} className="p-0">
                            <RecordPaymentDrawer row={r} onCancel={() => openPay(null)}
                              onDone={(msg) => { setNotice(msg); openPay(null); load(); }} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="text-[11px] text-gray-400 px-1">
        سياسة التأخر تُطبَّق تلقائيًا كل يوم: بعد أيام السماح يُوقَف بوت المحل مؤقتًا وتبقى رسائله تصل لصندوقه، ويعود البوت عند تسجيل الدفعة.
        {' '}<Link to="/admin/settings" className="underline">إعدادات المنصة</Link>
      </p>
    </div>
  );
}
