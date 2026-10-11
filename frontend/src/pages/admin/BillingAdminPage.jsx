import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Download, Receipt } from 'lucide-react';
import api from '../../utils/api';
import { Freshness, SkeletonRows, EmptyState } from '../../components/shared/Primitives';
import { PageHeader, Button, Chip, Pill, Footnote, btnClass } from '../../components/admin/ui';
import RecordPaymentDrawer from '../../components/admin/RecordPaymentDrawer';
import {
  BILLING_FILTERS, METHOD_AR, SUB_STATUS_AR, billingCsv, billingMatches, dayMonth, daysUntil, jod, usageTone,
} from '../../components/admin/operatorView';

/**
 * «الاشتراكات والدفعات» — /admin/billing, money across all shops, recorded by hand.
 *
 * CliQ, a bank transfer or cash: what is due, what came in, and whose free month ends. The strip
 * is the month in one line; the table is one row per shop with its live contract, full width and
 * scrolling inside its own card on a phone; «سجّل دفعة» opens the side drawer (and opens by itself
 * for ?pay=<shop> from «اليوم»). The CSV is generated here, in the browser, from exactly the rows
 * on screen.
 *
 * The late policy is the daily sweep's, not a button: after the grace days a late shop's bot is
 * paused by SHIFT with its inbox still working, and recording the payment here resumes it.
 */

// The shared filters plus two the design adds, both read from the same billing rows.
const FILTERS = [
  BILLING_FILTERS[0],
  ['trial', 'في المجانية'],
  ...BILLING_FILTERS.slice(1, 3),
  ['paused', 'موقوف'],
  ...BILLING_FILTERS.slice(3),
];
function matches(row, key) {
  if (key === 'trial') return row.status === 'trial';
  if (key === 'paused') return row.status === 'paused' || Boolean(row.bot_paused_for_late);
  return billingMatches(row, key);
}

const STATUS_TONE = { trial: 'trial', active: 'ok', past_due: 'bad', paused: 'warn', cancelled: 'neutral', none: 'neutral' };
const CYCLE_AR = { monthly: 'شهريًا', quarterly: 'كل 3 أشهر', yearly: 'سنويًا', one_time: 'مرة واحدة' };
const USAGE_TEXT = { ok: 'text-shift-body', warn: 'text-shift-warn', bad: 'text-shift-danger', none: 'text-shift-muted' };
const dash = <span className="text-shift-muted">—</span>;

function Money({ value }) {
  return (
    <span className="font-display text-2xl font-semibold tabular-nums">
      {Number(value || 0).toLocaleString('en-US', { maximumFractionDigits: 2 })}
      {' '}<span className="font-sans text-[13px] font-medium text-shift-body">د.أ</span>
    </span>
  );
}

function Totals({ totals }) {
  const t = totals || {};
  const month = new Date().toLocaleDateString('ar-JO', { month: 'long' });
  const cells = [
    [`المتوقع في ${month}`, t.expected_month_jod],
    [`المحصّل في ${month}`, t.collected_month_jod],
    ['المتأخر الآن', t.overdue_jod],
  ];
  return (
    <section aria-label="المجاميع"
      className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-px bg-shift-line border border-shift-line rounded-2xl overflow-hidden mb-[18px]">
      {cells.map(([label, value]) => (
        <div key={label} className="bg-white px-[18px] py-3.5">
          <div className="text-[13px] text-shift-body">{label}</div>
          <div className={`mt-1 ${label === 'المتأخر الآن' && Number(value) > 0 ? 'text-shift-danger' : 'text-shift-ink'}`}><Money value={value} /></div>
        </div>
      ))}
    </section>
  );
}

/** «الاشتراك»: the status as a pill; a free month says until when. */
function Status({ row }) {
  const status = row.status || 'none';
  if (status === 'trial' && row.trial_ends_at) {
    const left = daysUntil(row.trial_ends_at);
    return (
      <span title={new Date(row.trial_ends_at).toLocaleDateString('ar-JO')}>
        <Pill tone={left !== null && left <= 3 ? 'warn' : 'trial'}>مجاني حتى {dayMonth(row.trial_ends_at)}</Pill>
        {left !== null && left >= 0 && <span className="block mt-0.5 text-xs text-shift-muted">باقي {left} ي</span>}
      </span>
    );
  }
  return (
    <span>
      <Pill tone={STATUS_TONE[status] || 'neutral'}>{SUB_STATUS_AR[status] || '—'}</Pill>
      {row.bot_paused_for_late && <span className="block mt-0.5 text-xs text-shift-warn">الرد الآلي موقوف للتأخر</span>}
    </span>
  );
}

/** «المستحق الآن»: what is still owed on this cycle, and when it falls due. */
function Due({ row }) {
  if (!row.next_due_at && row.due_jod == null) return dash;
  const d = daysUntil(row.next_due_at);
  const late = d !== null && d < 0;
  return (
    <span>
      <span className="tabular-nums">{row.due_jod != null ? jod(row.due_jod) : '—'}</span>
      {row.next_due_at && (
        <span className={`block mt-0.5 text-xs ${late ? 'text-shift-danger' : 'text-shift-muted'}`}>
          {late ? `متأخر ${Math.abs(d)} ي · ` : 'يستحق '}{dayMonth(row.next_due_at)}
        </span>
      )}
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
  const rows = useMemo(() => all.filter((r) => matches(r, filter)), [all, filter]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map(([k]) => [k, all.filter((r) => matches(r, k)).length])), [all]);
  // Looked up in every row, not the filtered ones: ?pay= from «اليوم» opens whatever the filter.
  const payRow = pay ? all.find((r) => r.account_id === pay) : null;

  const openPay = useCallback((id) => {
    const next = new URLSearchParams(params);
    if (id) next.set('pay', id); else next.delete('pay');
    setParams(next, { replace: true });
  }, [params, setParams]);
  const closePay = useCallback(() => openPay(null), [openPay]);

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
    <div>
      <PageHeader title="الاشتراكات والدفعات"
        sub="هذه دفعات اشتراك شِفت، تُسجَّل يدويًا: كليك، تحويل بنكي أو نقدًا. رسوم واتساب يدفعها كل محل إلى Meta مباشرة.">
        <div className="flex items-center gap-3">
          <Freshness at={at} onRefresh={load} loading={loading} />
          <Button onClick={exportCsv} disabled={!rows.length}><Download size={16} /> تصدير CSV</Button>
        </div>
      </PageHeader>

      {error && <div role="alert" className="mb-4 bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}

      <Totals totals={data?.totals} />

      <div role="group" aria-label="تصفية" className="flex flex-wrap gap-1.5 mb-[18px]">
        {FILTERS.map(([key, label]) => (
          <Chip key={key} on={filter === key} onClick={() => setFilter(key)}>
            {label} <span className="tabular-nums">{counts[key] ?? 0}</span>
          </Chip>
        ))}
      </div>

      <div className="bg-white border border-shift-line rounded-2xl overflow-x-auto">
        {loading && !data ? <SkeletonRows rows={6} cols={6} /> : rows.length === 0 ? (
          <EmptyState icon={Receipt} tone="neutral" title={all.length ? 'لا نتائج مطابقة' : 'لا يوجد زبائن بعد'} />
        ) : (
          <table className="w-full min-w-[880px] border-collapse text-sm">
            <thead>
              <tr className="text-right text-shift-body text-[12.5px]">
                {['الزبون', 'الاشتراك', 'السعر', 'المستحق الآن', 'آخر دفعة', 'الردود/الحد', 'إجراء'].map((h, i, list) => (
                  <th key={h} scope="col"
                    className={`font-semibold border-b border-shift-line py-3 whitespace-nowrap ${i === 0 ? 'px-[18px]' : i === list.length - 1 ? 'pr-2.5 pl-[18px]' : 'px-2.5'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const status = r.status || 'none';
                const lp = r.last_payment;
                const u = r.usage;
                const td = 'px-2.5 py-2.5 border-b border-shift-line2 align-middle';
                return (
                  <tr key={r.account_id} className="hover:bg-shift-hover">
                    <td className="px-[18px] py-2.5 border-b border-shift-line2">
                      <Link to={`/admin/accounts/${r.account_id}?tab=contract`} className="font-semibold text-shift-ink hover:text-shift-accent">{r.name}</Link>
                    </td>
                    <td className={`${td} whitespace-nowrap`}><Status row={r} /></td>
                    <td className={`${td} whitespace-nowrap tabular-nums`}>
                      {r.amount_jod ? <>{jod(r.amount_jod)}{r.billing_cycle && r.billing_cycle !== 'monthly' && <span className="block text-xs text-shift-muted">{CYCLE_AR[r.billing_cycle] || ''}</span>}</> : dash}
                    </td>
                    <td className={`${td} whitespace-nowrap`}><Due row={r} /></td>
                    <td className={`${td} whitespace-nowrap text-shift-body`}>
                      {lp ? (
                        <>
                          <span className="tabular-nums">{jod(lp.amount_jod)}</span> · {dayMonth(lp.paid_at)}
                          <span className="block text-xs text-shift-muted">
                            {METHOD_AR[lp.method] || '—'}{lp.reference && <> · <span dir="ltr" className="font-mono">{lp.reference}</span></>}
                          </span>
                        </>
                      ) : (r.subscription_id ? 'لا دفعات' : dash)}
                    </td>
                    <td className={`${td} whitespace-nowrap`}>
                      {u && u.cap ? (
                        <span dir="ltr" className={`tabular-nums text-[13px] ${USAGE_TEXT[usageTone(u.ai_replies_month || 0, u.cap)]}`}>
                          {(u.ai_replies_month || 0).toLocaleString('en-US')} / {u.cap.toLocaleString('en-US')}
                        </span>
                      ) : dash}
                    </td>
                    <td className="pr-2.5 pl-[18px] py-2.5 border-b border-shift-line2 whitespace-nowrap">
                      {status !== 'none' && status !== 'cancelled' ? (
                        <Button size="sm" onClick={() => openPay(r.account_id)}>سجّل دفعة</Button>
                      ) : (
                        <Link to={`/admin/accounts/${r.account_id}?tab=contract`} className={btnClass('secondary', 'sm')}>سجّل عقدًا</Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <p role="status" className="mt-3 mb-0 min-h-[20px] text-[13.5px] text-shift-ok">
        {notice && <>{notice} <button type="button" onClick={() => setNotice(null)} className="ms-2 min-h-[32px] text-[13px] text-shift-body underline">إخفاء</button></>}
      </p>

      <Footnote>
        سياسة التأخر تُطبَّق تلقائيًا كل يوم: بعد أيام السماح من الاستحقاق يتوقف الرد الآلي فقط وتبقى الرسائل تصل لصندوق المحل، ويعود عند تسجيل الدفعة.
        {' '}<Link to="/admin/settings" className="text-shift-accent hover:text-shift-ink">إعدادات المنصة</Link>
      </Footnote>

      {payRow && (
        <RecordPaymentDrawer key={payRow.account_id} row={payRow} onCancel={closePay}
          onDone={(msg) => { setNotice(msg); closePay(); load(); }} />
      )}
    </div>
  );
}
