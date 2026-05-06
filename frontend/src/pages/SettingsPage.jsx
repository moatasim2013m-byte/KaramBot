import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { Save, Smartphone } from 'lucide-react';

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
const inputDisabledClass = "w-full border border-gray-100 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 cursor-not-allowed";

// ─── WhatsApp Tab ──────────────────────────────────────────────────────────────
function WhatsAppTab({ biz, role }) {
  const isAdmin = role === 'platform_admin';

  const [phoneId, setPhoneId]       = useState(biz.wa_phone_number_id || '');
  const [accountId, setAccountId]   = useState(biz.wa_business_account_id || '');
  const [savingIds, setSavingIds]   = useState(false);
  const [savedIds, setSavedIds]     = useState(false);
  const [idsError, setIdsError]     = useState('');

  const [token, setToken]               = useState('');
  const [savingToken, setSavingToken]   = useState(false);
  const [savedToken, setSavedToken]     = useState(false);
  const [tokenError, setTokenError]     = useState('');

  const handleSaveIds = async () => {
    if (!phoneId.trim()) { setIdsError('Phone Number ID مطلوب'); return; }
    setSavingIds(true);
    setIdsError('');
    try {
      await api.patch(`/businesses/${biz.id}`, {
        wa_phone_number_id:     phoneId.trim(),
        wa_business_account_id: accountId.trim(),
      });
      setSavedIds(true);
      setTimeout(() => setSavedIds(false), 2500);
    } catch (err) {
      setIdsError(err.response?.data?.error || 'حدث خطأ أثناء الحفظ');
    } finally {
      setSavingIds(false);
    }
  };

  const handleSaveToken = async () => {
    if (!token.trim()) { setTokenError('أدخل قيمة التوكن'); return; }
    setSavingToken(true);
    setTokenError('');
    try {
      await api.patch(`/businesses/${biz.id}/token`, { wa_access_token: token.trim() });
      setToken(''); // clear after save — value must never persist in UI
      setSavedToken(true);
      setTimeout(() => setSavedToken(false), 3000);
    } catch (err) {
      setTokenError(err.response?.data?.error || 'حدث خطأ أثناء حفظ التوكن');
    } finally {
      setSavingToken(false);
    }
  };

  const hasIds = biz.wa_phone_number_id && biz.wa_business_account_id;

  return (
    <div>
      {!hasIds && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4 text-sm text-amber-700">
          لم يتم إعداد بيانات واتساب بعد.{' '}
          <a href="/docs/whatsapp-setup.md" target="_blank" rel="noreferrer"
            className="underline font-medium hover:text-amber-900">
            راجع دليل الإعداد
          </a>
        </div>
      )}

      <Section title="معرّفات واتساب">
        <Field label="Phone Number ID">
          <input
            value={phoneId}
            onChange={e => setPhoneId(e.target.value)}
            className={isAdmin ? inputClass : inputDisabledClass}
            disabled={!isAdmin}
            dir="ltr"
            placeholder="e.g. 123456789012345"
          />
        </Field>
        <Field label="WhatsApp Business Account ID">
          <input
            value={accountId}
            onChange={e => setAccountId(e.target.value)}
            className={isAdmin ? inputClass : inputDisabledClass}
            disabled={!isAdmin}
            dir="ltr"
            placeholder="e.g. 987654321098765"
          />
        </Field>
        {!isAdmin && (
          <p className="text-xs text-gray-400">تعديل المعرّفات متاح لمدير المنصة فقط.</p>
        )}
        {idsError && <p className="text-red-500 text-xs">{idsError}</p>}
        {isAdmin && (
          <button
            onClick={handleSaveIds}
            disabled={savingIds}
            className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
          >
            <Save size={15} />
            {savedIds ? '✅ تم الحفظ' : savingIds ? 'جاري الحفظ...' : 'حفظ المعرّفات'}
          </button>
        )}
      </Section>

      <Section title="Access Token (مشفّر)">
        <Field label="Token الجديد">
          <input
            type="password"
            value={token}
            onChange={e => setToken(e.target.value)}
            className={inputClass}
            dir="ltr"
            autoComplete="new-password"
            placeholder="أدخل التوكن هنا"
          />
        </Field>
        <p className="text-xs text-gray-400">
          القيمة الحالية لا تُعرض أبداً. الإدخال هنا يستبدل التوكن المحفوظ وتُخزَّن مشفّرة.
        </p>
        {savedToken && (
          <p className="text-green-600 text-sm font-medium">✅ تم حفظ التوكن (مشفّر)</p>
        )}
        {tokenError && <p className="text-red-500 text-xs">{tokenError}</p>}
        <button
          onClick={handleSaveToken}
          disabled={savingToken || !token.trim()}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
        >
          <Save size={15} />
          {savingToken ? 'جاري الحفظ...' : 'حفظ Token'}
        </button>
      </Section>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const [biz, setBiz]       = useState(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved]   = useState(false);
  const [tab, setTab]       = useState('general');

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
      await api.patch(`/businesses/${biz.id}`, {
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

  // No business scope — show notice
  if (!user?.business_id) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center gap-3">
        <p className="text-gray-600 text-sm">تحتاج إلى اختيار عمل من لوحة الإدارة</p>
        <Link to="/admin/businesses" className="text-green-600 hover:underline text-sm">
          الذهاب إلى إدارة الشركات
        </Link>
      </div>
    );
  }

  if (!biz) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  const tabs = [
    { key: 'general',   label: 'الإعدادات' },
    { key: 'whatsapp',  label: 'واتساب', icon: Smartphone },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold text-gray-800">الإعدادات</h1>
        {tab === 'general' && (
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600 disabled:opacity-50"
          >
            <Save size={16} />
            {saved ? '✅ تم الحفظ' : saving ? 'جاري الحفظ...' : 'حفظ التغييرات'}
          </button>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-200 mb-5">
        {tabs.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-1.5 px-4 py-2 text-sm font-medium border-b-2 transition-colors -mb-px ${
              tab === key
                ? 'border-green-500 text-green-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {Icon && <Icon size={14} />}
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'general' && (
        <>
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
        </>
      )}

      {tab === 'whatsapp' && <WhatsAppTab biz={biz} role={user?.role} />}
    </div>
  );
}
