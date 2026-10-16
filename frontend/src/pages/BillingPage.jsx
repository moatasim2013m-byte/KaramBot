import React, { useEffect, useState } from 'react';
import { Copy, Check, MessageCircle, Receipt } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Ltr } from '../components/shared/Primitives';
import { planBanner, graceDaysOf, dateAr, countAr, daysAr, shiftWaLink, helpText } from '../components/whatsapp/panelView';

/**
 * «الاشتراك» — what the shop pays SHIFT, what it pays Meta, and what happens if it is late.
 *
 * Owner only. «كيف أدفع؟» appears only once SHIFT has filled its CliQ alias or IBAN in «إعدادات
 * المنصة» (decision 11): a payment card with empty fields would send the owner looking for money
 * details that do not exist. «أرسلت الدفعة» is a wa.me message to SHIFT, which records the payment
 * by hand; nothing here moves money.
 */

const METHOD_AR = {
  cliq: 'كليك', CliQ: 'كليك', bank: 'تحويل بنكي', bank_transfer: 'تحويل بنكي', cash: 'نقدًا', card: 'بطاقة',
};

function Card({ title, children }) {
  return (
    <section className="rounded-2xl border border-shift-line bg-white">
      {title && (
        <header className="flex items-center px-4 h-11 border-b border-shift-line2">
          <h3 className="font-display text-[15px] font-semibold text-shift-ink">{title}</h3>
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

function Meter({ label, used, cap, note }) {
  const pct = cap ? Math.min(100, Math.round((Number(used) / Number(cap)) * 100)) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 text-[13px]">
        <span className="text-shift-body">{label}</span>
        <span className="tabular-nums text-shift-ink font-medium">
          {countAr(used)}{cap ? <> من {countAr(cap)}</> : null}
        </span>
      </div>
      {cap ? (
        <div className="mt-1.5 h-2 bg-shift-line2 rounded-full overflow-hidden">
          <div className={`h-full ${pct >= 100 ? 'bg-shift-danger' : pct >= 80 ? 'bg-[#D98A0B]' : 'bg-shift-ok'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {note && <p className="mt-1 text-[11px] text-shift-muted">{note}</p>}
    </div>
  );
}

function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 2000);
    } catch {
      // Clipboard blocked (an in-app browser): the value is on the screen to copy by hand.
    }
  };
  return (
    <button type="button" onClick={copy}
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-[10px] border border-shift-field bg-white text-[13px] font-semibold text-shift-ink">
      {done ? <Check size={13} className="text-shift-ok" /> : <Copy size={13} />} {done ? 'تم النسخ' : label}
    </button>
  );
}

export default function BillingPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get('/account/billing')
      .then((res) => setData(res.data))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الاشتراك'));
  }, []);

  if (error) return <div className="rounded-xl border border-shift-dangerLine bg-shift-dangerBg px-4 py-3 text-sm text-shift-danger">{error}</div>;
  if (!data) return <div className="text-center py-16 text-shift-muted">جاري التحميل...</div>;

  const { plan, usage, payments = [], payment_instructions: pay = {}, late_policy: late = {}, meta_fees_line: metaFees } = data;
  const graceDays = graceDaysOf(late);
  const banner = planBanner(plan, { graceDays });
  const hasPlan = plan && plan.status && plan.status !== 'none';
  const canPay = Boolean(pay?.cliq_alias || pay?.iban);
  const price = plan?.price_jod != null ? Number(plan.price_jod) : null;
  const shop = user?.business_name || '';
  const sentText = `دفعت ${price != null ? `${price} د.أ ` : ''}عبر كليك — ${shop || helpText(user)}`;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="font-display text-[22px] font-semibold text-shift-ink">الاشتراك</h1>

      {/* The plan, dark like the console's own header: the one card the owner is paying for. */}
      <section className="rounded-2xl bg-shift-ink text-white p-4">
        {hasPlan ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="font-display text-[16px] font-semibold">{plan.name || 'باقة كرم بوت'}</p>
              {banner && <span className="text-[12px] font-semibold rounded-full px-2.5 py-1 bg-shift-ink2 text-shift-gold">{chipText(plan, graceDays)}</span>}
            </div>
            {price != null && (
              <p className="mt-2 flex items-baseline gap-1.5">
                <span className="font-display text-[30px] leading-none font-bold tabular-nums">{price}</span>
                <span className="text-[13px] text-shift-navText">دينار بالشهر{plan.status === 'trial' ? ' بعد التجربة' : ''}</span>
              </p>
            )}
            {banner && <p className="mt-2 text-[13px] text-shift-navText">{banner.text}</p>}
          </>
        ) : (
          <p className="text-[14px] text-shift-navText leading-relaxed">لا يوجد اشتراك بعد. تبدأ التجربة المجانية حين يرد البوت على أول زبون.</p>
        )}
        <a href={shiftWaLink(`${helpText(user)} — أريد تغيير الباقة`)} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-3 text-[12px] text-shift-navText underline underline-offset-2">تواصل مع شِفت لتغيير الباقة</a>
      </section>

      {usage && (
        <Card title="الاستخدام">
          <div className="space-y-4">
            <Meter label="الردود التلقائية هذا الشهر" used={usage.ai_replies_month} cap={usage.cap} note="تتجدد أول كل شهر" />
            <Meter label="المستخدمون" used={usage.seats_used} cap={usage.seats} />
          </div>
        </Card>
      )}

      {canPay && (
        <Card title="كيف أدفع؟">
          <div className="space-y-3">
            {pay.cliq_alias && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-shift-canvas px-3 py-2.5">
                <div>
                  <p className="text-[12px] text-shift-muted">اسم CliQ</p>
                  <Ltr className="text-[16px] font-semibold text-shift-ink">{pay.cliq_alias}</Ltr>
                </div>
                <CopyButton text={pay.cliq_alias} label="نسخ اسم CliQ" />
              </div>
            )}
            {pay.iban && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-shift-canvas px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-[12px] text-shift-muted">رقم الحساب (IBAN)</p>
                  <Ltr className="text-[14px] text-shift-ink break-all">{pay.iban}</Ltr>
                </div>
                <CopyButton text={pay.iban} label="نسخ IBAN" />
              </div>
            )}
            {pay.holder && <p className="text-[13px] text-shift-body">باسم: {pay.holder}</p>}
            <a href={shiftWaLink(sentText)} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 h-11 rounded-xl bg-shift-ok text-white text-[14px] font-semibold">
              <MessageCircle size={15} /> أرسلت الدفعة
            </a>
            <p className="text-[11px] text-shift-muted text-center">تفتح واتساب برسالة جاهزة لشِفت، ونسجّل الدفعة عندنا.</p>
          </div>
        </Card>
      )}

      <Card title="دفعاتك">
        {payments.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-shift-muted"><Receipt size={14} /> لا دفعات مسجّلة بعد.</p>
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-shift-muted text-right">
                  <th className="font-medium px-4 py-2">التاريخ</th>
                  <th className="font-medium px-4 py-2">المبلغ</th>
                  <th className="font-medium px-4 py-2">الطريقة</th>
                  <th className="font-medium px-4 py-2">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-shift-canvas">
                {payments.map((p, i) => (
                  <tr key={`${p.paid_at}-${i}`}>
                    <td className="px-4 py-2 whitespace-nowrap">{dateAr(p.paid_at)}</td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{Number(p.amount_jod)} د.أ</td>
                    <td className="px-4 py-2">{METHOD_AR[p.method] || p.method || '—'}</td>
                    <td className="px-4 py-2"><Ltr className="text-shift-body">{p.reference || '—'}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="رسوم واتساب لدى Meta">
        <p className="text-[13px] text-shift-body leading-relaxed">
          {metaFees || 'تدفع رسوم رسائل واتساب لـ Meta مباشرة من بطاقتك في WhatsApp Manager، ولا تمر عبر شِفت.'}
        </p>
      </Card>

      <Card title="إذا تأخرت الدفعة">
        <p className="text-[13px] text-shift-body leading-relaxed">
          نذكّرك قبل الاستحقاق بخمسة أيام. بعد الاستحقاق لديك {daysAr(graceDays)} سماح يعمل فيها البوت كالمعتاد، بعدها يتوقف الرد الآلي فقط — رسائل زبائنك تبقى تصل إلى «المحادثات» ولا يُحذف شيء.
        </p>
      </Card>
    </div>
  );
}

/** The plan card's chip: «فترة مجانية حتى …», «مدفوع حتى …», «متأخر 5 أيام». */
function chipText(plan, graceDays) {
  if (plan.status === 'trial') return plan.trial_ends_at ? `فترة مجانية حتى ${dateAr(plan.trial_ends_at)}` : 'فترة مجانية';
  if (plan.status === 'active') return plan.next_due_at ? `مدفوع حتى ${dateAr(plan.next_due_at)}` : 'فعّال';
  if (plan.status === 'past_due') {
    const late = plan.next_due_at ? Math.max(0, Math.floor((Date.now() - new Date(plan.next_due_at).getTime()) / 86400000)) : 0;
    return late > 0 ? `متأخر ${daysAr(late)}` : 'حان موعد الدفعة';
  }
  if (plan.status === 'paused') return `موقوف بعد ${daysAr(graceDays)} سماح`;
  return '';
}
