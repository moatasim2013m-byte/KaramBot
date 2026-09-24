import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Copy, Check, RefreshCw, LogIn } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Timestamp, Ltr, SkeletonRows, EmptyState } from '../shared/Primitives';

/**
 * Handing the account over to the customer.
 *
 * The screen deliberately never shows or sets a password: it produces a one-time link that the
 * customer redeems themselves. SHIFT staff can hand over an account without ever holding a
 * customer's credentials, and the link is the only thing that needs sending.
 */

const ROLE_LABEL = { business_owner: 'صاحب المنشأة', manager: 'مدير', staff: 'موظف' };

function LinkBox({ path, onDone }) {
  const [copied, setCopied] = useState(false);
  const url = `${window.location.origin}${path}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false); // clipboard blocked — the text is selectable below anyway
    }
  };

  return (
    <div className="mt-3 border border-emerald-200 bg-emerald-50 rounded-md p-3">
      <p className="text-[13px] font-medium text-emerald-900">الرابط جاهز — أرسله للعميل</p>
      <p className="text-[11px] text-emerald-800 mt-0.5">
        يعمل مرة واحدة وينتهي خلال 72 ساعة. العميل يختار كلمة المرور بنفسه.
      </p>
      <div className="flex gap-2 mt-2">
        <input
          readOnly value={url} onFocus={(e) => e.target.select()} dir="ltr"
          className="flex-1 h-8 px-2 text-xs font-mono bg-white border border-emerald-200 rounded"
        />
        <button onClick={copy} className="flex items-center gap-1 px-2.5 h-8 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'نُسخ' : 'نسخ'}
        </button>
      </div>
      <button onClick={onDone} className="mt-2 text-[11px] text-emerald-800 underline underline-offset-2">تم</button>
    </div>
  );
}

export default function AccountAccessTab({ accountId }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'business_owner' });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    api.get(`/admin/accounts/${accountId}/users`)
      .then((res) => setUsers(res.data.users))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المستخدمين'));
  }, [accountId]);

  useEffect(() => { load(); }, [load]);

  const create = async (e) => {
    e.preventDefault();
    setCreating(true); setError(null);
    try {
      const res = await api.post(`/admin/accounts/${accountId}/users`, form);
      setLink(res.data.activation_path);
      setForm({ name: '', email: '', role: 'business_owner' });
      setOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إنشاء المستخدم');
    } finally { setCreating(false); }
  };

  const reinvite = async (userId) => {
    setError(null);
    try {
      const res = await api.post(`/admin/accounts/${accountId}/users/${userId}/invite`);
      setLink(res.data.activation_path);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إصدار رابط جديد');
    }
  };

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {link && <LinkBox path={link} onDone={() => setLink(null)} />}

      <Panel
        title="مستخدمو الحساب"
        action={
          <button onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900">
            <UserPlus size={14} />
            إضافة مستخدم
          </button>
        }
      >
        {open && (
          <form onSubmit={create} className="p-4 border-b border-gray-100 bg-gray-50 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-3">
              <input
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="الاسم" required
                className="h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <input
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="البريد الإلكتروني" type="email" required dir="ltr"
                className="h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
              />
              <select
                value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="h-8 px-2 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400"
              >
                {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={creating} className="bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40">
                {creating ? 'جارٍ...' : 'إنشاء وإصدار رابط'}
              </button>
              <span className="text-[11px] text-gray-500">لن تضع كلمة مرور — العميل يختارها بنفسه</span>
            </div>
          </form>
        )}

        {!users ? (
          <SkeletonRows rows={3} cols={4} />
        ) : users.length === 0 ? (
          <EmptyState
            icon={UserPlus} tone="neutral"
            title="لا يستطيع أحد الدخول لهذا الحساب بعد"
            hint="أنشئ مستخدمًا لصاحب المنشأة وأرسل له الرابط"
          />
        ) : (
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                {['الاسم', 'البريد', 'الصلاحية', 'الحالة', 'آخر دخول', ''].map((h) => (
                  <th key={h} className="text-right font-medium px-4 h-9 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {users.map((u) => (
                <tr key={u.id} className="hover:bg-gray-50">
                  <td className="px-4 h-9 font-medium text-gray-900 whitespace-nowrap">{u.name}</td>
                  <td className="px-4 h-9 text-gray-600"><Ltr className="text-xs">{u.email}</Ltr></td>
                  <td className="px-4 h-9 text-gray-600 whitespace-nowrap">{ROLE_LABEL[u.role] || u.role}</td>
                  <td className="px-4 h-9 whitespace-nowrap">
                    {u.has_signed_in ? (
                      <span className="inline-flex items-center gap-1 text-emerald-700"><LogIn size={12} /> دخل</span>
                    ) : u.invitation_pending_until ? (
                      <span className="text-amber-700">دعوة قائمة</span>
                    ) : (
                      <span className="text-gray-400">لم يُفعَّل</span>
                    )}
                  </td>
                  <td className="px-4 h-9 text-gray-500 whitespace-nowrap"><Timestamp value={u.last_login} /></td>
                  <td className="px-4 h-9 text-left">
                    <button
                      onClick={() => reinvite(u.id)}
                      className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900"
                      title="إصدار رابط جديد"
                    >
                      <RefreshCw size={12} />
                      رابط جديد
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}
