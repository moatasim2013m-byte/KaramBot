import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Eye, EyeOff, Loader2, BookOpen } from 'lucide-react';
import api from '../../utils/api';

/**
 * «ماذا يعرف البوت عن محلك» — the shop's knowledge, in the five drawers an owner thinks in.
 *
 * The same rows as BusinessKnowledge (the admin's flat list), one group per kind: الدوام (hours),
 * الموقع والتوصيل (fact), الأسعار والخدمات (service), أسئلة متكررة (faq), سياسات (policy). Each has
 * its own «+ أضف», and the suggestion chips are questions shops like this one actually get, so an
 * owner staring at an empty form has somewhere to start. A chip opens «أسئلة متكررة» with the
 * question already typed; the owner writes only the answer.
 */

export const GROUPS = [
  { kind: 'hours', label: 'الدوام', hint: 'مثال: السبت–الخميس 9 صباحًا – 9 مساءً، الجمعة مغلق.' },
  { kind: 'fact', label: 'الموقع والتوصيل', hint: 'مثال: إربد، شارع الجامعة قرب دوار القبة. نوصّل داخل إربد خلال ساعة.' },
  { kind: 'service', label: 'الأسعار والخدمات', hint: 'مثال: قص شعر رجالي — 5 دنانير.' },
  { kind: 'faq', label: 'أسئلة متكررة', hint: 'الجواب كما تقوله لزبونك.' },
  { kind: 'policy', label: 'سياسات', hint: 'مثال: الاسترجاع خلال 3 أيام مع الفاتورة.' },
];

// «اقتراحات لمحلات مثل محلك», by sector (Business.sector), else by business type.
export const SUGGESTIONS = {
  pharmacy: ['هل عندكم توصيل؟', 'هل تقبلون التأمين؟', 'هل تفتحون يوم الجمعة؟', 'هل الدواء متوفر بدون وصفة؟'],
  salon: ['هل لازم حجز مسبق؟', 'كم سعر القص؟', 'هل عندكم خدمة عرائس؟', 'هل تفتحون يوم الجمعة؟'],
  clothing: ['هل عندكم مقاسات كبيرة؟', 'هل يمكن التبديل؟', 'هل عندكم توصيل؟', 'هل في خصومات؟'],
  shop: ['هل عندكم توصيل؟', 'ما طرق الدفع؟', 'هل يمكن الاسترجاع؟', 'متى تفتحون؟'],
  restaurant: ['هل عندكم توصيل لمنطقتي؟', 'كم رسوم التوصيل؟', 'هل عندكم جلسات عائلية؟', 'هل تقبلون بطاقة؟'],
  clinic: ['هل تقبلون التأمين؟', 'كم سعر الكشفية؟', 'هل يوجد طبيبة؟', 'هل لازم حجز مسبق؟'],
  other: ['هل عندكم توصيل؟', 'ما طرق الدفع؟', 'متى تفتحون؟', 'أين موقعكم بالضبط؟'],
};

const input = 'w-full rounded-md border border-shift-line px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-shift-ok';

function AddForm({ group, preset, onSaved, onCancel }) {
  const [question, setQuestion] = useState(preset || '');
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const needsQuestion = group.kind === 'faq';

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post('/knowledge', { kind: group.kind, content, question: needsQuestion ? question : undefined });
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر الحفظ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={save} className="mt-2 space-y-2 rounded-lg bg-shift-canvas p-3">
      {needsQuestion && (
        <input value={question} onChange={(e) => setQuestion(e.target.value)} required
          placeholder="سؤال الزبون — كما يكتبه هو" className={input} />
      )}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={2} autoFocus={!needsQuestion || Boolean(preset)}
        placeholder={group.hint} className={`${input} resize-none`} />
      <p className="text-[11px] text-shift-muted">اكتبها كما تقولها لزبونك على الهاتف.</p>
      {error && <p className="text-[12px] text-shift-danger">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !content.trim() || (needsQuestion && !question.trim())}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-shift-ok text-white text-[13px] font-medium disabled:opacity-40">
          {busy && <Loader2 size={13} className="animate-spin" />} احفظ
        </button>
        <button type="button" onClick={onCancel} className="h-10 px-3 text-[13px] text-shift-body">إلغاء</button>
      </div>
    </form>
  );
}

export default function KnowledgeByGroup({ sector }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [adding, setAdding] = useState(null);   // { kind, preset }

  const load = useCallback(() => {
    api.get('/knowledge')
      .then((res) => { setItems(res.data.items || []); setError(null); })
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المعلومات'));
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (item) => {
    try { await api.patch(`/knowledge/${item.id}`, { active: !item.active }); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر التعديل'); }
  };

  const remove = async (item) => {
    if (!window.confirm('حذف هذه المعلومة؟ لن يعرفها البوت بعد الآن.')) return;
    try { await api.delete(`/knowledge/${item.id}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر الحذف'); }
  };

  const asked = new Set((items || []).filter((i) => i.kind === 'faq').map((i) => (i.question || '').trim()));
  const chips = (SUGGESTIONS[sector] || SUGGESTIONS.other).filter((q) => !asked.has(q));
  const activeCount = (items || []).filter((i) => i.active).length;
  const faqGroup = GROUPS.find((g) => g.kind === 'faq');

  return (
    <section className="rounded-2xl border border-shift-line bg-white">
      <header className="flex items-center justify-between px-4 h-11 border-b border-shift-line2">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-shift-muted" />
          <h3 className="text-[14px] font-semibold text-shift-ink">ماذا يعرف البوت عن محلك</h3>
        </div>
        {items && <span className="text-[11px] text-shift-muted">{activeCount} مفعّلة</span>}
      </header>

      {items && activeCount === 0 && (
        <p className="px-4 py-2.5 bg-shift-warnBg border-b border-shift-warnBg text-[12px] text-shift-warn">
          بدون هذه المعلومات يرد البوت بالترحيب فقط ولا يجيب عن أي سؤال.
        </p>
      )}

      {chips.length > 0 && (
        <div className="px-4 py-3 border-b border-shift-line2">
          <p className="text-[12px] text-shift-muted mb-2">اقتراحات لمحلات مثل محلك</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((q) => (
              <button key={q} type="button" onClick={() => setAdding({ kind: 'faq', preset: q })}
                className="h-8 px-3 rounded-full border border-green-200 bg-shift-okBg text-[12px] text-shift-ok">
                + {q}
              </button>
            ))}
          </div>
          {adding?.kind === 'faq' && adding.preset && (
            <AddForm key={adding.preset} group={faqGroup} preset={adding.preset}
              onSaved={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
          )}
        </div>
      )}

      {error && <p className="px-4 py-2 text-[13px] text-shift-danger">{error}</p>}

      {!items ? (
        <div className="px-4 py-4 animate-pulse"><div className="h-3 w-1/2 bg-shift-line2 rounded" /></div>
      ) : (
        <div className="divide-y divide-shift-line2">
          {GROUPS.map((group) => {
            const rows = items.filter((i) => i.kind === group.kind);
            const open = adding?.kind === group.kind && !adding.preset;
            return (
              <div key={group.kind} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-shift-body">
                    {group.label} {rows.length > 0 && <span className="text-shift-muted font-normal">({rows.length})</span>}
                  </h4>
                  {!open && (
                    <button type="button" onClick={() => setAdding({ kind: group.kind })}
                      className="inline-flex items-center gap-1 h-8 px-2 text-[12px] font-medium text-shift-ok">
                      <Plus size={13} /> أضف
                    </button>
                  )}
                </div>
                {rows.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {rows.map((item) => (
                      <li key={item.id} className={`flex items-start gap-2 py-1 ${item.active ? '' : 'opacity-50'}`}>
                        <div className="flex-1 min-w-0">
                          {item.question && <p className="text-[12px] text-shift-muted">س: {item.question}</p>}
                          <p className="text-[13px] text-shift-ink whitespace-pre-wrap">{item.content}</p>
                        </div>
                        <button onClick={() => toggle(item)} className="p-1.5 text-shift-muted hover:text-shift-body shrink-0" title={item.active ? 'إيقاف مؤقت' : 'تفعيل'}>
                          {item.active ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button onClick={() => remove(item)} className="p-1.5 text-shift-muted hover:text-shift-danger shrink-0" title="حذف">
                          <Trash2 size={14} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {open && (
                  <AddForm group={group} onSaved={() => { setAdding(null); load(); }} onCancel={() => setAdding(null)} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
