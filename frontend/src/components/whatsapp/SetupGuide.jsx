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
  you: { label: 'عليك', cls: 'bg-amber-100 text-amber-900' },
  shift: { label: 'على شِفت', cls: 'bg-gray-100 text-gray-600' },
  nobody: { label: 'تلقائي', cls: 'bg-gray-100 text-gray-500' },
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
    <section className="rounded-lg border border-gray-200 bg-white overflow-hidden">
      <header className="px-4 py-3 border-b border-gray-100">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[14px] font-semibold text-gray-900">خطوات تشغيل البوت</h3>
          <span className="text-[12px] text-gray-500 tabular-nums">{done} من {total}</span>
        </div>
        {setup.next ? (
          <p className="text-[13px] text-gray-600 mt-1">
            التالي: <strong className="font-medium text-gray-900">{setup.next.label}</strong>
          </p>
        ) : setup.waiting_for_first_message ? (
          <p className="text-[13px] text-emerald-800 mt-1">
            كل ما عليك تمّ — البوت جاهز وبانتظار أول زبون يراسلك.
          </p>
        ) : null}
        <div className="mt-2 h-1 bg-gray-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-500 transition-all duration-500" style={{ width: `${(done / total) * 100}%` }} />
        </div>
      </header>

      <ol className="divide-y divide-gray-50">
        {setup.steps.map((step) => {
          const badge = OWNER_BADGE[step.owner] || OWNER_BADGE.nobody;
          return (
            <li key={step.key} className={`px-4 py-3 ${step.done ? 'bg-gray-50/50' : ''}`}>
              <div className="flex items-start gap-3">
                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-full flex items-center justify-center ${step.done ? 'bg-emerald-500' : 'border border-gray-300'}`}>
                  {step.done && <Check size={11} className="text-white" strokeWidth={3} />}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-[13px] ${step.done ? 'text-gray-500 line-through decoration-gray-300' : 'font-medium text-gray-900'}`}>
                      {step.label}
                    </span>
                    {!step.done && (
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${badge.cls}`}>{badge.label}</span>
                    )}
                  </div>

                  {!step.done && step.hint && (
                    <p className="text-[12px] text-gray-500 mt-0.5 leading-relaxed">{step.hint}</p>
                  )}

                  {stepControls(step).map((c) => {
                    if (c.kind === 'connect') return <ConnectInline key={c.kind} onDone={load} />;
                    if (c.kind === 'claim') return <ClaimCardButton key={c.kind} onDone={load} />;
                    if (c.kind === 'manager') {
                      return (
                        <a key={c.kind} href={c.href} target="_blank" rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-1.5 me-3 text-[12px] font-medium text-amber-900 underline underline-offset-2">
                          {c.label} <ExternalLink size={11} />
                        </a>
                      );
                    }
                    if (c.kind === 'where') {
                      return (
                        <Link key={c.kind} to={c.to}
                          className="inline-flex items-center gap-1 mt-1.5 text-[12px] font-medium text-gray-900 underline underline-offset-2">
                          {c.label} <ArrowLeft size={11} />
                        </Link>
                      );
                    }
                    if (c.kind === 'shift_wait') {
                      return (
                        <p key={c.kind} className="inline-flex items-center gap-1 mt-1.5 text-[12px] text-gray-500">
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

      <footer className="px-4 py-2.5 bg-gray-50 border-t border-gray-100">
        <p className="text-[11px] text-gray-500 flex items-center gap-1.5">
          <CheckCircle2 size={11} className="text-emerald-600" />
          تختفي هذه القائمة تلقائيًا عندما تكتمل الخطوات.
        </p>
      </footer>
    </section>
  );
}
