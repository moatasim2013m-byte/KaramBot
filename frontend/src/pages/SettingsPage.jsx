import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { Save, Smartphone } from 'lucide-react';
import WhatsAppStatusCard from '../components/whatsapp/WhatsAppStatusCard';
import TryTheBot from '../components/whatsapp/TryTheBot';
import BusinessKnowledge from '../components/whatsapp/BusinessKnowledge';
import BotPauseControl from '../components/admin/BotPauseControl';

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

      {/* No token box here: a WhatsApp token is set by SHIFT (admin account page, or Embedded
          Signup), and PATCH /businesses/:id/token is platform_admin only. */}
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
  // null while not being edited, so the field shows the saved numbers; a string while typing,
  // so a comma survives long enough to type the number after it.
  const [alertNumbersText, setAlertNumbersText] = useState(null);

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
      // Save without leaving the alert-numbers field must not lose what was typed: blur happening
      // before click is browser behaviour, not a guarantee worth depending on.
      const aiConfig = alertNumbersText === null ? { ...(biz.ai_config || {}) } : {
        ...biz.ai_config,
        alert_wa_numbers: alertNumbersText.split(',').map(s => s.trim()).filter(Boolean),
      };
      // The pause is not a form field: it has its own route (PATCH /admin/accounts/:id/bot) that
      // logs bot_paused/bot_resumed with a reason. A form opened before a pause would otherwise
      // switch the bot back on when the greeting is saved, with nothing in the log.
      delete aiConfig.enabled;
      await api.patch(`/businesses/${biz.id}`, {
        name: biz.name,
        address: biz.address,
        currency: biz.currency,
        ai_config: aiConfig,
        policies: biz.policies,
      });
      setAlertNumbersText(null);
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
        <Link to="/admin/accounts" className="text-green-600 hover:underline text-sm">
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
          {/* SHIFT connects a shop's WhatsApp from the account's own page (الحالة › ربط واتساب),
              where the account comes from the URL. The copy that lived here bound the signup to
              whichever business the admin's session happened to hold. */}
          {user?.role === 'platform_admin' ? (
            <div className="mb-5 rounded-xl border border-gray-100 bg-white p-4 text-sm text-gray-700">
              ربط واتساب لهذا المحل يتم من صفحة الحساب في لوحة شِفت.{' '}
              <Link to={`/admin/accounts/${biz.id}`} className="font-medium text-green-600 hover:underline">
                افتح «ربط واتساب»
              </Link>
            </div>
          ) : (
            // The customer's answer to «هل واتسابي موصول؟» — the first thing on their Settings,
            // because it was the first thing both walkthrough personas went looking for.
            <div className="mb-5 space-y-4">
              <WhatsAppStatusCard />
              {/* Only where the knowledge is not already a menu or a service list. */}
              {!['restaurant', 'clinic'].includes(user?.business_type) && <BusinessKnowledge />}
              <TryTheBot />
            </div>
          )}

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
            <Field label="حالة البوت">
              {user?.role === 'platform_admin' ? (
                <BotPauseControl accountId={biz.id} enabled={biz.ai_config?.enabled !== false}
                  onChange={enabled => setBiz(prev => ({ ...prev, ai_config: { ...(prev.ai_config || {}), enabled } }))} />
              ) : (
                <p className="text-sm text-gray-600">
                  {biz.ai_config?.enabled === false
                    ? 'البوت موقوف مؤقتًا. تواصل مع فريق شِفت لإعادة تشغيله.'
                    : 'البوت يعمل ويرد على العملاء.'}
                </p>
              )}
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
            {/* Without a number here the bot has no way to reach a person: a customer asking for
                one, a technical fault, or WhatsApp refusing to deliver all pass unnoticed. */}
            <Field label="أرقام واتساب للتنبيهات (مفصولة بفاصلة)">
              {/* Held as raw text while editing: splitting on every keystroke swallowed the
                  comma the moment it was typed, so a second number could not be entered. */}
              <input
                value={alertNumbersText ?? (biz.ai_config?.alert_wa_numbers || []).join(', ')}
                onChange={e => setAlertNumbersText(e.target.value)}
                onBlur={() => {
                  if (alertNumbersText === null) return;
                  set('ai_config.alert_wa_numbers', alertNumbersText.split(',').map(s => s.trim()).filter(Boolean));
                  setAlertNumbersText(null);
                }}
                className={inputClass}
                dir="ltr"
                placeholder="0796381676"
              />
              <p className="mt-1 text-xs text-gray-500">
                منرسل على هذي الأرقام لما زبون يطلب موظف، أو لما يصير خطأ بالبوت، أو لما واتساب يرفض يوصّل رسالة.
                بدون رقم هنا، ما حد بيعرف.
              </p>
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
