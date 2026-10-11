import { useEffect } from 'react';
import { X } from 'lucide-react';

/**
 * The operator console's own small kit, matching the approved design canvas (2026-10-11).
 *
 * shared/Primitives stays the vocabulary of state (dots, timestamps, numerals) and is also used
 * by the owner's dashboard, so it is not restyled here. These pieces are /admin only: headings,
 * cards, buttons, filter chips and the written severity tags that replaced colour-only dots.
 */

export function PageHeader({ title, sub, children }) {
  return (
    <header className="flex flex-wrap items-end gap-3.5 mb-[18px]">
      <div className="flex-1 basis-80 min-w-0">
        <h1 className="m-0 font-display text-[28px] leading-[1.35] font-semibold text-shift-ink">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-shift-body">{sub}</p>}
      </div>
      {children}
    </header>
  );
}

export function Card({ title, action, children, className = '', pad = true }) {
  return (
    <section className={`bg-white border border-shift-line rounded-2xl ${pad ? 'p-[18px]' : ''} ${className}`}>
      {(title || action) && (
        <header className={`flex items-center justify-between gap-3 ${pad ? 'mb-3' : 'px-[18px] pt-4 pb-3'}`}>
          <h2 className="m-0 font-display text-base font-semibold text-shift-ink">{title}</h2>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

const BTN = {
  primary: 'bg-shift-ink text-white border border-shift-ink hover:bg-shift-ink2 font-semibold',
  secondary: 'bg-white text-shift-ink border border-shift-field hover:bg-[#F1F3F7] font-medium',
  danger: 'bg-white text-shift-danger border border-shift-dangerLine hover:bg-shift-dangerBg font-semibold',
  link: 'bg-transparent text-shift-accent border-0 hover:text-shift-ink font-medium px-0',
};
const SIZE = { sm: 'min-h-[36px] px-3 text-[13px] rounded-[10px]', md: 'min-h-[44px] px-4 text-sm rounded-xl', lg: 'min-h-[48px] px-5 text-[15px] rounded-xl' };

export function btnClass(variant = 'secondary', size = 'md') {
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed ${BTN[variant]} ${SIZE[size]}`;
}

export function Button({ variant = 'secondary', size = 'md', className = '', type = 'button', ...rest }) {
  return <button type={type} className={`${btnClass(variant, size)} ${className}`} {...rest} />;
}

/** A filter or option chip; `on` is the light-blue selected state, never the navy primary. */
export function chipClass(on, shape = 'pill') {
  return `min-h-[40px] px-3.5 ${shape === 'pill' ? 'rounded-full' : 'rounded-[10px]'} text-[13.5px] font-medium border ${
    on ? 'bg-shift-sel text-shift-selText border-shift-selLine' : 'bg-white text-shift-body border-shift-field hover:bg-shift-hover'
  }`;
}

export function Chip({ on, shape, children, ...rest }) {
  return <button type="button" aria-pressed={on ? 'true' : 'false'} className={chipClass(on, shape)} {...rest}>{children}</button>;
}

/** Written severity: colour backs the word up, it never stands alone. */
const TAG = {
  critical: ['عاجل', 'text-shift-danger bg-shift-dangerBg'],
  warning: ['متابعة', 'text-shift-warn bg-shift-warnBg'],
  info: ['معلومة', 'text-shift-body bg-shift-line2'],
  ok: ['', 'text-[#14532D] bg-shift-okBg'],
};
export function Tag({ tone = 'info', children }) {
  const [word, cls] = TAG[tone] || TAG.info;
  return <span className={`inline-block text-xs font-semibold rounded-full px-2 py-px whitespace-nowrap ${cls}`}>{children || word}</span>;
}

/** A neutral status pill (subscription, setup stage, who acts next). */
export function Pill({ tone = 'neutral', children }) {
  const cls = { neutral: 'bg-shift-line2 text-shift-body', trial: 'bg-shift-sel text-[#1D3F8F]', ok: 'bg-shift-okBg text-[#14532D]', warn: 'bg-shift-warnBg text-shift-warn', bad: 'bg-shift-dangerBg text-shift-danger' }[tone];
  return <span className={`inline-block text-[12.5px] font-medium rounded-full px-2.5 py-0.5 whitespace-nowrap ${cls}`}>{children}</span>;
}

export const fieldClass = 'h-11 px-3 border border-shift-field rounded-xl text-[15px] text-shift-ink bg-white placeholder:text-shift-muted w-full';
export const labelClass = 'text-[13.5px] font-medium text-shift-ink';

export function Field({ label, hint, htmlFor, children }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={htmlFor} className={labelClass}>
        {label}{hint && <span className="font-normal text-shift-body"> {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/** A side drawer on the inline start (the right, in Arabic). Esc and the backdrop close it. */
export function Drawer({ title, onClose, children, width = 440 }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[55] bg-shift-ink/25 flex justify-start" onMouseDown={onClose}>
      <aside role="dialog" aria-modal="true" aria-label={title} onMouseDown={(e) => e.stopPropagation()}
        style={{ maxWidth: width }}
        className="w-full h-full overflow-y-auto bg-white p-[22px] flex flex-col gap-3.5 shadow-[0_0_40px_rgba(15,30,56,.2)]">
        <div className="flex items-center gap-2.5">
          <h2 className="flex-1 m-0 font-display text-lg font-semibold text-shift-ink">{title}</h2>
          <button type="button" onClick={onClose} aria-label="إغلاق"
            className="w-10 h-10 rounded-[10px] border border-shift-line bg-white grid place-items-center text-shift-ink hover:bg-[#F1F3F7]">
            <X size={18} />
          </button>
        </div>
        {children}
      </aside>
    </div>
  );
}

/** The quiet footnote every screen ends with. */
export function Footnote({ children }) {
  return <p className="mt-4 text-[13px] text-shift-muted">{children}</p>;
}
