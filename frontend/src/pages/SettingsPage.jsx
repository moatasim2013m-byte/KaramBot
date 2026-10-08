import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Save, ExternalLink, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import api from '../utils/api';
import { StatusDot, Timestamp, Ltr } from '../components/shared/Primitives';
import { ClaimCardButton, ConnectInline } from '../components/whatsapp/OwnerSetupActions';
import {
  isConnected, isRevoked, ownerCanConnect, nameStatusAr, qualityAr, paymentCardAr, shiftWaLink, helpText,
} from '../components/whatsapp/panelView';

/**
 * «الإعدادات» — three tabs: واتساب · المحل · حسابي.
 *
 * واتساب is one card in plain Arabic: the shop's number, the name customers see and whether Meta
 * approved it, the number's quality, and the payment card at Meta. No raw Meta ids and no token
 * box (spec «الإعدادات»): an owner has nothing to do with either, and the ids invited support
 * calls about «Phone Number ID». The bot's own settings moved to «البوت»; everyone else (managers,
 * staff) sees only «حسابي».
 */

const MANAGER_URL = 'https://business.facebook.com/wa/manage/home/';
const TYPE_AR = { restaurant: 'مطعم', clinic: 'عيادة', generic: 'محل', shift: 'شِفت' };

const inputClass = 'w-full rounded-md border border-gray-200 px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-green-500';

function Card({ title, children, footer }) {
  return (
    <section className="rounded-xl border border-gray-200 bg-white mb-4">
      {title && (
        <header className="flex items-center px-4 h-11 border-b border-gray-100">
          <h3 className="text-[14px] font-semibold text-gray-800">{title}</h3>
        </header>
      )}
      <div className="p-4 space-y-3">{children}</div>
      {footer}
    </section>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-[13px] text-gray-600 mb-1">{label}</span>
      {children}
    </label>
  );
}

function Row({ label, children }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 border-b border-gray-50 last:border-0">
      <dt className="text-[13px] text-gray-500">{label}</dt>
      <dd className="text-[14px] text-gray-900 flex items-center gap-1.5">{children}</dd>
    </div>
  );
}

// ─── واتساب ───────────────────────────────────────────────────────────────────
function WhatsAppTab({ user }) {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const load = useCallback(() => {
    api.get('/whatsapp/status')
      .then((res) => { setStatus(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر قراءة حالة واتساب'));
  }, []);
  useEffect(() => { load(); }, [load]);

  if (error) return <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>;
  if (!status) return <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  const connected = isConnected(status);
  const revoked = isRevoked(status);
  const canConnect = ownerCanConnect(status);
  const number = status.number || {};
  const nameStatus = nameStatusAr(number.name_status);
  const quality = qualityAr(number.quality_rating);
  const card = paymentCardAr(status);

  return (
    <>
      <Card title="رقم واتساب المحل">
        {!connected || revoked ? (
          <>
            <p className="text-[14px] text-gray-800">
              {revoked ? 'انفصل كرم بوت عن حسابك في Meta — أعد الربط ليعود البوت للرد.' : 'واتساب غير مربوط بعد.'}
            </p>
            {canConnect ? (
              <ConnectInline onDone={load} label={revoked ? 'أعد الربط' : 'اربط واتساب'} />
            ) : (
              <p className="text-[13px] text-gray-600">فريق شِفت يربط الرقم معك — لا شيء عليك هنا.</p>
            )}
          </>
        ) : (
          <dl>
            <Row label="رقم المحل">{number.display ? <Ltr>{number.display}</Ltr> : '—'}</Row>
            <Row label="الاسم الذي يراه زبائنك">
              {number.verified_name || '—'}
              {nameStatus && <span className="text-[12px] text-gray-500">— {nameStatus}</span>}
            </Row>
            <Row label="جودة الرقم لدى Meta"><StatusDot state={quality.state} /> {quality.label}</Row>
            <Row label="بطاقة الدفع لدى Meta"><StatusDot state={card.state} /> {card.label}</Row>
            <Row label="آخر رسالة من زبون"><Timestamp value={status.last_inbound_at} /></Row>
            <Row label="آخر رد من البوت"><Timestamp value={status.last_outbound_at} /></Row>
          </dl>
        )}
        {connected && !revoked && (card.key === 'missing' || card.key === 'blocked') && (
          <div className="flex flex-wrap items-center gap-3">
            <a href={MANAGER_URL} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 mt-1.5 text-[13px] font-medium text-amber-900 underline underline-offset-2">
              افتح WhatsApp Manager <ExternalLink size={12} />
            </a>
            {card.key === 'missing' && <ClaimCardButton onDone={load} />}
          </div>
        )}
      </Card>

      <p className="text-[12px] text-gray-500 px-1">
        لتغيير رقم المحل أو أي مشكلة في الربط{' '}
        <a href={shiftWaLink(`${helpText(user)} — بخصوص رقم واتساب المحل`)} target="_blank" rel="noopener noreferrer"
          className="text-green-700 underline underline-offset-2">راسل شِفت على واتساب</a>.
      </p>
    </>
  );
}

// ─── المحل ────────────────────────────────────────────────────────────────────
function ShopTab({ user }) {
  const [biz, setBiz] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    api.get(`/businesses/${user.business_id}`)
      .then((r) => setBiz(r.data.business))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر التحميل'));
  }, [user.business_id]);

  const set = (key, value) => setBiz((b) => ({ ...b, [key]: value }));
  const setPolicy = (key, value) => setBiz((b) => ({ ...b, policies: { ...(b.policies || {}), [key]: value } }));
  const isRestaurant = biz?.business_type === 'restaurant';

  const save = async () => {
    setBusy(true); setError(null);
    try {
      // No ai_config here: the bot's settings live on «البوت», and the pause is never a form field.
      await api.patch(`/businesses/${biz.id}`, {
        name: biz.name,
        address: biz.address,
        currency: biz.currency,
        ...(isRestaurant ? { policies: biz.policies } : {}),
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  if (!biz) return error ? <p className="text-sm text-red-700">{error}</p> : <div className="text-center py-16 text-gray-400">جاري التحميل...</div>;

  const footer = (
    <div className="flex items-center gap-3 px-4 py-3 border-t border-gray-100">
      <button type="button" onClick={save} disabled={busy}
        className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-green-600 text-white text-[13px] font-medium disabled:opacity-50">
        {busy ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />} احفظ
      </button>
      {saved && <span className="text-[12px] text-emerald-700">تم الحفظ</span>}
      {error && <span className="text-[12px] text-red-700">{error}</span>}
    </div>
  );

  return (
    <>
      <Card title="معلومات المحل" footer={isRestaurant ? null : footer}>
        <Field label="الاسم">
          <input value={biz.name || ''} onChange={(e) => set('name', e.target.value)} className={inputClass} />
        </Field>
        <Field label="النوع">
          <input value={TYPE_AR[biz.business_type] || 'محل'} disabled className={`${inputClass} bg-gray-50 text-gray-500`} />
        </Field>
        <Field label="العنوان">
          <input value={biz.address || ''} onChange={(e) => set('address', e.target.value)} className={inputClass} />
        </Field>
        <Field label="العملة">
          <select value={biz.currency || 'JOD'} onChange={(e) => set('currency', e.target.value)} className={inputClass}>
            <option value="JOD">دينار أردني</option>
            <option value="USD">دولار أمريكي</option>
            {biz.currency && !['JOD', 'USD'].includes(biz.currency) && <option value={biz.currency}>{biz.currency}</option>}
          </select>
        </Field>
      </Card>

      {isRestaurant && (
        <Card title="سياسات الطلبات" footer={footer}>
          <Field label="رسوم التوصيل (د.أ)">
            <input type="number" step="0.1" min="0" value={biz.policies?.delivery_fee ?? 0} dir="ltr"
              onChange={(e) => setPolicy('delivery_fee', parseFloat(e.target.value) || 0)} className={inputClass} />
          </Field>
          <Field label="الحد الأدنى للطلب (د.أ)">
            <input type="number" step="0.1" min="0" value={biz.policies?.min_order_amount ?? 0} dir="ltr"
              onChange={(e) => setPolicy('min_order_amount', parseFloat(e.target.value) || 0)} className={inputClass} />
          </Field>
          <Field label="سياسة التوصيل">
            <textarea rows={2} value={biz.policies?.delivery_policy || ''} onChange={(e) => setPolicy('delivery_policy', e.target.value)}
              className={`${inputClass} resize-none`} />
          </Field>
        </Card>
      )}
    </>
  );
}

// ─── حسابي ────────────────────────────────────────────────────────────────────
// No password change here yet: the server has no endpoint for it. A forgotten password is reset
// by SHIFT («إعادة ضبط الدخول»), so the honest offer is the WhatsApp line to them.
function AccountTab({ user }) {
  return (
    <Card title="حسابي">
      <dl>
        <Row label="الاسم">{user?.name || '—'}</Row>
        {user?.phone && <Row label="الموبايل"><Ltr>{user.phone}</Ltr></Row>}
        {user?.email && <Row label="البريد الإلكتروني"><Ltr>{user.email}</Ltr></Row>}
      </dl>
      <p className="text-[12px] text-gray-500">
        نسيت كلمة المرور أو تريد تغييرها؟{' '}
        <a href={shiftWaLink(`${helpText(user)} — أريد رابطًا جديدًا لكلمة المرور`)} target="_blank" rel="noopener noreferrer"
          className="text-green-700 underline underline-offset-2">راسل شِفت على واتساب</a> ونرسل لك رابطًا جديدًا.
      </p>
    </Card>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function SettingsPage() {
  const { user } = useAuth();
  const owner = user?.role === 'business_owner';
  const admin = user?.role === 'platform_admin';
  const tabs = owner
    ? [{ key: 'whatsapp', label: 'واتساب' }, { key: 'shop', label: 'المحل' }, { key: 'account', label: 'حسابي' }]
    : admin
      ? [{ key: 'shop', label: 'المحل' }, { key: 'account', label: 'حسابي' }]
      : [{ key: 'account', label: 'حسابي' }];
  const [tab, setTab] = useState(tabs[0].key);

  if (!user?.business_id && !admin) {
    return <p className="text-center py-16 text-gray-500 text-sm">لا يوجد حساب محل مرتبط بهذا المستخدم.</p>;
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold text-gray-800 mb-4">{tabs.length === 1 ? 'حسابي' : 'الإعدادات'}</h1>

      {/* SHIFT connects a shop's WhatsApp from the account's own page, where the account comes
          from the URL, never from whichever business an admin session happens to hold. */}
      {admin && user?.business_id && (
        <div className="mb-4 rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-700">
          ربط واتساب لهذا المحل يتم من صفحة الحساب في لوحة شِفت.{' '}
          <Link to={`/admin/accounts/${user.business_id}`} className="font-medium text-green-600 hover:underline">افتح «ربط واتساب»</Link>
        </div>
      )}

      {tabs.length > 1 && (
        <div className="flex gap-1 border-b border-gray-200 mb-4">
          {tabs.map(({ key, label }) => (
            <button key={key} type="button" onClick={() => setTab(key)}
              className={`px-4 h-11 text-[14px] font-medium border-b-2 -mb-px transition-colors ${
                tab === key ? 'border-green-600 text-green-700' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}>
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === 'whatsapp' && <WhatsAppTab user={user} />}
      {tab === 'shop' && user?.business_id && <ShopTab user={user} />}
      {tab === 'account' && <AccountTab user={user} />}
    </div>
  );
}
