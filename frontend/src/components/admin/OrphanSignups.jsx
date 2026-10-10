import { useCallback, useEffect, useState } from 'react';
import api from '../../utils/api';
import { Panel, Timestamp, Ltr } from '../shared/Primitives';
import {
  orphanActions, orphanNumber, needsReplaceConfirm, attachBody,
} from '../../pages/admin/orphanView';

const ORPHAN_KIND = {
  onboarding: 'وافق في Meta ولم يكتمل الربط',
  partner_added: 'أضافنا في Meta بلا حساب عندنا',
};

/**
 * «ربط بدون حساب»: Meta signups no shop owns yet. A PARTNER_ADDED webhook for a WABA we have no
 * row for, or a signup whose number the server could not pick on its own. Kept so the customer
 * never has to redo Meta's window: SHIFT attaches the row to the right shop, or types the number
 * id from WhatsApp Manager. Hidden when there is nothing to match.
 */
export default function OrphanSignups({ accounts, onDone }) {
  const [orphans, setOrphans] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null); // {id, mode: 'attach' | 'complete'}
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  // The server's «أكّد الاستبدال» for a shop live on another number: {id, message} until SHIFT
  // confirms (the attach is re-posted with replace) or cancels.
  const [confirmReplace, setConfirmReplace] = useState(null);
  // The WABA's numbers for «أكمل الربط», read with the customer's stored token. null while
  // loading or when Meta could not be asked; the id can then still be typed by hand.
  const [numbers, setNumbers] = useState(null);

  const load = useCallback(() => {
    api.get('/admin/onboardings/orphans')
      .then((res) => { setOrphans(res.data?.orphans || []); setError(null); })
      .catch((err) => {
        // An older server without the route has nothing to show, which is not an error.
        if (err.response?.status === 404) setOrphans([]);
        else setError(err.response?.data?.message || err.response?.data?.error || 'تعذّر تحميل «ربط بدون حساب»');
      });
  }, []);

  useEffect(() => { load(); }, [load]);

  const openComplete = (o) => {
    setOpen({ id: o.id, mode: 'complete' }); setValue(''); setNumbers(null);
    api.get(`/admin/onboardings/${o.id}/numbers`)
      .then((res) => setNumbers(res.data?.numbers || []))
      .catch(() => setNumbers(null));
  };

  const submit = async (o, { replace = false } = {}) => {
    if (!open || !value) return;
    setBusy(true); setError(null);
    try {
      if (open.mode === 'attach') await api.post(`/admin/onboardings/${o.id}/attach`, attachBody(value, replace));
      else await api.post(`/admin/onboardings/${o.id}/complete`, { phone_number_id: value.trim() });
      setOpen(null); setValue(''); setConfirmReplace(null);
      load();
      if (onDone) onDone();
    } catch (err) {
      if (open.mode === 'attach' && !replace && needsReplaceConfirm(err)) {
        setConfirmReplace({ id: o.id, message: err.response?.data?.message || 'هذا الحساب مربوط برقم يعمل.' });
      } else {
        setError(err.response?.data?.message || err.response?.data?.error || 'تعذّر الحفظ');
      }
    } finally {
      setBusy(false);
    }
  };

  if (!error && (!orphans || orphans.length === 0)) return null;

  const pickable = [...(accounts || [])].sort((a, b) => String(a.name).localeCompare(String(b.name), 'ar'));

  return (
    <Panel title={`ربط بدون حساب${orphans?.length ? ` · ${orphans.length}` : ''}`}>
      {error && <p className="px-4 py-2 text-[13px] text-red-700 bg-red-50 border-b border-red-100">{error}</p>}
      <ul className="divide-y divide-gray-100">
        {(orphans || []).map((o) => {
          const actions = orphanActions(o);
          const number = orphanNumber(o);
          return (
          <li key={o.id} className="px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium text-gray-900">{o.verified_name || 'بدون اسم عند Meta'}</span>
              {number.tone === 'number' ? <Ltr className="text-[13px] text-gray-700">{number.text}</Ltr>
                : <span className={`text-[12px] ${number.tone === 'missing' ? 'text-amber-700' : 'text-gray-500'}`}>{number.text}</span>}
              <span className="text-[12px] text-gray-500">
                {o.needs === 'number' ? 'وافق في Meta ولم يُحدَّد الرقم' : (ORPHAN_KIND[o.kind] || '')}
              </span>
              {o.business_name && <span className="text-[12px] text-gray-700">{o.business_name}</span>}
              {o.waba_id && <span className="text-[11px] text-gray-400">حساب واتساب <Ltr className="font-mono">{o.waba_id}</Ltr></span>}
              <Timestamp value={o.created_at} className="text-[11px] text-gray-400" />
              <span className="flex-1" />
              {/* orphanView.js: a row with a shop already (needs 'number') is completed, never
                  attached; an unattached row is attached, never completed. */}
              {actions.attach && (
                <button type="button" className="text-[12px] text-gray-700 underline underline-offset-2 hover:text-gray-900"
                  onClick={() => { setOpen({ id: o.id, mode: 'attach' }); setValue(''); setConfirmReplace(null); }}>
                  اربطه بزبون…
                </button>
              )}
              {actions.complete && (
                <button type="button" className="text-[12px] text-gray-700 underline underline-offset-2 hover:text-gray-900"
                  onClick={() => openComplete(o)}>
                  أكمل الربط
                </button>
              )}
            </div>
            {open?.id === o.id && (
              <form className="mt-2 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(o); }}>
                {open.mode === 'attach' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}
                    className="h-8 min-w-[200px] rounded border border-gray-200 px-2 text-[13px]">
                    <option value="">اختر الزبون</option>
                    {pickable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : numbers && numbers.length > 0 ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)}
                    className="h-8 min-w-[200px] rounded border border-gray-200 px-2 text-[13px]">
                    <option value="">اختر الرقم</option>
                    {numbers.map((n) => (
                      <option key={n.id} value={n.id}>{[n.display_phone, n.verified_name].filter(Boolean).join(' · ') || n.id}</option>
                    ))}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))}
                    inputMode="numeric" dir="ltr" placeholder="معرّف الرقم من WhatsApp Manager"
                    className="h-8 w-64 rounded border border-gray-200 px-2 font-mono text-[13px]" />
                )}
                <button type="submit" disabled={busy || !value}
                  className="h-8 rounded bg-gray-900 px-3 text-[12px] font-medium text-white disabled:opacity-40">
                  {busy ? 'جارٍ…' : open.mode === 'attach' ? 'اربط' : 'أكمل'}
                </button>
                <button type="button" onClick={() => { setOpen(null); setConfirmReplace(null); }} className="text-[12px] text-gray-500 underline">إلغاء</button>
              </form>
            )}
            {confirmReplace?.id === o.id && open?.id === o.id && (
              <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-[12px] text-amber-900">
                <p>{confirmReplace.message} رقمه الحالي يتوقف عن استقبال الرسائل.</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <button type="button" disabled={busy} onClick={() => submit(o, { replace: true })}
                    className="h-7 rounded bg-amber-700 px-3 font-medium text-white disabled:opacity-40">
                    {busy ? 'جارٍ…' : 'استبدل الرقم'}
                  </button>
                  <button type="button" onClick={() => setConfirmReplace(null)} className="text-gray-600 underline">تراجع</button>
                </div>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </Panel>
  );
}
