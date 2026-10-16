import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HelpCircle, Loader2, CheckCircle2 } from 'lucide-react';
import api from '../../utils/api';
import { relativeTime } from '../shared/Primitives';

/**
 * «ما عرف يجاوب» — the questions the bot gave up on, each with a one-tap fix.
 *
 * Only questions the model itself could not answer are listed (handoff_kind 'model'): a customer
 * typing «بدي موظف» or a provider outage is not something the owner can teach away. Answering
 * writes a «سؤال متكرر» the bot reads from the next message on, and closes the question; «تجاهل»
 * only closes it. On «الرئيسية» it shows the newest three and links to the full list on «البوت».
 */
export default function KnowledgeGaps({ limit = null, onChange, embedded = false }) {
  const [gaps, setGaps] = useState(null);
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(null);       // id of the gap being answered
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState(null);       // id being saved or dismissed
  const [taught, setTaught] = useState(0);

  const load = useCallback(() => {
    api.get('/knowledge/gaps')
      .then((res) => { setGaps(res.data.gaps || []); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل الأسئلة'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const after = () => { load(); if (onChange) onChange(); };

  const teach = async (gap) => {
    const text = answer.trim();
    if (!text) return;
    setBusy(gap.id); setError(null);
    try {
      await api.post(`/knowledge/gaps/${gap.id}/answer`, { answer: text });
      setOpen(null); setAnswer(''); setTaught((n) => n + 1);
      after();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      setBusy(null);
    }
  };

  const dismiss = async (gap) => {
    setBusy(gap.id); setError(null);
    try {
      await api.delete(`/knowledge/gaps/${gap.id}`);
      after();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ، حاول مرة أخرى');
    } finally {
      setBusy(null);
    }
  };

  const shown = gaps ? (limit ? gaps.slice(0, limit) : gaps) : null;

  return (
    <section className={embedded ? '' : 'rounded-2xl border border-shift-line bg-white'}>
      <header className="flex items-center justify-between px-4 h-11 border-b border-shift-line2">
        <div className="flex items-center gap-2">
          <HelpCircle size={15} className="text-amber-600" />
          <h3 className="text-[14px] font-semibold text-shift-ink">ما عرف يجاوب</h3>
          {gaps && gaps.length > 0 && <span className="text-[11px] bg-shift-warnBg text-shift-warn rounded-full px-1.5">{gaps.length}</span>}
        </div>
        {limit && gaps && gaps.length > limit && (
          <Link to="/bot" className="text-[12px] text-shift-body underline underline-offset-2">كل الأسئلة</Link>
        )}
      </header>

      {error && <p className="px-4 py-2 text-[13px] text-shift-danger">{error}</p>}
      {taught > 0 && (
        <p className="px-4 py-2 text-[12px] text-emerald-800 bg-emerald-50 flex items-center gap-1.5">
          <CheckCircle2 size={13} /> تعلّم البوت الجواب — يستعمله من الرسالة القادمة.
        </p>
      )}

      {!shown ? (
        <div className="px-4 py-4 animate-pulse"><div className="h-3 w-1/2 bg-shift-line2 rounded" /></div>
      ) : shown.length === 0 ? (
        <p className="px-4 py-5 text-[13px] text-shift-muted text-center">لا أسئلة بلا جواب الآن. أي سؤال لا يعرفه البوت يظهر هنا.</p>
      ) : (
        <ul className="divide-y divide-shift-canvas">
          {shown.map((gap) => (
            <li key={gap.id} className="px-4 py-3">
              <p className="text-[14px] text-shift-ink leading-relaxed">«{gap.question || '—'}»</p>
              <p className="text-[11px] text-shift-muted mt-0.5">{relativeTime(gap.at)}</p>
              {open === gap.id ? (
                <div className="mt-2 space-y-2">
                  <textarea
                    autoFocus rows={2} value={answer} onChange={(e) => setAnswer(e.target.value)}
                    placeholder="اكتب الجواب كما تقوله لزبونك على الهاتف"
                    className="w-full rounded-md border border-shift-line px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-shift-ok resize-none"
                  />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => teach(gap)} disabled={busy === gap.id || !answer.trim()}
                      className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-shift-ok text-white text-[13px] font-medium disabled:opacity-40">
                      {busy === gap.id && <Loader2 size={13} className="animate-spin" />} احفظ الجواب
                    </button>
                    <button type="button" onClick={() => { setOpen(null); setAnswer(''); }}
                      className="h-10 px-3 rounded-md text-[13px] text-shift-body">إلغاء</button>
                  </div>
                </div>
              ) : (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => { setOpen(gap.id); setAnswer(''); }}
                    className="h-9 px-3 rounded-md bg-shift-ok text-white text-[13px] font-medium">
                    علّم البوت الجواب
                  </button>
                  <button type="button" onClick={() => dismiss(gap)} disabled={busy === gap.id}
                    className="h-9 px-3 rounded-md border border-shift-line text-[13px] text-shift-body disabled:opacity-40">
                    تجاهل
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
