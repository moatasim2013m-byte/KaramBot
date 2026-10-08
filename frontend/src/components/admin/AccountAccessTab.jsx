import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Copy, Check, RefreshCw, LogIn, MessageCircle, Ban, RotateCcw, KeyRound } from 'lucide-react';
import api from '../../utils/api';
import { Panel, Timestamp, Ltr, SkeletonRows, EmptyState } from '../shared/Primitives';

/**
 * «الدخول» — who can sign in to this shop, and handing a login over.
 *
 * The screen never shows or sets a password: it produces a one-time link the person redeems
 * themselves, so SHIFT hands over an account without ever holding a customer's credentials.
 *
 * Per person: «رابط جديد» while the link is unused; «تعطيل» / «تفعيل»; the role; and «إعادة ضبط
 * الدخول» for an owner who is locked out, which deactivates the login, revokes every session and
 * outstanding link, and issues a new activation link — audited on the server, so a reset is
 * never a quiet way in for SHIFT.
 */

const ROLE_LABEL = { business_owner: 'صاحب المحل', manager: 'مدير', staff: 'موظف' };
const field = 'h-8 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400';

function LinkBox({ link, onDone }) {
  const [copied, setCopied] = useState(false);
  const url = link.url.startsWith('http') ? link.url : `${window.location.origin}${link.url}`;

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
    <div className="border border-emerald-200 bg-emerald-50 rounded-md p-3">
      <p className="text-[13px] font-medium text-emerald-900">الرابط جاهز — أرسله {link.name ? `لـ${link.name}` : ''}</p>
      <p className="text-[11px] text-emerald-800 mt-0.5">
        يعمل مرة واحدة{link.hours ? ` وينتهي خلال ${link.hours} ساعة` : ''}. يختار كلمة المرور بنفسه.
      </p>
      <div className="flex flex-wrap gap-2 mt-2">
        <input readOnly value={url} onFocus={(e) => e.target.select()} dir="ltr"
          className="flex-1 min-w-[200px] h-8 px-2 text-xs font-mono bg-white border border-emerald-200 rounded" />
        <button type="button" onClick={copy} className="flex items-center gap-1 px-2.5 h-8 bg-emerald-600 text-white rounded text-xs hover:bg-emerald-700">
          {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'نُسخ' : 'نسخ'}
        </button>
        {link.wa && (
          <a href={link.wa} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 px-2.5 h-8 border border-emerald-300 text-emerald-900 rounded text-xs hover:bg-emerald-100">
            <MessageCircle size={13} /> أرسل على واتساب
          </a>
        )}
      </div>
      <button type="button" onClick={onDone} className="mt-2 text-[11px] text-emerald-800 underline underline-offset-2">تم</button>
    </div>
  );
}

export default function AccountAccessTab({ accountId }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', role: 'manager' });
  const [creating, setCreating] = useState(false);
  const [link, setLink] = useState(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(null);

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
      const body = { name: form.name.trim(), role: form.role };
      if (form.phone.trim()) body.phone = form.phone.trim();
      if (form.email.trim()) body.email = form.email.trim();
      const res = await api.post(`/admin/accounts/${accountId}/users`, body);
      setLink({ url: res.data.activation_path, hours: res.data.expires_in_hours, name: res.data.user?.name });
      setForm({ name: '', phone: '', email: '', role: 'manager' });
      setOpen(false);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إضافة المستخدم');
    } finally { setCreating(false); }
  };

  const act = async (u, fn) => {
    setBusy(u.id); setError(null);
    try { await fn(); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر التنفيذ'); }
    finally { setBusy(null); }
  };

  const reinvite = (u) => act(u, async () => {
    const res = await api.post(`/admin/accounts/${accountId}/users/${u.id}/invite`);
    setLink({ url: res.data.activation_path, hours: res.data.expires_in_hours, name: u.name });
  });

  const setActive = (u, active) => {
    if (!active && !window.confirm(`تعطيل دخول ${u.name}؟ يخرج من كل الأجهزة فورًا.`)) return;
    act(u, () => api.patch(`/admin/accounts/${accountId}/users/${u.id}`, { active }));
  };

  const setRole = (u, role) => {
    if (role === u.role) return;
    if (!window.confirm(`تغيير دور ${u.name} إلى «${ROLE_LABEL[role]}»؟`)) return;
    act(u, () => api.patch(`/admin/accounts/${accountId}/users/${u.id}`, { role }));
  };

  const reset = (u) => {
    if (!window.confirm(`إعادة ضبط دخول ${u.name}؟ يُعطَّل الدخول الحالي وتُلغى كل الروابط، ويصدر رابط تفعيل جديد يختار به كلمة مرور جديدة. العملية مسجّلة باسمك.`)) return;
    act(u, async () => {
      const res = await api.post(`/admin/accounts/${accountId}/users/${u.id}/reset`);
      setLink({ url: res.data.join_url || res.data.activation_path, wa: res.data.wa_share_url, hours: res.data.expires_in_hours, name: u.name });
    });
  };

  return (
    <div className="space-y-4">
      {error && <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">{error}</div>}
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}

      <Panel
        title="من يدخل لهذا المحل"
        action={(
          <button type="button" onClick={() => setOpen((v) => !v)} className="flex items-center gap-1.5 text-xs text-gray-700 hover:text-gray-900">
            <UserPlus size={14} /> أضف شخصًا
          </button>
        )}
      >
        {open && (
          <form onSubmit={create} className="p-4 border-b border-gray-100 bg-gray-50 space-y-2.5">
            <div className="grid gap-2.5 sm:grid-cols-4">
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="الاسم" required className={field} />
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="الموبايل 07…" dir="ltr" inputMode="tel" className={field} />
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="البريد (اختياري)" type="email" dir="ltr" className={field} />
              <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={field}>
                {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={creating || (!form.phone.trim() && !form.email.trim())}
                className="bg-gray-900 text-white px-3 h-8 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40">
                {creating ? 'جارٍ...' : 'أضف وأصدر رابطًا'}
              </button>
              <span className="text-[11px] text-gray-500">لن تضع كلمة مرور — يختارها بنفسه</span>
            </div>
          </form>
        )}

        {!users ? (
          <SkeletonRows rows={3} cols={5} />
        ) : users.length === 0 ? (
          <EmptyState icon={UserPlus} tone="neutral" title="لا يستطيع أحد الدخول لهذا المحل بعد" hint="أضف صاحب المحل وأرسل له الرابط" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="text-gray-500 text-[11px] border-b border-gray-100">
                  {['الاسم', 'الموبايل', 'الدور', 'دخل فعلًا', 'دعوة معلّقة', ''].map((h) => (
                    <th key={h} className="text-right font-medium px-4 h-9 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {users.map((u) => {
                  const off = u.active === false && u.has_signed_in;
                  return (
                    <tr key={u.id} className={off ? 'bg-gray-50 text-gray-400' : 'hover:bg-gray-50'}>
                      <td className="px-4 h-10 font-medium whitespace-nowrap">
                        {u.name}
                        {off && <span className="mr-2 text-[10px] bg-gray-200 text-gray-600 rounded px-1.5 py-0.5">معطّل</span>}
                        {u.email && <div className="text-[11px] text-gray-400 font-normal"><Ltr>{u.email}</Ltr></div>}
                      </td>
                      <td className="px-4 h-10">{u.phone ? <Ltr className="text-xs">{u.phone}</Ltr> : <span className="text-gray-300">—</span>}</td>
                      <td className="px-4 h-10">
                        <select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={busy === u.id || !ROLE_LABEL[u.role]}
                          className="h-7 px-1.5 text-[12px] border border-gray-200 rounded bg-white">
                          {!ROLE_LABEL[u.role] && <option value={u.role}>—</option>}
                          {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                      </td>
                      <td className="px-4 h-10 whitespace-nowrap">
                        {u.has_signed_in
                          ? <span className="inline-flex items-center gap-1 text-emerald-700"><LogIn size={12} /> <Timestamp value={u.last_login} /></span>
                          : <span className="text-gray-400">لم يدخل</span>}
                      </td>
                      <td className="px-4 h-10 whitespace-nowrap">
                        {u.invitation_pending_until
                          ? <span className="text-amber-700">حتى <Timestamp value={u.invitation_pending_until} /></span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 h-10 text-left whitespace-nowrap">
                        <span className="inline-flex items-center gap-3">
                          {!u.has_signed_in && (
                            <button type="button" onClick={() => reinvite(u)} disabled={busy === u.id}
                              className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 disabled:opacity-40">
                              <RefreshCw size={12} /> رابط جديد
                            </button>
                          )}
                          {u.has_signed_in && (
                            <button type="button" onClick={() => reset(u)} disabled={busy === u.id}
                              className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 disabled:opacity-40">
                              <KeyRound size={12} /> إعادة ضبط الدخول
                            </button>
                          )}
                          {u.active === false && u.has_signed_in ? (
                            <button type="button" onClick={() => setActive(u, true)} disabled={busy === u.id}
                              className="inline-flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-900 disabled:opacity-40">
                              <RotateCcw size={12} /> تفعيل
                            </button>
                          ) : (u.active !== false || u.has_signed_in) && (
                            <button type="button" onClick={() => setActive(u, false)} disabled={busy === u.id}
                              className="inline-flex items-center gap-1 text-[12px] text-red-600 hover:text-red-800 disabled:opacity-40">
                              <Ban size={12} /> تعطيل
                            </button>
                          )}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
