// WhatsApp look-alike pieces, ported from the Peekaboo staff inbox (official-peekaboo-website-,
// frontend/src/pages/StaffPage.js): status ticks, the text renderer, the 24 h window chip.
import React from 'react';
import { parseWaMarkdown } from '../../utils/waMarkdown';

// Hand-drawn status checks (the double is interlocked, like the real thing). Colourable via currentColor.
export const TickSingle = ({ className = '' }) => (
  <svg viewBox="0 0 14 11" width="14" height="11" className={`inline-block ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1.5 6.2l3.2 3.1 7-7.5" /></svg>
);
export const TickDouble = ({ className = '' }) => (
  <svg viewBox="0 0 19 11" width="19" height="11" className={`inline-block ${className}`} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M1 6.2l3.2 3.1 7-7.5" /><path d="M8.2 8.4l1.4 1.2 7-7.5" /></svg>
);
export const TickClock = ({ className = '' }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" className={`inline-block ${className}`} fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" aria-hidden="true"><circle cx="6" cy="6" r="4.8" /><path d="M6 3.6V6l1.8 1.2" /></svg>
);
export const TickError = ({ className = '' }) => (
  <svg viewBox="0 0 12 12" width="12" height="12" className={`inline-block ${className}`} aria-hidden="true"><circle cx="6" cy="6" r="6" fill="currentColor" /><path d="M6 2.8v3.9M6 8.7v.6" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" fill="none" /></svg>
);

export function StatusTick({ status }) {
  if (status === 'read') return <TickDouble className="text-[#53BDEB]" />;
  if (status === 'delivered') return <TickDouble className="text-[#667781]" />;
  if (status === 'sent' || status === 'answered') return <TickSingle className="text-[#667781]" />;
  if (status === 'failed') return <TickError className="text-red-500" />;
  return <TickClock className="text-[#667781]" />;
}

// *bold* _italic_ ~strike~ `mono` and links, the way WhatsApp renders them.
export function WaText({ text }) {
  return parseWaMarkdown(text).map((tok, i) => {
    if (tok.t === 'bold') return <strong key={i}>{tok.v}</strong>;
    if (tok.t === 'italic') return <em key={i}>{tok.v}</em>;
    if (tok.t === 'strike') return <s key={i}>{tok.v}</s>;
    if (tok.t === 'mono') return <code key={i} className="font-mono text-[13px] bg-black/5 rounded px-1">{tok.v}</code>;
    if (tok.t === 'link') return <a key={i} href={tok.href} target="_blank" rel="noreferrer" className="text-[#027EB5] underline break-all">{tok.v}</a>;
    return <React.Fragment key={i}>{tok.v}</React.Fragment>;
  });
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

/** The 24 h customer-service window: free text reaches the customer only inside it. */
export function windowState(lastInboundAt, now = Date.now()) {
  if (!lastInboundAt) return { expired: true, label: 'النافذة مغلقة' };
  const left = new Date(lastInboundAt).getTime() + WINDOW_MS - now;
  if (left <= 0) return { expired: true, label: 'النافذة مغلقة' };
  const h = Math.floor(left / 3600000);
  const m = Math.floor((left % 3600000) / 60000);
  return { expired: false, urgent: left < 3600000, warn: left < 4 * 3600000, label: h > 0 ? `باقي ${h}س ${m}د` : `باقي ${m}د` };
}

export function Avatar({ name, size = 'w-11 h-11 text-base' }) {
  const ch = String(name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <div className={`${size} rounded-full bg-gradient-to-br from-[#00A884] to-[#008069] flex items-center justify-center text-white font-bold flex-shrink-0`}>{ch}</div>
  );
}

export const LABEL_PRESETS = [
  { name: 'عميل محتمل', emoji: '🎯' },
  { name: 'ساخن', emoji: '🔥' },
  { name: 'عرض أكتوبر', emoji: '🎁' },
  { name: 'متابعة', emoji: '📌' },
  { name: 'عميل', emoji: '✅' },
  { name: 'شكوى', emoji: '⚠️' },
  { name: 'مش مهتم', emoji: '🚫' },
];
