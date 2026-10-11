import { useCallback, useEffect, useState } from 'react';
import { UserPlus, Copy, Check, RefreshCw, MessageCircle, Ban, RotateCcw, KeyRound } from 'lucide-react';
import api from '../../utils/api';
import { Timestamp, Ltr, SkeletonRows, EmptyState } from '../shared/Primitives';
import { Button, Card, btnClass, fieldClass, labelClass } from './ui';

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
 *
 * One row per person (name, role, mobile, the login's state in words, its actions), which wraps
 * on a phone instead of scrolling sideways as the old table did.
 */

const ROLE_LABEL = { business_owner: 'صاحب المحل', manager: 'مدير', staff: 'موظف' };
// A quiet text action in a person's row, 40px tall for a thumb.
const ACT = 'inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-[10px] border border-shift-field bg-white text-[13px] text-shift-ink hover:bg-[#F1F3F7] disabled:opacity-50';

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
    <div role="status" className="border border-[#BFE3CB] bg-shift-okBg rounded-2xl p-4">
      <p className="m-0 text-sm font-semibold text-[#14532D]">الرابط جاهز — أرسله {link.name ? `لـ${link.name}` : ''}</p>
      <p className="m-0 mt-0.5 text-[13px] text-[#14532D]">
        يعمل مرة واحدة{link.hours ? ` وينتهي خلال ${link.hours} ساعة` : ''}. يختار كلمة المرور بنفسه.
      </p>
      <div className="flex flex-wrap gap-2 mt-2.5">
        <input readOnly value={url} onFocus={(e) => e.target.select()} dir="ltr" aria-label="رابط التفعيل"
          className={`${fieldClass} flex-1 basis-52 min-w-0 font-mono text-[13px]`} />
        <Button variant="primary" onClick={copy}>
          {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'نُسخ' : 'نسخ'}
        </Button>
        {link.wa && (
          <a href={link.wa} target="_blank" rel="noopener noreferrer" className={`${btnClass('secondary', 'md')} no-underline`}>
            <MessageCircle size={15} /> أرسل على واتساب
          </a>
        )}
      </div>
      <button type="button" onClick={onDone} className="mt-1 min-h-[40px] text-[13px] text-[#14532D] underline underline-offset-2">تم</button>
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

  // The login's state in words, with the tone backing them up.
  const stateOf = (u) => {
    const off = u.active === false && u.has_signed_in;
    if (off && u.invitation_pending_until) return ['text-shift-warn', <>بانتظار الرابط الجديد · ينتهي <Timestamp value={u.invitation_pending_until} /></>];
    if (off) return ['text-shift-danger', 'معطّل'];
    if (u.has_signed_in) return ['text-shift-ok', <>الدخول مفعّل · آخر دخول <Timestamp value={u.last_login} /></>];
    if (u.invitation_pending_until) return ['text-shift-warn', <>بانتظار التفعيل · ينتهي الرابط <Timestamp value={u.invitation_pending_until} /></>];
    return ['text-shift-muted', 'لم يدخل بعد · لا رابط صالح'];
  };

  return (
    <div className="flex flex-col gap-4">
      {error && <div role="alert" className="bg-shift-dangerBg border border-shift-dangerLine text-shift-danger text-sm rounded-xl px-4 py-3">{error}</div>}
      {link && <LinkBox link={link} onDone={() => setLink(null)} />}

      <Card
        title="من يدخل لوحة المحل"
        action={(
          <span className="flex items-center gap-3">
            {users && <span className="text-[13px] text-shift-body">{users.length} {users.length === 1 ? 'مستخدم' : 'مستخدمين'}</span>}
            <Button size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open ? 'true' : 'false'} className="!min-h-[40px]">
              <UserPlus size={15} /> أضف شخصًا
            </Button>
          </span>
        )}
      >
        {open && (
          <form onSubmit={create} className="mb-3 p-3.5 rounded-xl bg-shift-canvas flex flex-col gap-3">
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
              <label className="flex flex-col gap-1.5"><span className={labelClass}>الاسم</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={fieldClass} /></label>
              <label className="flex flex-col gap-1.5"><span className={labelClass}>الموبايل</span>
                <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="07…" dir="ltr" inputMode="tel" className={`${fieldClass} text-right`} /></label>
              <label className="flex flex-col gap-1.5"><span className={labelClass}>البريد (اختياري)</span>
                <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} type="email" dir="ltr" className={`${fieldClass} text-right`} /></label>
              <label className="flex flex-col gap-1.5"><span className={labelClass}>الدور</span>
                <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} className={fieldClass}>
                  {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select></label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="primary" disabled={creating || (!form.phone.trim() && !form.email.trim())}>
                {creating ? 'جارٍ...' : 'أضف وأصدر رابطًا'}
              </Button>
              <span className="text-[13px] text-shift-body">لن تضع كلمة مرور — يختارها بنفسه</span>
            </div>
          </form>
        )}

        {!users ? (
          <SkeletonRows rows={3} cols={5} />
        ) : users.length === 0 ? (
          <EmptyState icon={UserPlus} tone="neutral" title="لا يستطيع أحد الدخول لهذا المحل بعد" hint="أضف صاحب المحل وأرسل له الرابط" />
        ) : (
          <ul className="m-0 p-0 list-none">
            {users.map((u) => {
              const off = u.active === false && u.has_signed_in;
              const [cls, text] = stateOf(u);
              return (
                <li key={u.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 py-3 border-t border-shift-line2 text-sm ${off ? 'text-shift-muted' : 'text-shift-ink'}`}>
                  <div className="flex-1 basis-40 min-w-0">
                    <b className="font-semibold">{u.name}</b>
                    {u.email && <div className="text-[12.5px] text-shift-muted"><Ltr>{u.email}</Ltr></div>}
                  </div>
                  <select value={u.role} onChange={(e) => setRole(u, e.target.value)} disabled={busy === u.id || !ROLE_LABEL[u.role]}
                    aria-label={`دور ${u.name}`} className="h-10 px-2 text-[13.5px] border border-shift-field rounded-[10px] bg-white text-shift-ink">
                    {!ROLE_LABEL[u.role] && <option value={u.role}>—</option>}
                    {Object.entries(ROLE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                  {u.phone ? <Ltr>{u.phone}</Ltr> : <span className="text-shift-muted">بلا موبايل</span>}
                  <span className={`text-[13.5px] ${cls}`}>{text}</span>
                  <span className="flex flex-wrap gap-2 sm:ms-auto">
                    {!u.has_signed_in && (
                      <button type="button" onClick={() => reinvite(u)} disabled={busy === u.id} className={ACT}>
                        <RefreshCw size={14} /> تجديد الرابط
                      </button>
                    )}
                    {u.has_signed_in && (
                      <button type="button" onClick={() => reset(u)} disabled={busy === u.id} className={ACT}>
                        <KeyRound size={14} /> إعادة ضبط الدخول
                      </button>
                    )}
                    {/* After «إعادة ضبط الدخول» the way back in is the new link alone: no «تفعيل» while it waits. */}
                    {u.active === false && u.has_signed_in && u.invitation_pending_until ? null
                      : u.active === false && u.has_signed_in ? (
                        <button type="button" onClick={() => setActive(u, true)} disabled={busy === u.id} className={ACT}>
                          <RotateCcw size={14} /> تفعيل
                        </button>
                      ) : (u.active !== false || u.has_signed_in) && (
                        <button type="button" onClick={() => setActive(u, false)} disabled={busy === u.id}
                          className={`${ACT} !text-shift-danger !border-shift-dangerLine hover:!bg-shift-dangerBg`}>
                          <Ban size={14} /> تعطيل
                        </button>
                      )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <p className="m-0 mt-2 text-[13px] text-shift-body">لا ترى شِفت كلمات المرور أبدًا. إعادة الضبط تعطّل الدخول وترسل رابطًا جديدًا، وتُسجَّل باسمك.</p>
      </Card>
    </div>
  );
}
