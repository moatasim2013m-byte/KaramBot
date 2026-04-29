import React, { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { Save } from 'lucide-react';

function Section({ title, children }) {
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mb-4">
      <div className="bg-gray-50 px-5 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-700 text-sm">{title}</h3>
      </div>
      <div className="p-5 space-y-4">{children}</div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500";

export default function SettingsPage() {
  const { user } = useAuth();
  const [biz, setBiz] = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!user?.business_id) return;
    api.get(`/businesses/${user.business_id}`).then(r => setBiz(r.data.business)).catch(console.error);
  }, [user]);

  const set = (path, value) => {
    setBiz(prev => {
      const updated = { ...prev };
      const keys = path.split('.');
      let obj = updated;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return updated;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.patch(`/businesses/${biz._id}`, {
        name: biz.name,
        address: biz.address,
        currency: biz.currency,
        ai_config: biz.ai_config,
        policies: biz.policies,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      alert(err.response?.data?.error || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  if (!biz) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">الإعدادات</h1>
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
        >
          <Save size={16} />
          {saved ? '✅ تم الحفظ' : saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
        </button>
      </div>

      <Section title="معلومات المطعم">
        <Field label="اسم المطعم">
          <input value={biz.name || ''} onChange={e => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="العنوان">
          <input value={biz.address || ''} onChange={e => set('address', e.target.value)} className={inputClass} />
        </Field>
        <Field label="العملة">
          <input value={biz.currency || 'JOD'} onChange={e => set('currency', e.target.value)} className={inputClass} dir="ltr" />
        </Field>
      </Section>

      <Section title="إعدادات الذكاء الاصطناعي">
        <Field label="تفعيل الذكاء الاصطناعي">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={biz.ai_config?.enabled ?? true}
              onChange={e => set('ai_config.enabled', e.target.checked)} />
            <span className="text-sm text-gray-600">مفعّل</span>
          </label>
        </Field>
        <Field label="شخصية المساعد">
          <input value={biz.ai_config?.personality || ''} onChange={e => set('ai_config.personality', e.target.value)} className={inputClass} />
        </Field>
        <Field label="رسالة الترحيب">
          <textarea rows={3} value={biz.ai_config?.greeting_message || ''} onChange={e => set('ai_config.greeting_message', e.target.value)}
            className={`${inputClass} resize-none`} />
        </Field>
        <Field label="رسالة التحويل للموظف">
          <input value={biz.ai_config?.fallback_message || ''} onChange={e => set('ai_config.fallback_message', e.target.value)} className={inputClass} />
        </Field>
        <Field label="كلمات التحويل للموظف (مفصولة بفاصلة)">
          <input
            value={(biz.ai_config?.handoff_keywords || []).join(', ')}
            onChange={e => set('ai_config.handoff_keywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
            className={inputClass}
          />
        </Field>
      </Section>

      <Section title="سياسات الطلبات">
        <Field label="رسوم التوصيل (JOD)">
          <input type="number" step="0.1" min="0" value={biz.policies?.delivery_fee || 0}
            onChange={e => set('policies.delivery_fee', parseFloat(e.target.value))} className={inputClass} dir="ltr" />
        </Field>
        <Field label="الحد الأدنى للطلب (JOD)">
          <input type="number" step="0.1" min="0" value={biz.policies?.min_order_amount || 0}
            onChange={e => set('policies.min_order_amount', parseFloat(e.target.value))} className={inputClass} dir="ltr" />
        </Field>
        <Field label="سياسة التوصيل">
          <textarea rows={2} value={biz.policies?.delivery_policy || ''} onChange={e => set('policies.delivery_policy', e.target.value)}
            className={`${inputClass} resize-none`} />
        </Field>
      </Section>
    </div>
  );
}
