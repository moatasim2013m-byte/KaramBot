import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { Check, Copy, ExternalLink, Send } from 'lucide-react';
import { Button, PageHeader, btnClass, chipClass, fieldClass, labelClass } from '../../components/admin/ui';

/**
 * «زبون جديد» — /admin/accounts/new (docs/panels/spec.md, «Signup flow» steps 1–2).
 *
 * A shop in about twenty seconds with no Meta id: the name, the sector, the owner and their
 * mobile. The server makes the draft profile, the owner's account and a 7-day join link in one
 * transaction (POST /api/admin/accounts), and SHIFT sends the link from its own WhatsApp with a
 * wa.me link, so nothing here costs a paid message. The owner then connects their own number
 * from /join and the profile fills itself from Meta.
 *
 * After «أنشئ» the page says the link is READY, never that it was sent: nothing leaves SHIFT
 * until the operator presses «افتح واتساب» (or copies it and says so). «تجديد الرابط» and
 * «إلغاء الدعوة» are the board's same two calls (POST …/join-link, DELETE …/invite).
 *
 * «ربط يدوي» keeps the old path (POST /api/businesses with ids typed by hand) for numbers wired
 * outside Embedded Signup, such as SHIFT's own. It makes no owner and no link.
 */

const bigField = `${fieldClass} !h-12 !text-base`;

const SECTORS = [
  ['restaurant', 'مطعم'],
  ['clinic', 'عيادة'],
  ['pharmacy', 'صيدلية'],
  ['salon', 'صالون'],
  ['clothing', 'محل ملابس'],
  ['shop', 'محل آخر'],
];

// The same mapping the server uses for the invite path, for the manual one.
const BUSINESS_TYPE = { restaurant: 'restaurant', clinic: 'clinic' };

const CITIES = ['إربد', 'عمّان', 'الزرقاء', 'المفرق', 'عجلون', 'جرش', 'السلط', 'مادبا', 'الكرك', 'العقبة'];

const DEFAULTS = {
  name: '', sector: '', owner_name: '', owner_phone: '', owner_email: '', city: 'إربد',
  wa_phone_number_id: '', wa_business_account_id: '',
};

// 07XXXXXXXX as typed, or with +962/00962/962 in front. The server normalises and has the last
// word; this only stops an obvious typo before the round trip.
function looksLikeJordanMobile(raw) {
  const d = String(raw || '').replace(/[٠-٩]/g, (c) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(c))).replace(/\D/g, '');
  return /^(?:00962|962|0)?7[789]\d{7}$/.test(d);
}

/** The text SHIFT is about to send, read back from the wa.me link the server built. */
function messageFrom(waShareUrl) {
  try { return new URL(waShareUrl).searchParams.get('text') || ''; } catch { return ''; }
}

/** The number the wa.me link opens, as +962…; the server normalised it. */
function phoneFrom(waShareUrl) {
  try { const d = new URL(waShareUrl).pathname.replace(/\D/g, ''); return d ? `+${d}` : ''; } catch { return ''; }
}

const longDate = (iso) => new Date(iso).toLocaleString('ar-JO', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** The WhatsApp bubble the owner will get. Before the server answers it is only a draft. */
function InvitePreview({ text, draft }) {
  return (
    <aside aria-label="معاينة الدعوة" className="flex-1 basis-[300px] max-w-[420px] min-w-0 flex flex-col gap-2.5">
      <span className="text-[13.5px] text-shift-body">معاينة الدعوة</span>
      <div className="rounded-2xl border border-shift-line bg-[#EFE9E1] p-4">
        <div className="rounded-xl rounded-ss-[3px] bg-white px-3.5 py-3 text-sm leading-[1.75] text-shift-ink whitespace-pre-wrap break-words shadow-[0_1px_1px_rgba(0,0,0,.06)]">
          {text}
        </div>
      </div>
      <span className="text-[13px] text-shift-body">
        {draft ? 'مسودة: الرابط ومدة صلاحيته يضعهما الخادم عند الإنشاء.' : 'هذا النص كما يصل لصاحب المحل.'}
      </span>
    </aside>
  );
}

function ResultCard({ result, ownerName, fallbackPhone, onRenewed, onAnother }) {
  const [sent, setSent] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState(null); // {tone, text}
  const phone = phoneFrom(result.wa_share_url) || fallbackPhone;

  const markSent = () => {
    setSent(true);
    // Moves the board card to «أُرسل الرابط». Telemetry: it never blocks the send.
    api.post(`/admin/accounts/${result.account_id}/events`, { type: 'invite_shared' }).catch(() => {});
  };

  const share = () => {
    // Opened first, inside the click, so the browser does not treat it as an unwanted popup.
    window.open(result.wa_share_url, '_blank', 'noopener,noreferrer');
    markSent();
    setToast({ tone: 'ok', text: 'فُتح واتساب — اضغط إرسال هناك.' });
  };

  const copy = async () => {
    if (await copyText(result.join_url)) setToast({ tone: 'ok', text: 'نُسخ الرابط.' });
    else setToast({ tone: 'error', text: 'تعذّر النسخ — انسخه من المعاينة.' });
  };

  const renew = async () => {
    setBusy(true); setToast(null);
    try {
      const res = await api.post(`/admin/accounts/${result.account_id}/join-link`);
      onRenewed(res.data);
      setSent(false); setCancelled(false);
      setToast({ tone: 'ok', text: 'رابط جديد جاهز — الرابط السابق لم يعد يعمل.' });
    } catch (err) {
      setToast({ tone: 'error', text: err.response?.data?.error || 'تعذّر إصدار رابط جديد' });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!window.confirm(`إلغاء دعوة ${ownerName}؟ يتوقف الرابط ويُعطَّل حساب صاحب المحل الذي لم يُستخدم.`)) return;
    setBusy(true); setToast(null);
    try {
      await api.delete(`/admin/accounts/${result.account_id}/invite`);
      setCancelled(true);
      setToast({ tone: 'ok', text: 'أُلغيت الدعوة. «تجديد الرابط» يصدر رابطًا جديدًا إن لزم.' });
    } catch (err) {
      setToast({ tone: 'error', text: err.response?.data?.error || 'تعذّر إلغاء الدعوة' });
    } finally {
      setBusy(false);
    }
  };

  const linkBtn = 'min-h-[40px] bg-transparent border-0 p-0 text-[13.5px] font-medium disabled:opacity-50';

  return (
    <section aria-live="polite" className="flex-1 basis-[440px] max-w-[560px] min-w-0 bg-white border border-shift-line rounded-2xl p-[22px] flex flex-col gap-4">
      <div>
        <h2 className="m-0 flex items-center gap-2 font-display text-xl font-semibold text-shift-ink">
          <Check size={20} className="text-shift-ok shrink-0" />
          {cancelled ? 'تم إنشاء الزبون. أُلغيت الدعوة.' : 'تم إنشاء الزبون. رابط الدعوة جاهز.'}
        </h2>
        {!cancelled && (
          <p className="mt-1 text-sm text-shift-body">
            لم يفتح {ownerName} الرابط بعد
            {result.invite_expires_at && <> · ينتهي <bdi>{longDate(result.invite_expires_at)}</bdi></>}
          </p>
        )}
      </div>

      <div className="rounded-xl bg-shift-canvas px-3.5 py-3 text-sm text-shift-ink">
        يُرسل إلى: <b className="font-semibold">{ownerName}</b>
        {phone && <> · <bdi dir="ltr" className="tabular-nums">{phone}</bdi></>}
      </div>

      <div className="flex flex-wrap gap-2.5">
        {result.wa_share_url && (
          <button type="button" onClick={share} disabled={cancelled || busy}
            className="inline-flex items-center gap-2 min-h-[48px] px-5 rounded-xl bg-wa text-[#062B1A] text-[15px] font-semibold hover:brightness-95 disabled:opacity-50 disabled:cursor-not-allowed">
            <Send size={16} /> افتح واتساب لإرسال الدعوة
          </button>
        )}
        <Button size="lg" onClick={copy} disabled={cancelled || busy}><Copy size={15} /> نسخ الرابط</Button>
        <Link to={`/admin/accounts/${result.account_id}`} className={btnClass('secondary', 'lg')}>
          <ExternalLink size={15} /> افتح صفحة الزبون
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-x-[18px] gap-y-2 border-t border-shift-line2 pt-3">
        {!cancelled && (
          <button type="button" onClick={markSent} disabled={sent || busy} className={`${linkBtn} text-shift-accent`}>
            {sent ? 'سُجّلت الدعوة كمرسلة ✓' : 'علّمت الدعوة كمرسلة'}
          </button>
        )}
        <button type="button" onClick={renew} disabled={busy} className={`${linkBtn} text-shift-accent`}>تجديد الرابط</button>
        {!cancelled && (
          <button type="button" onClick={cancel} disabled={busy} className={`${linkBtn} text-shift-danger`}>إلغاء الدعوة</button>
        )}
        <span className="ms-auto flex flex-wrap gap-x-[18px]">
          <Link to="/admin/onboarding" className={`${linkBtn} inline-flex items-center text-shift-body hover:text-shift-ink`}>لوحة الانضمام</Link>
          <button type="button" onClick={onAnother} className={`${linkBtn} text-shift-body hover:text-shift-ink`}>زبون آخر</button>
        </span>
      </div>
      <span role="status" className={`min-h-[20px] text-[13.5px] ${toast?.tone === 'error' ? 'text-shift-danger' : 'text-shift-ok'}`}>{toast?.text}</span>
    </section>
  );
}

export default function CreateBusinessPage() {
  const [form, setForm] = useState(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const navigate = useNavigate();

  const set = (key, val) => setForm((prev) => ({ ...prev, [key]: val }));

  const validateBasics = () => {
    if (!form.name.trim()) return 'اكتب اسم المحل';
    if (!form.sector) return 'اختر نوع النشاط';
    return null;
  };

  const handleInvite = async (e) => {
    e.preventDefault();
    const basic = validateBasics();
    if (basic) { setError(basic); return; }
    if (!looksLikeJordanMobile(form.owner_phone)) { setError('موبايل صاحب المحل: رقم أردني يبدأ بـ 077 أو 078 أو 079'); return; }
    if (!form.owner_name.trim()) { setError('اكتب اسم صاحب المحل'); return; }
    if (form.owner_email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.owner_email.trim())) {
      setError('البريد الإلكتروني غير صحيح'); return;
    }

    setSubmitting(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        sector: form.sector,
        owner_name: form.owner_name.trim(),
        owner_phone: form.owner_phone.trim(),
        city: form.city.trim() || undefined,
      };
      if (form.owner_email.trim()) body.owner_email = form.owner_email.trim();
      const res = await api.post('/admin/accounts', body);
      setResult(res.data);
    } catch (err) {
      // The server answers in Arabic, including the 409 that names the shop the mobile is on.
      setError(err.response?.data?.error || 'تعذّر إنشاء الزبون');
    } finally {
      setSubmitting(false);
    }
  };

  // The old path, for a number already wired by hand: no owner, no link.
  const handleManual = async () => {
    const basic = validateBasics();
    if (basic) { setError(basic); return; }
    if (!form.wa_phone_number_id.trim()) { setError('اكتب Phone Number ID للربط اليدوي'); return; }
    setSubmitting(true);
    setError('');
    try {
      const body = {
        name: form.name.trim(),
        business_type: BUSINESS_TYPE[form.sector] || 'generic',
        wa_phone_number_id: form.wa_phone_number_id.trim(),
      };
      if (form.wa_business_account_id.trim()) body.wa_business_account_id = form.wa_business_account_id.trim();
      body.sector = form.sector;
      if (form.city.trim()) body.city = form.city.trim();
      const res = await api.post('/businesses', body);
      navigate(`/admin/accounts/${res.data.business.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إنشاء الحساب');
    } finally {
      setSubmitting(false);
    }
  };

  const ownerFirst = form.owner_name.trim().split(/\s+/)[0] || 'صاحب المحل';
  const shopName = form.name.trim() || 'المحل';
  // Before the server answers, only the greeting and the shop are known; the link, its lifetime
  // and the rest of the message are the server's (invitePayload in adminAccounts.js).
  const draftText = `مرحبًا ${ownerFirst}، هذا رابط تفعيل كرم بوت لـ${shopName}:\n[الرابط]\n…`;
  const preview = result ? (result.share_text || messageFrom(result.wa_share_url)) : draftText;

  return (
    <div className="max-w-[1040px]">
      <nav aria-label="مسار الصفحة" className="mb-2 text-[13.5px] text-shift-body">
        <Link to="/admin/accounts" className="text-shift-accent hover:text-shift-ink no-underline">الزبائن</Link>
        <span aria-hidden="true"> / </span>زبون جديد
      </nav>
      <PageHeader title="زبون جديد" sub="أنت تنشئ الدعوة، وصاحب المحل يكمل التفعيل من هاتفه." />

      <div className="flex flex-wrap items-start gap-6">
        {result ? (
          <ResultCard result={result} ownerName={ownerFirst} fallbackPhone={form.owner_phone.trim()}
            onRenewed={(payload) => setResult((prev) => ({ ...prev, ...payload }))}
            onAnother={() => { setResult(null); setForm(DEFAULTS); setError(''); }} />
        ) : (
          <form onSubmit={handleInvite} noValidate
            className="flex-1 basis-[440px] max-w-[560px] min-w-0 bg-white border border-shift-line rounded-2xl p-[22px] flex flex-col gap-5">
            {error && (
              <div role="alert" className="rounded-xl border border-shift-dangerLine bg-shift-dangerBg px-4 py-3 text-sm text-shift-danger">{error}</div>
            )}

            <div className="flex flex-col gap-2">
              <label htmlFor="nc-name" className="text-sm font-medium text-shift-ink">اسم المحل</label>
              <input id="nc-name" value={form.name} onChange={(e) => set('name', e.target.value)} className={bigField} />
            </div>

            <fieldset className="m-0 border-0 p-0">
              <legend className="mb-2 p-0 text-sm font-medium text-shift-ink">نوع النشاط</legend>
              <div role="radiogroup" aria-label="نوع النشاط" className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {SECTORS.map(([value, label]) => (
                  <button key={value} type="button" role="radio" aria-checked={form.sector === value ? 'true' : 'false'}
                    onClick={() => set('sector', value)} className={`${chipClass(form.sector === value, 'square')} !min-h-[44px]`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="mt-1.5 block text-[13px] text-shift-body">يحدد نوع البوت: طلبات للمطاعم، مواعيد للعيادات، وإجابات لبقية المحلات.</span>
            </fieldset>

            {/* The server refuses an invite without the owner's name (POST /api/admin/accounts), so it
                stays beside the mobile instead of under «تفاصيل إضافية». */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label htmlFor="nc-phone" className="text-sm font-medium text-shift-ink">موبايل صاحب المحل</label>
                <input id="nc-phone" value={form.owner_phone} onChange={(e) => set('owner_phone', e.target.value)}
                  className={`${bigField} text-right tabular-nums`} dir="ltr" type="tel" inputMode="tel" autoComplete="off" placeholder="07XXXXXXXX" />
                <span className="text-[13px] text-shift-body">يصبح رقم دخوله ورقم تنبيهاته</span>
              </div>
              <div className="flex flex-col gap-2">
                <label htmlFor="nc-owner" className="text-sm font-medium text-shift-ink">اسم صاحب المحل</label>
                <input id="nc-owner" value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} className={bigField} />
                <span className="text-[13px] text-shift-body">به تبدأ رسالة الدعوة</span>
              </div>
            </div>

            <details className="border-t border-shift-line2 pt-3">
              <summary className="cursor-pointer min-h-[40px] flex items-center text-sm font-medium text-shift-ink">تفاصيل إضافية — اختياري</summary>
              <div className="mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
                <div className="flex flex-col gap-2">
                  <label htmlFor="nc-city" className={labelClass}>المدينة</label>
                  <select id="nc-city" value={form.city} onChange={(e) => set('city', e.target.value)} className={fieldClass}>
                    {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="flex flex-col gap-2">
                  <label htmlFor="nc-email" className={labelClass}>البريد</label>
                  <input id="nc-email" type="email" value={form.owner_email} onChange={(e) => set('owner_email', e.target.value)}
                    className={fieldClass} dir="ltr" inputMode="email" autoComplete="off" />
                </div>
              </div>
            </details>

            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" size="lg" disabled={submitting} className="!text-base">
                {submitting ? 'جارٍ الإنشاء…' : 'أنشئ الزبون ورابط الانضمام'}
              </Button>
              <span className="text-[13px] text-shift-body">العرض: تجربة مجانية (مدتها من «إعدادات المنصة»)، تبدأ مع أول رد للبوت على زبون.</span>
            </div>

            {/* Hand-wired numbers only. Kept out of the way so the normal path never asks for an id. */}
            <details className="border-t border-shift-line2 pt-3">
              <summary className="cursor-pointer min-h-[40px] flex items-center text-[13.5px] text-shift-body">ربط يدوي — متقدم</summary>
              <div className="mt-2.5 flex flex-col gap-3">
                <p className="text-[13px] text-shift-body">ربط يدوي لرقم موصول مسبقًا: يُنشئ الحساب بالاسم والنوع أعلاه، بلا صاحب محل ولا رابط انضمام.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <div className="flex flex-col gap-2">
                    <label htmlFor="nc-pnid" className={labelClass}>Phone Number ID</label>
                    <input id="nc-pnid" value={form.wa_phone_number_id} onChange={(e) => set('wa_phone_number_id', e.target.value)}
                      className={`${fieldClass} font-mono`} dir="ltr" placeholder="123456789012345" />
                  </div>
                  <div className="flex flex-col gap-2">
                    <label htmlFor="nc-waba" className={labelClass}>WABA ID</label>
                    <input id="nc-waba" value={form.wa_business_account_id} onChange={(e) => set('wa_business_account_id', e.target.value)}
                      className={`${fieldClass} font-mono`} dir="ltr" placeholder="987654321098765" />
                  </div>
                </div>
                <p className="text-[13px] text-shift-muted">مفتاح الوصول يُضاف بعد الإنشاء من صفحة الحساب.</p>
                <div>
                  <Button onClick={handleManual} disabled={submitting}>أنشئ الحساب بربط يدوي</Button>
                </div>
              </div>
            </details>
          </form>
        )}

        <InvitePreview text={preview} draft={!result} />
      </div>
    </div>
  );
}
