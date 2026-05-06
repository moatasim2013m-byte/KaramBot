import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { Save, ArrowRight } from 'lucide-react';

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500";

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">
        {label}{required && <span className="text-red-500 mr-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const DEFAULTS = {
  name: '', slug: '', business_type: 'generic', language_default: 'ar',
  timezone: 'Asia/Amman', currency: 'JOD', address: '',
  wa_phone_number_id: '', wa_business_account_id: '',
};

function toSlug(str) {
  return str.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

export default function CreateBusinessPage() {
  const [form, setForm]         = useState(DEFAULTS);
  const [slugTouched, setSlugTouched] = useState(false);
  const [submitting, setSubmitting]   = useState(false);
  const [error, setError]             = useState('');
  const navigate = useNavigate();

  const set = (key, val) => setForm(prev => ({ ...prev, [key]: val }));

  const handleNameChange = (val) => {
    set('name', val);
    if (!slugTouched) set('slug', toSlug(val));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.name.trim())             { setError('الاسم مطلوب'); return; }
    if (!form.slug.trim())             { setError('Slug مطلوب'); return; }
    if (!/^[a-z0-9-]+$/.test(form.slug)) { setError('Slug: أحرف إنجليزية صغيرة وأرقام وشرطات فقط'); return; }

    setSubmitting(true);
    setError('');
    try {
      const body = Object.fromEntries(
        Object.entries(form).filter(([, v]) => v !== '')
      );
      const res = await api.post('/businesses', body);
      navigate(`/admin/businesses/${res.data.business.id}`);
    } catch (err) {
      setError(err.response?.data?.error || 'حدث خطأ أثناء الإنشاء');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      {/* Header */}
      <div className="flex items-center gap-3 mb-5">
        <Link to="/admin/businesses" className="text-gray-400 hover:text-gray-600">
          <ArrowRight size={18} />
        </Link>
        <h1 className="text-xl font-bold text-gray-800">إضافة عمل جديد</h1>
      </div>

      <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-4">
        {error && (
          <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-3 rounded-lg">
            {error}
          </div>
        )}

        {/* Basic info */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="اسم العمل" required>
            <input
              value={form.name}
              onChange={e => handleNameChange(e.target.value)}
              className={inputClass}
              placeholder="مطعم الأصيل"
            />
          </Field>

          <Field label="Slug" required hint="أحرف إنجليزية صغيرة وأرقام وشرطات فقط">
            <input
              value={form.slug}
              onChange={e => { setSlugTouched(true); set('slug', e.target.value); }}
              className={`${inputClass} font-mono`}
              dir="ltr"
              placeholder="my-restaurant"
            />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="نوع العمل" required>
            <select value={form.business_type} onChange={e => set('business_type', e.target.value)} className={inputClass}>
              <option value="restaurant">مطعم</option>
              <option value="clinic">عيادة</option>
              <option value="generic">عام</option>
            </select>
          </Field>

          <Field label="اللغة الافتراضية">
            <select value={form.language_default} onChange={e => set('language_default', e.target.value)} className={inputClass}>
              <option value="ar">العربية</option>
              <option value="en">English</option>
            </select>
          </Field>

          <Field label="العملة">
            <input value={form.currency} onChange={e => set('currency', e.target.value)} className={inputClass} dir="ltr" placeholder="JOD" />
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="المنطقة الزمنية">
            <input value={form.timezone} onChange={e => set('timezone', e.target.value)} className={`${inputClass} font-mono`} dir="ltr" placeholder="Asia/Amman" />
          </Field>
          <Field label="العنوان">
            <input value={form.address} onChange={e => set('address', e.target.value)} className={inputClass} placeholder="عمّان، الأردن" />
          </Field>
        </div>

        {/* WhatsApp IDs */}
        <div className="pt-2 border-t border-gray-100">
          <p className="text-xs font-semibold text-gray-500 uppercase mb-3">معرّفات واتساب (اختياري)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Phone Number ID">
              <input value={form.wa_phone_number_id} onChange={e => set('wa_phone_number_id', e.target.value)} className={`${inputClass} font-mono`} dir="ltr" placeholder="123456789012345" />
            </Field>
            <Field label="Business Account ID">
              <input value={form.wa_business_account_id} onChange={e => set('wa_business_account_id', e.target.value)} className={`${inputClass} font-mono`} dir="ltr" placeholder="987654321098765" />
            </Field>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="flex items-center gap-2 bg-green-500 text-white px-6 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
          >
            <Save size={15} />
            {submitting ? 'جاري الإنشاء...' : 'إنشاء العمل'}
          </button>
        </div>
      </form>
    </div>
  );
}
