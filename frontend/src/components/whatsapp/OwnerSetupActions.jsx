import { useState } from 'react';
import { CreditCard, Loader2, MessageCircle, X } from 'lucide-react';
import api from '../../utils/api';
import ConnectWhatsApp, { OWNER_ENDPOINTS } from './ConnectWhatsApp';
import { CONTROL_LABEL } from './setupControls';

/**
 * The two moves an owner makes from the panel itself, outside /join (P2 review): «اربط واتساب»,
 * which opens the same Embedded Signup as /join right where it is pressed, and «أضفت البطاقة»,
 * the payment-card claim. Both call `onDone` so the checklist and the status card read the
 * server again.
 */

// `label` lets a broken link say «أعد الربط» instead of «اربط واتساب»; the flow is the same.
export function ConnectInline({ onDone, label = CONTROL_LABEL.connect }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 mt-1.5 rounded-md bg-green-600 px-3 h-9 text-[13px] font-medium text-white hover:bg-green-700">
        <MessageCircle size={14} /> {label}
      </button>
    );
  }
  return (
    <div className="mt-2">
      <div className="flex justify-end">
        <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-gray-700" title="إغلاق">
          <X size={15} />
        </button>
      </div>
      <ConnectWhatsApp
        endpoints={OWNER_ENDPOINTS}
        onChange={(next) => { if (next?.status === 'connected' && onDone) onDone(); }}
      />
    </div>
  );
}

export function ClaimCardButton({ onDone }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const claim = async () => {
    setBusy(true); setError(null);
    try {
      await api.post('/whatsapp/status/payment-method-claim');
      if (onDone) onDone();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={claim} disabled={busy}
        className="inline-flex items-center gap-1.5 mt-1.5 rounded-md border border-amber-300 bg-white px-3 h-8 text-[12px] font-medium text-amber-900 hover:bg-amber-50 disabled:opacity-50">
        {busy ? <Loader2 size={12} className="animate-spin" /> : <CreditCard size={12} />} {CONTROL_LABEL.claim}
      </button>
      {error && <span className="mt-1 text-[12px] text-red-600">{error}</span>}
    </span>
  );
}
