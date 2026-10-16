import React, { useCallback, useEffect, useState } from 'react';
import { UserPlus, Loader2, X, Copy, Check, MessageCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';
import { Ltr, Timestamp } from '../components/shared/Primitives';
import { countAr, shiftWaLink, helpText } from '../components/whatsapp/panelView';

/**
 * «الفريق» — who can open this shop's panel, and as what.
 *
 * The owner invites by link: name, mobile and role, and the server returns a join link to send
 * from their own WhatsApp («أرسل على واتساب»). The owner no longer types someone else's password,
 * and «مدير» really makes a manager. Seats come from the plan («المستخدمون 2 من 3»); when they are
 * full the server answers 409 in Arabic and the button says why. Managers see the list only.
 */

const ROLE_AR = { business_owner: 'صاحب المحل', manager: 'مدير', staff: 'موظف', platform_admin: 'شِفت' };
const STATUS_AR = {
  active: { label: 'فعّال', cls: 'bg-emerald-100 text-emerald-900' },
  pending: { label: 'بانتظار التفعيل', cls: 'bg-shift-warnBg text-shift-warn' },
  disabled: { label: 'معطّل', cls: 'bg-shift-line2 text-shift-body' },
};

const input = 'w-full rounded-md border border-shift-line px-3 h-11 text-[14px] focus:outline-none focus:ring-1 focus:ring-shift-ok';

// `initial` opens the sheet on an already-issued link («أرسل رابطًا جديدًا» for someone who never signed in).
function InviteSheet({ onClose, onInvited, initial = null }) {
  const [form, setForm] = useState({ name: initial?.name || '', phone: '', role: 'staff' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(initial?.result || null);   // { join_url, wa_share_url }
  const [copied, setCopied] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const res = await api.post('/team/invite', form);
      setResult(res.data);
      onInvited();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّرت الإضافة، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try { await navigator.clipboard.writeText(result.join_url); setCopied(true); setTimeout(() => setCopied(false), 2000); }
    catch { /* clipboard blocked: the link is on screen */ }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl p-5 space-y-4 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <div className="flex items-center justify-between">
          <h3 className="text-[16px] font-semibold text-shift-ink">{result ? 'أرسل الرابط' : 'أضف عضوًا'}</h3>
          <button type="button" onClick={onClose} className="p-2 text-shift-muted" title="إغلاق"><X size={18} /></button>
        </div>

        {result ? (
          <>
            <p className="text-[13px] text-shift-body leading-relaxed">
              أرسل هذا الرابط لـ {form.name}. يفتحه على هاتفه، يختار كلمة مرور، ويدخل مباشرة. الرابط صالح لأيام قليلة ولمرة واحدة.
            </p>
            <div className="rounded-md bg-shift-canvas px-3 py-2"><Ltr className="text-[12px] text-shift-body break-all">{result.join_url}</Ltr></div>
            {result.wa_share_url && (
              <a href={result.wa_share_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 h-11 rounded-md bg-shift-ok text-white text-[14px] font-medium">
                <MessageCircle size={15} /> أرسل على واتساب
              </a>
            )}
            <button type="button" onClick={copy}
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-md border border-shift-line text-[14px] text-shift-body">
              {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />} {copied ? 'تم النسخ' : 'انسخ الرابط'}
            </button>
          </>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required placeholder="الاسم" className={input} />
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required placeholder="الموبايل 07XXXXXXXX"
              dir="ltr" inputMode="tel" className={`${input} text-right`} />
            <div className="grid grid-cols-2 gap-2">
              {[['staff', 'موظف', 'يرد على المحادثات والطلبات'], ['manager', 'مدير', 'وأيضًا معلومات البوت والتقارير']].map(([value, label, hint]) => (
                <button key={value} type="button" onClick={() => setForm({ ...form, role: value })}
                  className={`rounded-lg border px-3 py-2 text-right ${form.role === value ? 'border-shift-ok bg-shift-okBg' : 'border-shift-line'}`}>
                  <span className="block text-[14px] font-medium text-shift-ink">{label}</span>
                  <span className="block text-[11px] text-shift-muted">{hint}</span>
                </button>
              ))}
            </div>
            {error && <p className="text-[13px] text-shift-danger">{error}</p>}
            <button type="submit" disabled={busy || !form.name.trim() || !form.phone.trim()}
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-md bg-shift-ok text-white text-[14px] font-medium disabled:opacity-40">
              {busy && <Loader2 size={14} className="animate-spin" />} أنشئ رابط الانضمام
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

export default function StaffPage() {
  const { user } = useAuth();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [inviting, setInviting] = useState(false);
  const [busy, setBusy] = useState(null);
  const [relink, setRelink] = useState(null);   // { name, result } from POST /team/:id/resend
  const owner = user?.role === 'business_owner' || user?.role === 'platform_admin';

  const load = useCallback(() => {
    api.get('/team')
      .then((res) => { setData(res.data); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الفريق'));
  }, []);
  useEffect(() => { load(); }, [load]);

  const patch = async (member, body) => {
    setBusy(member.id); setError(null);
    try {
      await api.patch(`/team/${member.id}`, body);
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      setBusy(null);
    }
  };

  // A member who never signed in has no password: switching them on would leave them unable to
  // sign in (the server answers 409), so their way back is a fresh link, which the old one stops.
  const resend = async (member) => {
    setBusy(member.id); setError(null);
    try {
      const res = await api.post(`/team/${member.id}/resend`);
      setRelink({ name: member.name, result: res.data });
      load();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر إنشاء الرابط، حاول مرة أخرى');
    } finally {
      setBusy(null);
    }
  };

  const members = data?.members || [];
  const seats = data?.seats || null;
  const used = data?.seats_used ?? members.filter((m) => m.status !== 'disabled').length;
  const full = Boolean(seats && used >= seats);
  const pct = seats ? Math.min(100, Math.round((used / seats) * 100)) : 0;
  // Only the owner changes others; never themselves and never the owner (the server enforces it).
  const editable = (m) => owner && m.id !== user?.id && m.role !== 'business_owner';

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-bold text-shift-ink">الفريق</h1>
        {owner && !full && (
          <button type="button" onClick={() => setInviting(true)}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-shift-ok text-white text-[13px] font-medium">
            <UserPlus size={15} /> أضف عضوًا
          </button>
        )}
      </div>

      {data && (
        <section className="rounded-2xl border border-shift-line bg-white p-4">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-shift-body">المستخدمون</span>
            <span className="tabular-nums font-medium text-shift-ink">{countAr(used)}{seats ? <> من {countAr(seats)}</> : null}</span>
          </div>
          {seats ? (
            <div className="mt-1.5 h-2 bg-shift-line2 rounded-full overflow-hidden">
              <div className={`h-full ${full ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          {owner && full && (
            <p className="mt-2 text-[12px] text-shift-warn">
              وصلت لعدد المستخدمين في باقتك —{' '}
              <a href={shiftWaLink(`${helpText(user)} — أحتاج مستخدمين أكثر`)} target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2">تواصل مع شِفت</a>
            </p>
          )}
        </section>
      )}

      {error && <p className="rounded-xl border border-shift-dangerLine bg-shift-dangerBg px-4 py-2 text-[13px] text-shift-danger">{error}</p>}

      {!data ? (
        !error && <div className="text-center py-12 text-shift-muted">جاري التحميل...</div>
      ) : (
        <section className="rounded-2xl border border-shift-line bg-white overflow-hidden">
          {/* A table on a desktop, stacked rows on a phone: five columns do not fit 360px. */}
          <table className="w-full text-[13px] hidden md:table">
            <thead>
              <tr className="text-shift-muted text-right border-b border-shift-line2">
                <th className="font-medium px-4 py-2">الاسم</th>
                <th className="font-medium px-4 py-2">الموبايل</th>
                <th className="font-medium px-4 py-2">الدور</th>
                <th className="font-medium px-4 py-2">الحالة</th>
                <th className="font-medium px-4 py-2">آخر دخول</th>
                {owner && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-shift-canvas">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 text-shift-ink">{m.name}</td>
                  <td className="px-4 py-2.5">{m.phone ? <Ltr>{m.phone}</Ltr> : <span className="text-shift-muted">—</span>}</td>
                  <td className="px-4 py-2.5"><RoleCell m={m} editable={editable(m)} busy={busy === m.id} onRole={(role) => patch(m, { role })} /></td>
                  <td className="px-4 py-2.5"><StatusChip status={m.status} /></td>
                  <td className="px-4 py-2.5 text-shift-body"><Timestamp value={m.last_login} /></td>
                  {owner && (
                    <td className="px-4 py-2.5 text-left">
                      {editable(m) && <MemberActions m={m} busy={busy === m.id} onToggle={() => patch(m, { active: m.status === 'disabled' })} onResend={() => resend(m)} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="md:hidden divide-y divide-shift-line2">
            {members.map((m) => (
              <li key={m.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-shift-ink">{m.name}</span>
                  <StatusChip status={m.status} />
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] text-shift-muted">
                  {m.phone ? <Ltr>{m.phone}</Ltr> : <span />}
                  <span>آخر دخول: <Timestamp value={m.last_login} /></span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <RoleCell m={m} editable={editable(m)} busy={busy === m.id} onRole={(role) => patch(m, { role })} />
                  {editable(m) && <MemberActions m={m} busy={busy === m.id} onToggle={() => patch(m, { active: m.status === 'disabled' })} onResend={() => resend(m)} />}
                </div>
              </li>
            ))}
          </ul>

          {members.length === 0 && <p className="text-center py-10 text-[13px] text-shift-muted">لا أعضاء بعد.</p>}
        </section>
      )}

      {inviting && <InviteSheet onClose={() => setInviting(false)} onInvited={load} />}
      {relink && <InviteSheet initial={relink} onClose={() => setRelink(null)} onInvited={load} />}
    </div>
  );
}

function StatusChip({ status }) {
  const s = STATUS_AR[status] || STATUS_AR.active;
  return <span className={`text-[11px] rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

function RoleCell({ m, editable, busy, onRole }) {
  if (!editable) return <span className="text-shift-body text-[13px]">{ROLE_AR[m.role] || m.role}</span>;
  return (
    <select value={m.role} disabled={busy} onChange={(e) => onRole(e.target.value)}
      className="h-9 rounded-md border border-shift-line px-2 text-[13px] bg-white disabled:opacity-50">
      <option value="staff">موظف</option>
      <option value="manager">مدير</option>
    </select>
  );
}

function MemberActions({ m, busy, onToggle, onResend }) {
  const neverIn = !m.last_login;
  return (
    <span className="inline-flex items-center gap-1.5">
      {neverIn && (
        <button type="button" onClick={onResend} disabled={busy}
          className="h-9 px-3 rounded-md text-[12px] font-medium bg-shift-okBg text-shift-ok disabled:opacity-50">
          أرسل رابطًا جديدًا
        </button>
      )}
      {/* «فعّل» only for someone who has a password; the rest come back through the link. */}
      {!(neverIn && m.status === 'disabled') && <ActiveButton m={m} busy={busy} onToggle={onToggle} />}
    </span>
  );
}

function ActiveButton({ m, busy, onToggle }) {
  const disabled = m.status === 'disabled';
  return (
    <button type="button" onClick={onToggle} disabled={busy}
      className={`h-9 px-3 rounded-md text-[12px] font-medium disabled:opacity-50 ${disabled ? 'bg-shift-okBg text-shift-ok' : 'border border-shift-line text-shift-body'}`}>
      {disabled ? 'فعّل' : 'عطّل'}
    </button>
  );
}
