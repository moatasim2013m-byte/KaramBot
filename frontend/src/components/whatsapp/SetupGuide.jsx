import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, ArrowLeft, ExternalLink, CheckCircle2, Clock } from 'lucide-react';
import api from '../../utils/api';
import { stepControls } from './setupControls';
import { ClaimCardButton, ConnectInline } from './OwnerSetupActions';

/**
 * «خطوات تشغيل البوت» — what is left, in the order it has to happen.
 *
 * Both walkthrough personas signed in to four zeros and could not tell whether anything worked.
 * A dentist paying 120 dinars a month said it felt like buying a washing machine with no power
 * button. This is the button: every step derived from what we actually store, and each one
 * labelled with whose move it is — because «فريق شِفت يربط الرقم» and «أضف طريقة دفع» are very
 * different kinds of waiting, and a list that does not say which is just anxiety.
 *
 * It disappears once everything is done. A setup guide that lingers becomes furniture.
 */

const OWNER_BADGE = {
  you: { label: 'عليك', cls: 'bg-shift-warnBg text-shift-warn' },
  shift: { label: 'على شِفت', cls: 'bg-shift-sel text-shift-selText' },
  nobody: { label: 'تلقائي', cls: 'bg-shift-line2 text-shift-muted' },
};

// A page that already read GET /whatsapp/status («الرئيسية») passes its `setup` and its own
// `onReload`, so the checklist and the status line come from one read and refresh together.
export default function SetupGuide({ setup: given, onReload } = {}) {
  const [own, setOwn] = useState(null);
  const controlled = given !== undefined;
  const setup = controlled ? given : own;

  const load = useCallback(() => {
    if (controlled) { if (onReload) onReload(); return; }
    api.get('/whatsapp/status')
      .then((res) => setOwn(res.data.setup || null))
      .catch(() => setOwn(null));
  }, [controlled, onReload]);

  useEffect(() => { if (!controlled) load(); }, [controlled, load]);

  // The footer promises this list disappears on its own, and the last step — a customer writing
  // in — completes without anyone touching the page. So it keeps looking while there is anything
  // left, and stops the moment there is not.
  useEffect(() => {
    if (setup?.done) return undefined;
    const t = setInterval(load, 60000);
    return () => clearInterval(t);
  }, [setup?.done, load]);

  if (!setup || setup.done) return null;

  const total = setup.steps.length;
  const done = setup.steps.filter((s) => s.done).length;

  return (
    <section className="rounded-2xl border border-shift-line bg-white overflow-hidden">
      {/* The dark header is the one place on the page that says how far along the shop is. */}
      <header className="px-4 py-4 bg-shift-ink text-white">
        <div className="flex items-center justify-between gap-3">
          <h3 className="font-display text-[16px] font-semibold">خطوات تشغيل البوت</h3>
          <span className="text-[12px] text-shift-navText tabular-nums">{done} من {total}</span>
        </div>
        {setup.next ? (
          <p className="text-[13px] text-shift-navText mt-1.5 leading-relaxed">
            التالي: <strong className="font-semibold text-white">{setup.next.label}</strong>
          </p>
        ) : setup.waiting_for_first_message ? (
          <p className="text-[13px] text-shift-navText mt-1.5 leading-relaxed">
            كل ما عليك تمّ — البوت جاهز وبانتظار أول زبون يراسلك.
          </p>
        ) : null}
        <div className="mt-3 h-1.5 bg-shift-ink2 rounded-full overflow-hidden">
          <div className="h-full bg-shift-gold transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </header>

      <ol className="divide-y divide-shift-canvas">
        {setup.steps.map((step, i) => {
          const badge = OWNER_BADGE[step.owner] || OWNER_BADGE.nobody;
          const current = !step.done && setup.next && setup.next.key === step.key;
          return (
            <li key={step.key} className="px-4 py-3">
              <div className="flex items-start gap-3">
                {/* Done: a green check. Next: the blue number. Later: a grey number. */}
                <span className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-display font-bold ${
                  step.done ? 'bg-shift-okBg text-shift-ok' : current ? 'bg-shift-accent text-white' : 'bg-shift-line2 text-shift-muted'}`}>
                  {step.done ? <Check size={14} strokeWidth={3} /> : i + 1}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[14px] ${step.done ? 'text-shift-muted line-through decoration-shift-field' : 'font-semibold text-shift-ink'}`}>
                      {step.label}
                    </span>
                    {!step.done && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    )}
                  </div>

                  {!step.done && step.hint && (
                    <p className="text-[12px] text-shift-muted mt-0.5 leading-relaxed">{step.hint}</p>
                  )}

                  {stepControls(step).map((c) => {
                    if (c.kind === 'connect') return <ConnectInline key={c.kind} onDone={load} />;
                    if (c.kind === 'claim') return <ClaimCardButton key={c.kind} onDone={load} />;
                    if (c.kind === 'manager') {
                      return (
                        <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1.5 me-3 text-[12px] font-medium text-shift-warn underline underline-offset-2">
                          {c.label} <ExternalLink size={11} />
                        </a>
                      );
                    }
                    if (c.kind === 'where') {
                      return (
                        <Link key={c.kind} to={c.to}
                          className="inline-flex items-center gap-1 mt-1.5 text-[12px] font-medium text-shift-ink underline underline-offset-2">
                          {c.label} <ArrowLeft size={11} />
                        </Link>
                      );
                    }
                    if (c.kind === 'shift_wait') {
                      return (
                        <p key={c.kind} className="inline-flex items-center gap-1 mt-1.5 text-[12px] text-shift-muted">
                          <Clock size={11} /> {c.label}
                        </p>
                      );
                    }
                    return null;
                  })}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <footer className="px-4 py-2.5 bg-shift-canvas border-t border-shift-line2">
        <p className="text-[11px] text-shift-muted flex items-center gap-1.5">
          <CheckCircle2 size={11} className="text-shift-ok" />
          تختفي هذه القائمة تلقائيًا عندما تكتمل الخطوات.
        </p>
      </footer>
    </section>
  );
}
