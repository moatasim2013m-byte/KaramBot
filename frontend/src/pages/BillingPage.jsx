import React, { useEffect, useState } from 'react';
import { Copy, Check, MessageCircle, Receipt } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Ltr } from '../components/shared/Primitives';
import { planBanner, dateAr, countAr, daysAr, shiftWaLink, helpText } from '../components/whatsapp/panelView';

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

const CHIP = {
  trial: 'bg-sky-100 text-sky-900',
  active: 'bg-emerald-100 text-emerald-900',
  past_due: 'bg-amber-100 text-amber-900',
  paused: 'bg-red-100 text-red-900',
};

function Card({ title, children }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white">
      {title && (
        <header className="flex items-center px-4 h-11 border-b border-gray-100">
          <h3 className="text-[14px] font-semibold text-gray-800">{title}</h3>
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
        <span className="text-gray-700">{label}</span>
        <span className="tabular-nums text-gray-900 font-medium">
          {countAr(used)}{cap ? <> من {countAr(cap)}</> : null}
        </span>
      </div>
      {cap ? (
        <div className="mt-1.5 h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
        </div>
      ) : null}
      {note && <p className="mt-1 text-[11px] text-gray-500">{note}</p>}
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
      className="inline-flex items-center gap-1.5 h-9 px-3 rounded-md border border-gray-200 text-[13px] text-gray-700">
      {done ? <Check size={13} className="text-emerald-600" /> : <Copy size={13} />} {done ? 'تم النسخ' : label}
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

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!data) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  const { plan, usage, payments = [], payment_instructions: pay = {}, late_policy: late = {}, meta_fees_line: metaFees } = data;
  const graceDays = Number(late?.grace_days) || 7;
  const banner = planBanner(plan, { graceDays });
  const hasPlan = plan && plan.status && plan.status !== 'none';
  const canPay = Boolean(pay?.cliq_alias || pay?.iban);
  const price = plan?.price_jod != null ? Number(plan.price_jod) : null;
  const shop = user?.business_name || '';
  const sentText = `دفعت ${price != null ? `${price} د.أ ` : ''}عبر كليك — ${shop || helpText(user)}`;

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <h1 className="text-xl font-bold text-gray-800">الاشتراك</h1>

      <Card>
        {hasPlan ? (
          <>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[16px] font-bold text-gray-900">
                {plan.name || 'باقة كرم بوت'}{price != null && <> — <span className="tabular-nums">{price}</span> د.أ شهريًا</>}
              </p>
              {banner && <span className={`text-[12px] font-medium rounded-full px-2.5 py-1 ${CHIP[plan.status] || 'bg-gray-100 text-gray-700'}`}>{chipText(plan, graceDays)}</span>}
            </div>
            {banner && <p className="mt-2 text-[13px] text-gray-600">{banner.text}</p>}
          </>
        ) : (
          <p className="text-[14px] text-gray-700">لا يوجد اشتراك بعد. يبدأ الشهر المجاني حين يرد البوت على أول زبون.</p>
        )}
        <a href={shiftWaLink(`${helpText(user)} — أريد تغيير الباقة`)} target="_blank" rel="noopener noreferrer"
          className="inline-block mt-3 text-[12px] text-gray-600 underline underline-offset-2">تواصل مع شِفت لتغيير الباقة</a>
      </Card>

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
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-[12px] text-gray-500">اسم CliQ</p>
                  <Ltr className="text-[16px] font-semibold text-gray-900">{pay.cliq_alias}</Ltr>
                </div>
                <CopyButton text={pay.cliq_alias} label="نسخ اسم CliQ" />
              </div>
            )}
            {pay.iban && (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] text-gray-500">رقم الحساب (IBAN)</p>
                  <Ltr className="text-[14px] text-gray-900 break-all">{pay.iban}</Ltr>
                </div>
                <CopyButton text={pay.iban} label="نسخ IBAN" />
              </div>
            )}
            {pay.holder && <p className="text-[13px] text-gray-700">باسم: {pay.holder}</p>}
            <a href={shiftWaLink(sentText)} target="_blank" rel="noopener noreferrer"
              className="flex items-center justify-center gap-1.5 h-11 rounded-md bg-green-600 text-white text-[14px] font-medium">
              <MessageCircle size={15} /> أرسلت الدفعة
            </a>
            <p className="text-[11px] text-gray-500 text-center">تفتح واتساب برسالة جاهزة لشِفت، ونسجّل الدفعة عندنا.</p>
          </div>
        </Card>
      )}

      <Card title="دفعاتك">
        {payments.length === 0 ? (
          <p className="flex items-center gap-2 text-[13px] text-gray-500"><Receipt size={14} /> لا دفعات مسجّلة بعد.</p>
        ) : (
          <div className="overflow-x-auto -mx-4">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-gray-500 text-right">
                  <th className="font-medium px-4 py-2">التاريخ</th>
                  <th className="font-medium px-4 py-2">المبلغ</th>
                  <th className="font-medium px-4 py-2">الطريقة</th>
                  <th className="font-medium px-4 py-2">المرجع</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payments.map((p, i) => (
                  <tr key={`${p.paid_at}-${i}`}>
                    <td className="px-4 py-2 whitespace-nowrap">{dateAr(p.paid_at)}</td>
                    <td className="px-4 py-2 whitespace-nowrap tabular-nums">{Number(p.amount_jod)} د.أ</td>
                    <td className="px-4 py-2">{METHOD_AR[p.method] || p.method || '—'}</td>
                    <td className="px-4 py-2"><Ltr className="text-gray-600">{p.reference || '—'}</Ltr></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card title="رسوم واتساب لدى Meta">
        <p className="text-[13px] text-gray-700 leading-relaxed">
          {metaFees || 'تدفع رسوم رسائل واتساب لـ Meta مباشرة من بطاقتك في WhatsApp Manager، ولا تمر عبر شِفت.'}
        </p>
      </Card>

      <Card title="إذا تأخرت الدفعة">
        <p className="text-[13px] text-gray-700 leading-relaxed">
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
