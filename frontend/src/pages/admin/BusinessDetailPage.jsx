import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import api from '../../utils/api';
import { Save, Smartphone, ArrowRight } from 'lucide-react';

// ─── Shared primitives ────────────────────────────────────────────────────────
const inputClass = "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500";
const inputDisabledClass = "w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed";

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

// ─── WhatsApp Tab (admin always has full access) ───────────────────────────────
function WhatsAppTab({ biz }) {
  const [phoneId, setPhoneId]       = useState(biz.wa_phone_number_id || '');
  const [accountId, setAccountId]   = useState(biz.wa_business_account_id || '');
  const [savingIds, setSavingIds]   = useState(false);
  const [savedIds, setSavedIds]     = useState(false);
  const [idsError, setIdsError]     = useState('');

  const [token, setToken]             = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [savedToken, setSavedToken]   = useState(false);
  const [tokenError, setTokenError]   = useState('');

  const handleSaveIds = async () => {
    if (!phoneId.trim()) { setIdsError('Phone Number ID مطلوب'); return; }
    setSavingIds(true); setIdsError('');
    try {
      await api.patch(`/businesses/${biz.id}`, {
        wa_phone_number_id:     phoneId.trim(),
        wa_business_account_id: accountId.trim(),
      });
      setSavedIds(true);
      setTimeout(() => setSavedIds(false), 2500);
    } catch (err) {
      setIdsError(err.response?.data?.error || 'حدث خطأ أثناء الحفظ');
    } finally { setSavingIds(false); }
  };

  const handleSaveToken = async () => {
    if (!token.trim()) { setTokenError('أدخل قيمة التوكن'); return; }
    setSavingToken(true); setTokenError('');
    try {
      await api.patch(`/businesses/${biz.id}/token`, { wa_access_token: token.trim() });
      setToken('');
      setSavedToken(true);
      setTimeout(() => setSavedToken(false), 3000);
    } catch (err) {
      setTokenError(err.response?.data?.error || 'حدث خطأ أثناء حفظ التوكن');
    } finally { setSavingToken(false); }
  };

  const hasIds = biz.wa_phone_number_id && biz.wa_business_account_id;

  // Status: RED = IDs missing | GREEN = IDs + token saved this session | YELLOW = IDs only
  const statusBox = !hasIds ? (
    <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-lg px-4 py-3 mb-4 text-sm text-red-700">
      <span className="mt-0.5 text-base leading-none">&#9888;</span>
      <span>WhatsApp غير مكتمل — أدخل Phone Number ID و WABA ID</span>
    </div>
  ) : savedToken ? (
    <div className="flex items-start gap-3 bg-green-50 border border-green-200 rounded-lg px-4 py-3 mb-4 text-sm text-green-700">
      <span className="mt-0.5 text-base leading-none">&#10003;</span>
      <span>واتساب مهيأ — تأكد أن Webhook مشترك في Meta</span>
    </div>
  ) : (
    <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-700">
      <span className="mt-0.5 text-base leading-none">&#9432;</span>
      <span>تم إدخال أرقام واتساب. إذا لم تكن متأكدًا من التوكن، أعد حفظ Access Token.</span>
    </div>
  );

  return (
    <div>
      {statusBox}

      <Section title="معرّفات واتساب">
        <Field label="Phone Number ID">
          <input value={phoneId} onChange={e => setPhoneId(e.target.value)}
            className={inputClass} dir="ltr" placeholder="e.g. 123456789012345" />
        </Field>
        <Field label="WhatsApp Business Account ID">
          <input value={accountId} onChange={e => setAccountId(e.target.value)}
            className={inputClass} dir="ltr" placeholder="e.g. 987654321098765" />
        </Field>
        {idsError && <p className="text-red-500 text-xs">{idsError}</p>}
        <button onClick={handleSaveIds} disabled={savingIds}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50">
          <Save size={15} />
          {savedIds ? '✅ تم الحفظ' : savingIds ? 'جاري الحفظ...' : 'حفظ المعرّفات'}
        </button>
      </Section>

      <Section title="Access Token (مشفّر)">
        <Field label="Token الجديد">
          <input type="password" value={token} onChange={e => setToken(e.target.value)}
            className={inputClass} dir="ltr" autoComplete="new-password"
            placeholder="أدخل التوكن هنا" />
        </Field>
        <p className="text-xs text-gray-400">
          القيمة الحالية لا تُعرض أبداً. الإدخال هنا يستبدل التوكن المحفوظ وتُخزَّن مشفّرة.
        </p>
        {savedToken && <p className="text-green-600 text-sm font-medium">✅ تم حفظ التوكن (مشفّر)</p>}
        {tokenError && <p className="text-red-500 text-xs">{tokenError}</p>}
        <button onClick={handleSaveToken} disabled={savingToken || !token.trim()}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50">
          <Save size={15} />
          {savingToken ? 'جاري الحفظ...' : 'حفظ Token'}
        </button>
      </Section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function BusinessDetailPage() {
  const { id } = useParams();
  const [biz, setBiz]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]   = useState('');
  const [tab, setTab]       = useState('general');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    api.get(`/businesses/${id}`)
      .then(r => setBiz(r.data.business))
      .catch(e => setError(e.response?.data?.error || 'لم يتم العثور على العمل'))
      .finally(() => setLoading(false));
  }, [id]);

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

  const handleSave = async (payload) => {
    setSaving(true); setSaveError('');
    try {
      const res = await api.patch(`/businesses/${biz.id}`, payload);
      setBiz(prev => ({ ...prev, ...res.data.business }));
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setSaveError(err.response?.data?.error || 'حدث خطأ أثناء الحفظ');
    } finally { setSaving(false); }
  };

  const TABS = [
    { key: 'general',  label: 'عام' },
    { key: 'ai',       label: 'الذكاء الاصطناعي' },
    { key: 'policies', label: 'السياسات' },
    { key: 'whatsapp', label: 'واتساب', icon: Smartphone },
  ];

  const SaveBtn = ({ payload }) => (
    <button onClick={() => handleSave(payload)} disabled={saving}
      className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50">
      <Save size={15} />
      {saved ? '✅ تم الحفظ' : saving ? 'جاري الحفظ...' : 'حفظ'}
    </button>
  );

  if (loading) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;
  if (error)   return <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg">{error}</div>;
  if (!biz)    return null;

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Link to="/admin/businesses" className="text-gray-400 hover:text-gray-600">
          <ArrowRight size={18} />
        </Link>
        <div>
          <h1 className="text-xl font-bold text-gray-800">{biz.name}</h1>
          <p className="text-xs text-gray-400 font-mono">{biz.slug}</p>
        </div>
      </div>

      {saveError && (
        <div className="bg-red-50 border border-red-200 text-red-600 text-sm px-4 py-2 rounded-lg mb-3">
          {saveError}
        </div>
      )}

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-5 mt-4">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => { setTab(key); setSaveError(''); setSaved(false); }}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key ? 'border-green-500 text-green-600' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {Icon && <Icon size={14} />}
            {label}
          </button>
        ))}
      </div>

      {/* General tab */}
      {tab === 'general' && (
        <div>
          <Section title="معلومات العمل">
            <Field label="الاسم">
              <input value={biz.name || ''} onChange={e => set('name', e.target.value)} className={inputClass} />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Slug (للقراءة فقط)">
                <input value={biz.slug || ''} className={inputDisabledClass} disabled dir="ltr" />
              </Field>
              <Field label="نوع العمل (للقراءة فقط)">
                <input value={biz.business_type || ''} className={inputDisabledClass} disabled />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="الحالة">
                <select value={biz.status || 'active'} onChange={e => set('status', e.target.value)} className={inputClass}>
                  <option value="active">نشط</option>
                  <option value="inactive">غير نشط</option>
                  <option value="suspended">موقوف</option>
                </select>
              </Field>
              <Field label="اللغة الافتراضية">
                <select value={biz.language_default || 'ar'} onChange={e => set('language_default', e.target.value)} className={inputClass}>
                  <option value="ar">العربية</option>
                  <option value="en">English</option>
                </select>
              </Field>
              <Field label="العملة">
                <input value={biz.currency || ''} onChange={e => set('currency', e.target.value)} className={inputClass} dir="ltr" />
              </Field>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="المنطقة الزمنية">
                <input value={biz.timezone || ''} onChange={e => set('timezone', e.target.value)} className={`${inputClass} font-mono`} dir="ltr" />
              </Field>
              <Field label="العنوان">
                <input value={biz.address || ''} onChange={e => set('address', e.target.value)} className={inputClass} />
              </Field>
            </div>
          </Section>
          <div className="flex justify-end">
            <SaveBtn payload={{ name: biz.name, address: biz.address, currency: biz.currency, timezone: biz.timezone, language_default: biz.language_default, status: biz.status }} />
          </div>
        </div>
      )}

      {/* AI tab */}
      {tab === 'ai' && (
        <div>
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
            <Field label="رسالة عند خارج أوقات العمل">
              <textarea rows={2} value={biz.ai_config?.out_of_hours_message || ''} onChange={e => set('ai_config.out_of_hours_message', e.target.value)}
                className={`${inputClass} resize-none`} />
            </Field>
            <Field label="رسالة التحويل للموظف">
              <input value={biz.ai_config?.fallback_message || ''} onChange={e => set('ai_config.fallback_message', e.target.value)} className={inputClass} />
            </Field>
            <Field label="كلمات التحويل (مفصولة بفاصلة)">
              <input
                value={(biz.ai_config?.handoff_keywords || []).join(', ')}
                onChange={e => set('ai_config.handoff_keywords', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className={inputClass} />
            </Field>
          </Section>
          <div className="flex justify-end">
            <SaveBtn payload={{ ai_config: biz.ai_config }} />
          </div>
        </div>
      )}

      {/* Policies tab */}
      {tab === 'policies' && (
        <div>
          <Section title="سياسات الطلبات">
            <Field label="رسوم التوصيل">
              <input type="number" step="0.1" min="0" value={biz.policies?.delivery_fee ?? 0}
                onChange={e => set('policies.delivery_fee', parseFloat(e.target.value))} className={inputClass} dir="ltr" />
            </Field>
            <Field label="الحد الأدنى للطلب">
              <input type="number" step="0.1" min="0" value={biz.policies?.min_order_amount ?? 0}
                onChange={e => set('policies.min_order_amount', parseFloat(e.target.value))} className={inputClass} dir="ltr" />
            </Field>
            <Field label="طرق الدفع (مفصولة بفاصلة)">
              <input
                value={(biz.policies?.payment_methods || []).join(', ')}
                onChange={e => set('policies.payment_methods', e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                className={inputClass} />
            </Field>
            <Field label="سياسة التوصيل">
              <textarea rows={2} value={biz.policies?.delivery_policy || ''} onChange={e => set('policies.delivery_policy', e.target.value)}
                className={`${inputClass} resize-none`} />
            </Field>
          </Section>
          <div className="flex justify-end">
            <SaveBtn payload={{ policies: biz.policies }} />
          </div>
        </div>
      )}

      {/* WhatsApp tab */}
      {tab === 'whatsapp' && <WhatsAppTab biz={biz} />}
    </div>
  );
}
