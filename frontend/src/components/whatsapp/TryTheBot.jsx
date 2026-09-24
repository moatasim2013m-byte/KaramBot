import { useEffect, useRef, useState } from 'react';
import { Bot, Send, RotateCcw, User } from 'lucide-react';
import api from '../../utils/api';

/**
 * «جرّب البوت» — the customer types what a customer would, and sees what the bot would say.
 *
 * Both walkthrough personas asked for exactly this: the dentist afraid of a wrong price to a
 * patient, the restaurant owner who changed the price of the mixed plate a month ago. It runs
 * the account's REAL workflow — same menu, same services, same rules — and sends nothing.
 * State comes back with every reply so a whole exchange («بدي أحجز» → «أي خدمة؟») can be walked.
 *
 * `endpoint` lets the admin panel reuse it against a chosen account.
 */

const ACTION_LABEL = {
  CONFIRM_ORDER: 'كان سيُسجَّل طلب هنا',
  CONFIRM_APPOINTMENT: 'كان سيُحجز موعد هنا',
  BOOK_APPOINTMENT: 'كان سيُحجز موعد هنا',
  HANDOFF: 'كان سيُحوَّل لموظف هنا',
};

export default function TryTheBot({ endpoint = '/whatsapp/status/test', suggestions }) {
  const [turns, setTurns] = useState([]);           // { from: 'customer'|'bot', text, action?, handed? }
  const [state, setState] = useState({});
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);           // has_workflow, latency
  const endRef = useRef(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [turns]);

  const send = async (msg) => {
    const m = String(msg ?? text).trim();
    if (!m || busy) return;
    setBusy(true); setError(null); setText('');
    setTurns((t) => [...t, { from: 'customer', text: m }]);
    try {
      const res = await api.post(endpoint, { message: m, state });
      const d = res.data;
      setState(d.state || {});
      setMeta({ has_workflow: d.has_workflow, latency_ms: d.latency_ms, ai_enabled: d.ai_enabled });
      setTurns((t) => [...t, { from: 'bot', text: d.reply, action: d.action, handed: d.state?.handed_to_human }]);
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحصول على رد');
      setTurns((t) => t.slice(0, -1));
    } finally { setBusy(false); }
  };

  const reset = () => { setTurns([]); setState({}); setMeta(null); setError(null); };

  const hints = suggestions || ['مرحبا، شو أسعاركم؟', 'بدي أحجز', 'وين موقعكم؟'];

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between px-4 h-11 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <Bot size={15} className="text-gray-500" />
          <h3 className="text-[13px] font-semibold text-gray-700">جرّب البوت</h3>
          <span className="text-[11px] text-gray-400">— تجربة فقط، لا يُرسَل شيء ولا يُحفَظ</span>
        </div>
        {turns.length > 0 && (
          <button onClick={reset} className="flex items-center gap-1 text-[12px] text-gray-500 hover:text-gray-800">
            <RotateCcw size={12} /> محادثة جديدة
          </button>
        )}
      </header>

      {meta?.has_workflow === false && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[12px] text-amber-900">
          هذا الحساب بلا مسار عمل بعد: البوت يرد على الجميع بالترحيب الثابت فقط. ما تراه هنا هو ما يراه الزبون فعلًا.
        </div>
      )}
      {meta?.ai_enabled === false && (
        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[12px] text-amber-900">
          الرد الآلي موقوف لهذا الحساب — الزبائن لن يصلهم هذا الرد حتى يُعاد تشغيله.
        </div>
      )}

      <div className="px-4 py-3 space-y-2.5 min-h-[140px] max-h-[380px] overflow-y-auto">
        {turns.length === 0 && (
          <div className="text-center py-6">
            <p className="text-[13px] text-gray-600">اكتب ما قد يكتبه زبون، وشاهد ردّ البوت كما سيصله بالضبط.</p>
            <div className="flex flex-wrap justify-center gap-2 mt-3">
              {hints.map((h) => (
                <button key={h} onClick={() => send(h)} className="text-[12px] px-2.5 h-7 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">{h}</button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) => (
          <div key={i} className={`flex ${t.from === 'bot' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] rounded-lg px-3 py-2 ${t.from === 'bot' ? 'bg-gray-100' : 'bg-emerald-50'}`}>
              <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-gray-500">
                {t.from === 'bot' ? <><Bot size={10} /> البوت</> : <><User size={10} /> الزبون (أنت)</>}
              </div>
              <p className="text-[13px] text-gray-800 whitespace-pre-wrap leading-relaxed">{t.text || <span className="text-gray-400">(بدون رد)</span>}</p>
              {t.from === 'bot' && ACTION_LABEL[t.action] && (
                <p className="mt-1 text-[11px] text-emerald-800">✓ {ACTION_LABEL[t.action]} — لم يحدث لأنها تجربة</p>
              )}
              {t.from === 'bot' && t.handed && (
                <p className="mt-1 text-[11px] text-amber-800">↪ البوت حوّل المحادثة لموظف من هنا</p>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && <p className="px-4 pb-2 text-[12px] text-red-700">{error}</p>}

      <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex gap-2 px-4 py-3 border-t border-gray-100">
        <input
          value={text} onChange={(e) => setText(e.target.value)} disabled={busy}
          placeholder="اكتب كزبون…"
          className="flex-1 h-9 px-3 text-[13px] border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-gray-400 disabled:bg-gray-50"
        />
        <button type="submit" disabled={busy || !text.trim()} className="flex items-center gap-1.5 bg-gray-900 text-white px-3 h-9 rounded-md text-[13px] hover:bg-gray-800 disabled:opacity-40">
          <Send size={13} /> {busy ? 'جارٍ…' : 'إرسال'}
        </button>
      </form>
    </section>
  );
}
