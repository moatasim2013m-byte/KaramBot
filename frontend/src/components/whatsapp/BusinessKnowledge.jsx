import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, BookOpen, EyeOff, Eye } from 'lucide-react';
import api from '../../utils/api';
import { SkeletonRows, EmptyState } from '../shared/Primitives';

/**
 * «معلومات المنشأة» — what the agent is allowed to say.
 *
 * A restaurant's agent answers from its menu and a clinic's from its services. Every other
 * business had nothing, so its agent greeted and stopped. This is where that owner writes what
 * their customers actually ask about — and the prompt tells the model to answer from this and
 * refuse to invent anything else, which is the whole reason a dentist was afraid to switch it on.
 */

const KIND = {
  fact: { label: 'معلومة', hint: 'مثال: نوصّل داخل إربد خلال ساعة.' },
  hours: { label: 'أوقات العمل', hint: 'مثال: السبت–الخميس 9 صباحًا – 9 مساءً، الجمعة مغلق.' },
  service: { label: 'خدمة وسعر', hint: 'مثال: تغيير زيت — 15 دينارًا، يستغرق 20 دقيقة.' },
  policy: { label: 'سياسة', hint: 'مثال: الاسترجاع خلال 3 أيام مع الفاتورة.' },
  faq: { label: 'سؤال شائع', hint: 'سؤال العميل كما يكتبه، والجواب.' },
};

const input = 'w-full h-9 px-3 text-[13px] border border-shift-line rounded-md focus:outline-none focus:ring-1 focus:ring-shift-muted';

export default function BusinessKnowledge({ businessId }) {
  const qs = businessId ? `?businessId=${businessId}` : '';
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState({ kind: 'fact', question: '', content: '' });
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api.get(`/knowledge${qs}`)
      .then((res) => setItems(res.data.items))
      .catch((err) => setError(err.response?.data?.error || 'تعذّر تحميل المعلومات'));
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  const add = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      await api.post(`/knowledge${qs}`, form);
      setForm({ kind: form.kind, question: '', content: '' });
      load();
    } catch (err) { setError(err.response?.data?.error || 'تعذّر الحفظ'); }
    finally { setBusy(false); }
  };

  const toggle = async (item) => {
    try { await api.patch(`/knowledge/${item.id}${qs}`, { active: !item.active }); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر التعديل'); }
  };

  const remove = async (item) => {
    try { await api.delete(`/knowledge/${item.id}${qs}`); load(); }
    catch (err) { setError(err.response?.data?.error || 'تعذّر الحذف'); }
  };

  const activeCount = (items || []).filter((i) => i.active).length;

  return (
    <section className="rounded-lg border border-shift-line bg-white">
      <header className="flex items-center justify-between px-4 h-11 border-b border-shift-line2">
        <div className="flex items-center gap-2">
          <BookOpen size={15} className="text-shift-muted" />
          <h3 className="text-[13px] font-semibold text-shift-body">معلومات المنشأة</h3>
          <span className="text-[11px] text-shift-muted">— ما يُسمح للوكيل أن يقوله</span>
        </div>
        {items && <span className="text-[11px] text-shift-muted">{activeCount} مفعّلة</span>}
      </header>

      {activeCount === 0 && items && (
        <div className="px-4 py-2.5 bg-shift-warnBg border-b border-shift-warnBg text-[12px] text-shift-warn">
          بدون معلومات، يرد الوكيل برسالة الترحيب فقط ولا يجيب عن أي سؤال. أضف أول معلومة وجرّبه بعدها.
        </div>
      )}

      <form onSubmit={add} className="px-4 py-3 border-b border-shift-line2 bg-shift-canvas space-y-2">
        <div className="flex flex-wrap gap-2">
          {Object.entries(KIND).map(([k, v]) => (
            <button
              key={k} type="button" onClick={() => setForm({ ...form, kind: k })}
              className={`h-7 px-2.5 rounded-full text-[12px] transition-colors ${form.kind === k ? 'bg-shift-ink text-white' : 'bg-white border border-shift-line text-shift-body hover:border-shift-field'}`}
            >{v.label}</button>
          ))}
        </div>
        {form.kind === 'faq' && (
          <input value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })}
            placeholder="سؤال العميل — كما يكتبه هو" className={input} />
        )}
        <textarea
          value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })}
          placeholder={KIND[form.kind].hint} rows={2} required
          className={`${input} h-auto py-2 resize-none`}
        />
        <div className="flex items-center gap-2">
          <button type="submit" disabled={busy || !form.content.trim()}
            className="flex items-center gap-1.5 bg-shift-ink text-white px-3 h-8 rounded-md text-[13px] hover:bg-shift-ink2 disabled:opacity-40">
            <Plus size={14} /> {busy ? 'جارٍ…' : 'أضف'}
          </button>
          <span className="text-[11px] text-shift-muted">اكتبها كما تقولها لزبون على الهاتف.</span>
        </div>
      </form>

      {error && <p className="px-4 py-2 text-[13px] text-shift-danger">{error}</p>}

      {!items ? <SkeletonRows rows={3} cols={2} /> : items.length === 0 ? (
        <EmptyState icon={BookOpen} tone="neutral" title="لا توجد معلومات بعد"
          hint="ابدأ بأوقات العمل وأكثر ثلاثة أسئلة يسألها زبائنك" />
      ) : (
        <ul className="divide-y divide-shift-canvas">
          {items.map((item) => (
            <li key={item.id} className={`flex items-start gap-3 px-4 py-2.5 ${item.active ? '' : 'opacity-50'}`}>
              <span className="text-[11px] text-shift-muted shrink-0 mt-0.5 w-20">{KIND[item.kind]?.label || item.kind}</span>
              <div className="flex-1 min-w-0">
                {item.question && <p className="text-[12px] text-shift-muted">س: {item.question}</p>}
                <p className="text-[13px] text-shift-ink whitespace-pre-wrap">{item.content}</p>
              </div>
              <button onClick={() => toggle(item)} className="text-shift-muted hover:text-shift-body shrink-0" title={item.active ? 'إيقاف مؤقت' : 'تفعيل'}>
                {item.active ? <Eye size={14} /> : <EyeOff size={14} />}
              </button>
              <button onClick={() => remove(item)} className="text-shift-muted hover:text-shift-danger shrink-0" title="حذف">
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
