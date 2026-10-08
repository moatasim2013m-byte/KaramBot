import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { ArrowRight, Check, ChevronDown, Copy, ExternalLink, Send } from 'lucide-react';

/**
 * «زبون جديد» — /admin/accounts/new (docs/panels/spec.md, «Signup flow» steps 1–2).
 *
 * A shop in about twenty seconds with no Meta id: the name, the sector, the owner and their
 * mobile. The server makes the draft profile, the owner's account and a 7-day join link in one
 * transaction (POST /api/admin/accounts), and SHIFT sends the link from its own WhatsApp with a
 * wa.me link, so nothing here costs a paid message. The owner then connects their own number
 * from /join and the profile fills itself from Meta.
 *
 * «متقدم» keeps the old path (POST /api/businesses with ids typed by hand) for numbers wired
 * outside Embedded Signup, such as SHIFT's own. It makes no owner and no link.
 */

const inputClass = 'w-full border border-gray-200 rounded-lg px-3 h-11 text-sm focus:outline-none focus:ring-1 focus:ring-green-500';

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

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-sm text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 mr-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

/** The text SHIFT is about to send, read back from the wa.me link the server built. */
function messageFrom(waShareUrl) {
  try { return new URL(waShareUrl).searchParams.get('text') || ''; } catch { return ''; }
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

function ResultCard({ result, ownerName, onAnother }) {
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const preview = messageFrom(result.wa_share_url);

  const share = () => {
    // Opened first, inside the click, so the browser does not treat it as an unwanted popup.
    window.open(result.wa_share_url, '_blank', 'noopener,noreferrer');
    setShared(true);
    // Moves the board card to «أُرسل الرابط». Telemetry: it never blocks the send.
    api.post(`/admin/accounts/${result.account_id}/events`, { type: 'invite_shared' }).catch(() => {});
  };

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sm:p-6 space-y-4">
      <div className="flex items-center gap-2 text-green-700">
        <Check size={18} />
        <h2 className="text-lg font-bold text-gray-900">الرابط جاهز — أرسله لـ{ownerName}</h2>
      </div>

      {preview && (
        <div className="rounded-lg bg-[#e7fbe6] border border-green-100 p-3 text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">
          {preview}
        </div>
      )}
      {result.invite_expires_at && (
        <p className="text-xs text-gray-500">
          صالح حتى {new Date(result.invite_expires_at).toLocaleString('ar-JO', { dateStyle: 'medium', timeStyle: 'short' })}
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <button type="button" onClick={share}
          className="inline-flex items-center justify-center gap-2 h-11 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700">
          <Send size={15} /> {shared ? 'أُرسل — أرسل مرة أخرى' : 'أرسل على واتساب'}
        </button>
        <button type="button"
          onClick={async () => { if (await copyText(result.join_url)) { setCopied(true); setTimeout(() => setCopied(false), 2000); } }}
          className="inline-flex items-center justify-center gap-2 h-11 rounded-lg border border-gray-200 text-sm text-gray-800 hover:bg-gray-50">
          <Copy size={15} /> {copied ? 'نُسخ الرابط' : 'نسخ الرابط'}
        </button>
        <Link to={`/admin/accounts/${result.account_id}`}
          className="inline-flex items-center justify-center gap-2 h-11 rounded-lg border border-gray-200 text-sm text-gray-800 hover:bg-gray-50">
          <ExternalLink size={15} /> افتح صفحة الزبون
        </Link>
      </div>

      <div className="pt-2 border-t border-gray-100 flex flex-wrap gap-4 text-sm">
        <button type="button" onClick={onAnother} className="text-gray-600 hover:text-gray-900 underline underline-offset-2">زبون جديد آخر</button>
        <Link to="/admin/onboarding" className="text-gray-600 hover:text-gray-900 underline underline-offset-2">لوحة الانضمام</Link>
      </div>
    </div>
  );
}

export default function CreateBusinessPage() {
  const [form, setForm] = useState(DEFAULTS);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
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
    if (!form.owner_name.trim()) { setError('اكتب اسم صاحب المحل'); return; }
    if (!looksLikeJordanMobile(form.owner_phone)) { setError('موبايل صاحب المحل: رقم أردني يبدأ بـ 077 أو 078 أو 079'); return; }
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

  return (
    <div className="max-w-xl">
      <div className="flex items-center gap-3 mb-5">
        <Link to="/admin/accounts" className="text-gray-400 hover:text-gray-600" aria-label="رجوع">
          <ArrowRight size={18} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">زبون جديد</h1>
      </div>

      {result ? (
        <ResultCard result={result} ownerName={ownerFirst}
          onAnother={() => { setResult(null); setForm(DEFAULTS); setAdvanced(false); }} />
      ) : (
        <form onSubmit={handleInvite} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5 sm:p-6 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>
          )}

          <Field label="اسم المحل" required>
            <input value={form.name} onChange={(e) => set('name', e.target.value)} className={inputClass} placeholder="مطعم الشام" />
          </Field>

          <Field label="نوع النشاط" required>
            <div className="flex flex-wrap gap-2">
              {SECTORS.map(([value, label]) => (
                <button key={value} type="button" onClick={() => set('sector', value)}
                  className={`px-3 h-10 rounded-full border text-sm ${form.sector === value
                    ? 'border-green-600 bg-green-50 text-green-900'
                    : 'border-gray-200 text-gray-700 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="اسم صاحب المحل" required>
              <input value={form.owner_name} onChange={(e) => set('owner_name', e.target.value)} className={inputClass} placeholder="أبو خالد" />
            </Field>
            <Field label="موبايل صاحب المحل" required hint="يدخل به إلى لوحته، وإليه تصل تنبيهاته">
              <input value={form.owner_phone} onChange={(e) => set('owner_phone', e.target.value)} className={inputClass}
                dir="ltr" inputMode="tel" autoComplete="off" placeholder="07XXXXXXXX" />
            </Field>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="البريد الإلكتروني (اختياري)">
              <input value={form.owner_email} onChange={(e) => set('owner_email', e.target.value)} className={inputClass}
                dir="ltr" inputMode="email" autoComplete="off" />
            </Field>
            <Field label="المدينة">
              <select value={form.city} onChange={(e) => set('city', e.target.value)} className={inputClass}>
                {CITIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
          </div>

          <p className="text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
            العرض: حملة إربد — الشهر الأول مجاني، يبدأ مع أول رد للبوت على زبون.
          </p>

          <button type="submit" disabled={submitting}
            className="w-full h-11 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700 disabled:opacity-50">
            {submitting ? 'جارٍ الإنشاء…' : 'أنشئ رابط الانضمام'}
          </button>

          {/* Hand-wired numbers only. Kept out of the way so the normal path never asks for an id. */}
          <div className="pt-2 border-t border-gray-100">
            <button type="button" onClick={() => setAdvanced((a) => !a)}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800">
              <ChevronDown size={15} className={advanced ? 'rotate-180 transition-transform' : 'transition-transform'} />
              متقدم
            </button>
            {advanced && (
              <div className="mt-3 space-y-3">
                <p className="text-xs text-gray-500">ربط يدوي لرقم موصول مسبقًا: يُنشئ الحساب بالاسم والنوع أعلاه، بلا صاحب محل ولا رابط انضمام.</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <Field label="Phone Number ID">
                    <input value={form.wa_phone_number_id} onChange={(e) => set('wa_phone_number_id', e.target.value)}
                      className={`${inputClass} font-mono`} dir="ltr" placeholder="123456789012345" />
                  </Field>
                  <Field label="WABA ID">
                    <input value={form.wa_business_account_id} onChange={(e) => set('wa_business_account_id', e.target.value)}
                      className={`${inputClass} font-mono`} dir="ltr" placeholder="987654321098765" />
                  </Field>
                </div>
                <p className="text-xs text-gray-400">مفتاح الوصول يُضاف بعد الإنشاء من صفحة الحساب.</p>
                <button type="button" onClick={handleManual} disabled={submitting}
                  className="h-10 px-4 rounded-lg border border-gray-300 text-sm text-gray-800 hover:bg-gray-50 disabled:opacity-50">
                  أنشئ الحساب بربط يدوي
                </button>
              </div>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
