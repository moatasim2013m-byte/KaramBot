import React from 'react';
import { meterView, countAr } from './panelView';

const BAR = { good: 'bg-emerald-500', warn: 'bg-amber-500', bad: 'bg-red-500' };
const NOTE = { warn: 'text-shift-warn', bad: 'text-shift-danger' };

/**
 * «ردود هذا الشهر» on the home page and the bot page: the cost guard's own count against the
 * shop's cap (GET /api/whatsapp/status → usage), with the sentence for this shop's plan.
 */
export default function ReplyMeter({ usage, plan }) {
  const m = meterView(usage, plan);
  if (!m) return null;
  return (
    <div>
      <p className="text-[14px] text-shift-ink">
        <span className="font-bold tabular-nums">{countAr(m.used)}</span> ردًا تلقائيًا
        {m.cap ? <> من <span className="tabular-nums">{countAr(m.cap)}</span></> : null}
      </p>
      {m.cap ? (
        <div className="mt-2 h-2 bg-shift-line2 rounded-full overflow-hidden">
          <div className={`h-full ${BAR[m.tone]}`} style={{ width: `${m.pct}%` }} />
        </div>
      ) : null}
      {m.note && <p className={`mt-2 text-[12px] ${NOTE[m.tone]}`}>{m.note}</p>}
    </div>
  );
}
