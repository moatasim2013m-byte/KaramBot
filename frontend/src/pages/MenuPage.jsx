import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2, ToggleLeft, ToggleRight, X } from 'lucide-react';

function ItemModal({ item, categories, onSave, onClose }) {
  const [form, setForm] = useState(item || { name_ar: '', name_en: '', price: '', description_ar: '', category_id: '', active: true, available: true });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name_ar || !form.price || !form.category_id) return alert('يرجى ملء الحقول المطلوبة');
    setSaving(true);
    try {
      if (item?._id) {
        await api.patch(`/menu/items/${item._id}`, form);
      } else {
        await api.post('/menu/items', form);
      }
      onSave();
    } catch (err) {
      alert(err.response?.data?.error || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h3 className="font-semibold text-gray-800">{item?._id ? 'تعديل صنف' : 'إضافة صنف'}</h3>
          <button onClick={onClose}><X size={18} className="text-gray-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-sm text-gray-600 mb-1">الاسم بالعربي *</label>
            <input value={form.name_ar} onChange={e => setForm(f => ({ ...f, name_ar: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">الاسم بالإنجليزي</label>
            <input value={form.name_en || ''} onChange={e => setForm(f => ({ ...f, name_en: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">السعر (JOD) *</label>
            <input type="number" step="0.1" min="0" value={form.price} onChange={e => setForm(f => ({ ...f, price: parseFloat(e.target.value) }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">الفئة *</label>
            <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">اختر فئة</option>
              {categories.map(c => <option key={c._id} value={c._id}>{c.name_ar}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">الوصف</label>
            <textarea rows={2} value={form.description_ar || ''} onChange={e => setForm(f => ({ ...f, description_ar: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none resize-none" />
          </div>
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
              نشط
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <input type="checkbox" checked={form.available} onChange={e => setForm(f => ({ ...f, available: e.target.checked }))} />
              متاح
            </label>
          </div>
        </div>
        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm disabled:opacity-50">
            {saving ? 'جاري الحفظ...' : 'حفظ'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MenuPage() {
  const [menu, setMenu] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | 'add' | item obj
  const [categories, setCategories] = useState([]);

  const load = async () => {
    setLoading(true);
    const [menuRes, catRes] = await Promise.all([api.get('/menu/full'), api.get('/menu/categories')]);
    setMenu(menuRes.data.menu || []);
    setCategories(catRes.data.categories || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const deleteItem = async (id) => {
    if (!confirm('تأكيد حذف الصنف؟')) return;
    await api.delete(`/menu/items/${id}`);
    load();
  };

  const toggleAvailable = async (item) => {
    await api.patch(`/menu/items/${item._id}`, { available: !item.available });
    load();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">القائمة</h1>
        <button
          onClick={() => setModal('add')}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600"
        >
          <Plus size={16} />
          إضافة صنف
        </button>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}

      <div className="space-y-5">
        {menu.map(cat => (
          <div key={cat._id} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 font-semibold text-gray-700 text-sm border-b border-gray-100">
              {cat.name_ar}
              <span className="text-gray-400 font-normal mr-2">({cat.items?.length})</span>
            </div>
            {cat.items?.length === 0 && (
              <div className="text-center py-6 text-gray-300 text-sm">لا يوجد أصناف في هذه الفئة</div>
            )}
            {cat.items?.map(item => (
              <div key={item._id} className="flex items-center justify-between px-4 py-3 border-b border-gray-50 last:border-0 hover:bg-gray-50">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-gray-800">{item.name_ar}</span>
                    {!item.available && <span className="text-xs bg-red-100 text-red-500 px-1.5 py-0.5 rounded">غير متاح</span>}
                    {!item.active && <span className="text-xs bg-gray-100 text-gray-500 px-1.5 py-0.5 rounded">مخفي</span>}
                  </div>
                  {item.description_ar && <div className="text-xs text-gray-400 mt-0.5">{item.description_ar}</div>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold text-green-600">{Number(item.price).toFixed(2)} JOD</span>
                  <button onClick={() => toggleAvailable(item)} title={item.available ? 'إخفاء' : 'إظهار'}>
                    {item.available
                      ? <ToggleRight size={20} className="text-green-500" />
                      : <ToggleLeft size={20} className="text-gray-300" />}
                  </button>
                  <button onClick={() => setModal(item)} className="text-gray-400 hover:text-blue-500">
                    <Edit2 size={15} />
                  </button>
                  <button onClick={() => deleteItem(item._id)} className="text-gray-400 hover:text-red-500">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {modal && (
        <ItemModal
          item={modal === 'add' ? null : modal}
          categories={categories}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
