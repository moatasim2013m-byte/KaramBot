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

const input = 'w-full rounded-md border border-gray-200 px-3 py-2 text-[14px] focus:outline-none focus:ring-1 focus:ring-green-500';

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
    <form onSubmit={save} className="mt-2 space-y-2 rounded-lg bg-gray-50 p-3">
      {needsQuestion && (
        <input value={question} onChange={(e) => setQuestion(e.target.value)} required
          placeholder="سؤال الزبون — كما يكتبه هو" className={input} />
      )}
      <textarea value={content} onChange={(e) => setContent(e.target.value)} required rows={2} autoFocus={!needsQuestion || Boolean(preset)}
        placeholder={group.hint} className={`${input} resize-none`} />
      <p className="text-[11px] text-gray-500">اكتبها كما تقولها لزبونك على الهاتف.</p>
      {error && <p className="text-[12px] text-red-700">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy || !content.trim() || (needsQuestion && !question.trim())}
          className="inline-flex items-center gap-1.5 h-10 px-4 rounded-md bg-green-600 text-white text-[13px] font-medium disabled:opacity-40">
          {busy && <Loader2 size={13} className="animate-spin" />} احفظ
        </button>
        <button type="button" onClick={onCancel} className="h-10 px-3 text-[13px] text-gray-600">إلغاء</button>
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
    <section className="rounded-xl border border-gray-200 bg-white">
      <header className="flex items-center justify-between px-4 h-11 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-gray-500" />
          <h3 className="text-[14px] font-semibold text-gray-800">ماذا يعرف البوت عن محلك</h3>
        </div>
        {items && <span className="text-[11px] text-gray-400">{activeCount} مفعّلة</span>}
      </header>

      {items && activeCount === 0 && (
        <p className="px-4 py-2.5 bg-amber-50 border-b border-amber-100 text-[12px] text-amber-900">
          بدون هذه المعلومات يرد البوت بالترحيب فقط ولا يجيب عن أي سؤال.
        </p>
      )}

      {chips.length > 0 && (
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-[12px] text-gray-500 mb-2">اقتراحات لمحلات مثل محلك</p>
          <div className="flex flex-wrap gap-2">
            {chips.map((q) => (
              <button key={q} type="button" onClick={() => setAdding({ kind: 'faq', preset: q })}
                className="h-8 px-3 rounded-full border border-green-200 bg-green-50 text-[12px] text-green-800 hover:bg-green-100">
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

      {error && <p className="px-4 py-2 text-[13px] text-red-700">{error}</p>}

      {!items ? (
        <div className="px-4 py-4 animate-pulse"><div className="h-3 w-1/2 bg-gray-100 rounded" /></div>
      ) : (
        <div className="divide-y divide-gray-100">
          {GROUPS.map((group) => {
            const rows = items.filter((i) => i.kind === group.kind);
            const open = adding?.kind === group.kind && !adding.preset;
            return (
              <div key={group.kind} className="px-4 py-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-[13px] font-semibold text-gray-700">
                    {group.label} {rows.length > 0 && <span className="text-gray-400 font-normal">({rows.length})</span>}
                  </h4>
                  {!open && (
                    <button type="button" onClick={() => setAdding({ kind: group.kind })}
                      className="inline-flex items-center gap-1 h-8 px-2 text-[12px] font-medium text-green-700">
                      <Plus size={13} /> أضف
                    </button>
                  )}
                </div>
                {rows.length > 0 && (
                  <ul className="mt-1 space-y-1">
                    {rows.map((item) => (
                      <li key={item.id} className={`flex items-start gap-2 py-1 ${item.active ? '' : 'opacity-50'}`}>
                        <div className="flex-1 min-w-0">
                          {item.question && <p className="text-[12px] text-gray-500">س: {item.question}</p>}
                          <p className="text-[13px] text-gray-800 whitespace-pre-wrap">{item.content}</p>
                        </div>
                        <button onClick={() => toggle(item)} className="p-1.5 text-gray-400 hover:text-gray-700 shrink-0" title={item.active ? 'إيقاف مؤقت' : 'تفعيل'}>
                          {item.active ? <Eye size={14} /> : <EyeOff size={14} />}
                        </button>
                        <button onClick={() => remove(item)} className="p-1.5 text-gray-400 hover:text-red-600 shrink-0" title="حذف">
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
