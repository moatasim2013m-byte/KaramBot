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
  pending: { label: 'بانتظار التفعيل', cls: 'bg-amber-100 text-amber-900' },
  disabled: { label: 'معطّل', cls: 'bg-gray-100 text-gray-600' },
};

const input = 'w-full rounded-md border border-gray-200 px-3 h-11 text-[14px] focus:outline-none focus:ring-1 focus:ring-green-500';

function InviteSheet({ onClose, onInvited }) {
  const [form, setForm] = useState({ name: '', phone: '', role: 'staff' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);   // { join_url, wa_share_url }
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
          <h3 className="text-[16px] font-semibold text-gray-900">{result ? 'أرسل الرابط' : 'أضف عضوًا'}</h3>
          <button type="button" onClick={onClose} className="p-2 text-gray-400" title="إغلاق"><X size={18} /></button>
        </div>

        {result ? (
          <>
            <p className="text-[13px] text-gray-600 leading-relaxed">
              أرسل هذا الرابط لـ {form.name}. يفتحه على هاتفه، يختار كلمة مرور، ويدخل مباشرة. الرابط صالح لأيام قليلة ولمرة واحدة.
            </p>
            <div className="rounded-md bg-gray-50 px-3 py-2"><Ltr className="text-[12px] text-gray-700 break-all">{result.join_url}</Ltr></div>
            {result.wa_share_url && (
              <a href={result.wa_share_url} target="_blank" rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 h-11 rounded-md bg-green-600 text-white text-[14px] font-medium">
                <MessageCircle size={15} /> أرسل على واتساب
              </a>
            )}
            <button type="button" onClick={copy}
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-md border border-gray-200 text-[14px] text-gray-700">
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
                  className={`rounded-lg border px-3 py-2 text-right ${form.role === value ? 'border-green-600 bg-green-50' : 'border-gray-200'}`}>
                  <span className="block text-[14px] font-medium text-gray-900">{label}</span>
                  <span className="block text-[11px] text-gray-500">{hint}</span>
                </button>
              ))}
            </div>
            {error && <p className="text-[13px] text-red-700">{error}</p>}
            <button type="submit" disabled={busy || !form.name.trim() || !form.phone.trim()}
              className="w-full flex items-center justify-center gap-1.5 h-11 rounded-md bg-green-600 text-white text-[14px] font-medium disabled:opacity-40">
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
        <h1 className="text-xl font-bold text-gray-800">الفريق</h1>
        {owner && !full && (
          <button type="button" onClick={() => setInviting(true)}
            className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-green-600 text-white text-[13px] font-medium">
            <UserPlus size={15} /> أضف عضوًا
          </button>
        )}
      </div>

      {data && (
        <section className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex items-baseline justify-between text-[13px]">
            <span className="text-gray-700">المستخدمون</span>
            <span className="tabular-nums font-medium text-gray-900">{countAr(used)}{seats ? <> من {countAr(seats)}</> : null}</span>
          </div>
          {seats ? (
            <div className="mt-1.5 h-2 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full ${full ? 'bg-amber-500' : 'bg-emerald-500'}`} style={{ width: `${pct}%` }} />
            </div>
          ) : null}
          {owner && full && (
            <p className="mt-2 text-[12px] text-amber-900">
              وصلت لعدد المستخدمين في باقتك —{' '}
              <a href={shiftWaLink(`${helpText(user)} — أحتاج مستخدمين أكثر`)} target="_blank" rel="noopener noreferrer"
                className="underline underline-offset-2">تواصل مع شِفت</a>
            </p>
          )}
        </section>
      )}

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-[13px] text-red-700">{error}</p>}

      {!data ? (
        !error && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>
      ) : (
        <section className="rounded-xl border border-gray-200 bg-white overflow-hidden">
          {/* A table on a desktop, stacked rows on a phone: five columns do not fit 360px. */}
          <table className="w-full text-[13px] hidden md:table">
            <thead>
              <tr className="text-gray-500 text-right border-b border-gray-100">
                <th className="font-medium px-4 py-2">الاسم</th>
                <th className="font-medium px-4 py-2">الموبايل</th>
                <th className="font-medium px-4 py-2">الدور</th>
                <th className="font-medium px-4 py-2">الحالة</th>
                <th className="font-medium px-4 py-2">آخر دخول</th>
                {owner && <th className="px-4 py-2" />}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="px-4 py-2.5 text-gray-900">{m.name}</td>
                  <td className="px-4 py-2.5">{m.phone ? <Ltr>{m.phone}</Ltr> : <span className="text-gray-400">—</span>}</td>
                  <td className="px-4 py-2.5"><RoleCell m={m} editable={editable(m)} busy={busy === m.id} onRole={(role) => patch(m, { role })} /></td>
                  <td className="px-4 py-2.5"><StatusChip status={m.status} /></td>
                  <td className="px-4 py-2.5 text-gray-600"><Timestamp value={m.last_login} /></td>
                  {owner && (
                    <td className="px-4 py-2.5 text-left">
                      {editable(m) && <ActiveButton m={m} busy={busy === m.id} onToggle={() => patch(m, { active: m.status === 'disabled' })} />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <ul className="md:hidden divide-y divide-gray-100">
            {members.map((m) => (
              <li key={m.id} className="px-4 py-3 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-gray-900">{m.name}</span>
                  <StatusChip status={m.status} />
                </div>
                <div className="flex items-center justify-between gap-2 text-[12px] text-gray-500">
                  {m.phone ? <Ltr>{m.phone}</Ltr> : <span />}
                  <span>آخر دخول: <Timestamp value={m.last_login} /></span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <RoleCell m={m} editable={editable(m)} busy={busy === m.id} onRole={(role) => patch(m, { role })} />
                  {editable(m) && <ActiveButton m={m} busy={busy === m.id} onToggle={() => patch(m, { active: m.status === 'disabled' })} />}
                </div>
              </li>
            ))}
          </ul>

          {members.length === 0 && <p className="text-center py-10 text-[13px] text-gray-500">لا أعضاء بعد.</p>}
        </section>
      )}

      {inviting && <InviteSheet onClose={() => setInviting(false)} onInvited={load} />}
    </div>
  );
}

function StatusChip({ status }) {
  const s = STATUS_AR[status] || STATUS_AR.active;
  return <span className={`text-[11px] rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
}

function RoleCell({ m, editable, busy, onRole }) {
  if (!editable) return <span className="text-gray-700 text-[13px]">{ROLE_AR[m.role] || m.role}</span>;
  return (
    <select value={m.role} disabled={busy} onChange={(e) => onRole(e.target.value)}
      className="h-9 rounded-md border border-gray-200 px-2 text-[13px] bg-white disabled:opacity-50">
      <option value="staff">موظف</option>
      <option value="manager">مدير</option>
    </select>
  );
}

function ActiveButton({ m, busy, onToggle }) {
  const disabled = m.status === 'disabled';
  return (
    <button type="button" onClick={onToggle} disabled={busy}
      className={`h-9 px-3 rounded-md text-[12px] font-medium disabled:opacity-50 ${disabled ? 'bg-green-50 text-green-700' : 'border border-gray-200 text-gray-600'}`}>
      {disabled ? 'فعّل' : 'عطّل'}
    </button>
  );
}
