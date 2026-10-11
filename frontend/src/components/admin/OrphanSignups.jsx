import { useCallback, useEffect, useState } from 'react';
import api from '../../utils/api';
import { Timestamp, Ltr } from '../shared/Primitives';
import { Button, Card, Tag, fieldClass } from './ui';
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
    <Card pad={false} title={`ربط بدون حساب${orphans?.length ? ` · ${orphans.length}` : ''}`}>
      {error && <p role="alert" className="m-0 px-[18px] py-2.5 text-[13.5px] text-shift-danger bg-shift-dangerBg border-y border-shift-dangerLine">{error}</p>}
      <ul className="m-0 p-0 list-none">
        {(orphans || []).map((o) => {
          const actions = orphanActions(o);
          const number = orphanNumber(o);
          return (
          <li key={o.id} className="px-[18px] py-3 border-t border-shift-line2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-semibold text-shift-ink">{o.verified_name || 'بدون اسم عند Meta'}</span>
              {number.tone === 'number' ? <Ltr className="text-sm text-shift-ink tabular-nums">{number.text}</Ltr>
                : number.tone === 'missing' ? <Tag tone="warning">{number.text}</Tag>
                  : <span className="text-[13px] text-shift-muted">{number.text}</span>}
              <span className="text-[13px] text-shift-body">
                {o.needs === 'number' ? 'وافق في Meta ولم يُحدَّد الرقم' : (ORPHAN_KIND[o.kind] || '')}
              </span>
              {o.business_name && <span className="text-[13px] text-shift-ink">{o.business_name}</span>}
              {o.waba_id && <span className="text-xs text-shift-muted">حساب واتساب <Ltr className="font-mono">{o.waba_id}</Ltr></span>}
              <Timestamp value={o.created_at} className="text-xs text-shift-muted" />
              <span className="flex-1" />
              {/* orphanView.js: a row with a shop already (needs 'number') is completed, never
                  attached; an unattached row is attached, never completed. */}
              {actions.attach && (
                <Button size="sm" className="!min-h-[40px]"
                  onClick={() => { setOpen({ id: o.id, mode: 'attach' }); setValue(''); setConfirmReplace(null); }}>
                  اربطه بزبون…
                </Button>
              )}
              {actions.complete && (
                <Button size="sm" className="!min-h-[40px]" onClick={() => openComplete(o)}>
                  أكمل الربط
                </Button>
              )}
            </div>
            {open?.id === o.id && (
              <form className="mt-2.5 flex flex-wrap items-center gap-2" onSubmit={(e) => { e.preventDefault(); submit(o); }}>
                {open.mode === 'attach' ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="الزبون"
                    className={`${fieldClass} !w-auto min-w-[220px] max-w-full`}>
                    <option value="">اختر الزبون</option>
                    {pickable.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </select>
                ) : numbers && numbers.length > 0 ? (
                  <select value={value} onChange={(e) => setValue(e.target.value)} aria-label="الرقم"
                    className={`${fieldClass} !w-auto min-w-[220px] max-w-full`}>
                    <option value="">اختر الرقم</option>
                    {numbers.map((n) => (
                      <option key={n.id} value={n.id}>{[n.display_phone, n.verified_name].filter(Boolean).join(' · ') || n.id}</option>
                    ))}
                  </select>
                ) : (
                  <input value={value} onChange={(e) => setValue(e.target.value.replace(/\D/g, ''))} aria-label="معرّف الرقم"
                    inputMode="numeric" dir="ltr" placeholder="معرّف الرقم من WhatsApp Manager"
                    className={`${fieldClass} !w-72 max-w-full font-mono`} />
                )}
                <Button type="submit" variant="primary" disabled={busy || !value}>
                  {busy ? 'جارٍ…' : open.mode === 'attach' ? 'اربط' : 'أكمل'}
                </Button>
                <Button variant="link" className="min-h-[44px]" onClick={() => { setOpen(null); setConfirmReplace(null); }}>إلغاء</Button>
              </form>
            )}
            {confirmReplace?.id === o.id && open?.id === o.id && (
              <div role="alert" className="mt-2.5 rounded-xl border border-shift-dangerLine bg-shift-dangerBg p-3 text-[13.5px] text-shift-ink">
                <p className="m-0"><Tag tone="critical">تنبيه</Tag> {confirmReplace.message} رقمه الحالي يتوقف عن استقبال الرسائل.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Button variant="danger" disabled={busy} onClick={() => submit(o, { replace: true })}>
                    {busy ? 'جارٍ…' : 'استبدل الرقم'}
                  </Button>
                  <Button variant="link" className="min-h-[44px] !text-shift-body" onClick={() => setConfirmReplace(null)}>تراجع</Button>
                </div>
              </div>
            )}
          </li>
          );
        })}
      </ul>
    </Card>
  );
}
