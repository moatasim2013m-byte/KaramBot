import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { UserPlus, ToggleLeft, ToggleRight } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

const ROLE_AR = {
  platform_admin: 'مدير النظام',
  business_owner: 'صاحب العمل',
  manager: 'مدير',
  staff: 'موظف',
};

function AddStaffModal({ onSave, onClose }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'staff' });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name || !form.email || !form.password) return alert('يرجى ملء جميع الحقول');
    setSaving(true);
    try {
      await api.post('/auth/register', form);
      onSave();
    } catch (err) {
      alert(err.response?.data?.error || 'حدث خطأ');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-sm shadow-xl p-6 space-y-4">
        <h3 className="font-semibold text-gray-800">إضافة موظف</h3>
        <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="الاسم" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-green-500" />
        <input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="البريد الإلكتروني" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
        <input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder="كلمة المرور" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
        <select value={form.role} onChange={e => setForm(f => ({ ...f, role: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
          <option value="staff">موظف</option>
          <option value="manager">مدير</option>
        </select>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 py-2 rounded-lg text-sm">إلغاء</button>
          <button onClick={handleSave} disabled={saving} className="flex-1 bg-green-500 text-white py-2 rounded-lg text-sm disabled:opacity-50">
            {saving ? 'جاري الحفظ...' : 'إضافة'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function StaffPage() {
  const { user } = useAuth();
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  const load = async () => {
    setLoading(true);
    const res = await api.get('/staff');
    setStaff(res.data.staff || []);
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const toggleActive = async (member) => {
    if (member._id === user?.id) return alert('لا يمكنك تعطيل حسابك الخاص');
    await api.patch(`/staff/${member._id}`, { active: !member.active });
    load();
  };

  const canManage = ['platform_admin', 'business_owner', 'manager'].includes(user?.role);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">الموظفون</h1>
        {canManage && (
          <button
            onClick={() => setShowModal(true)}
            className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600"
          >
            <UserPlus size={16} />
            إضافة موظف
          </button>
        )}
      </div>

      {loading && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {staff.map((member, i) => (
          <div key={member._id} className={`flex items-center justify-between px-5 py-4 ${i < staff.length - 1 ? 'border-b border-gray-50' : ''} hover:bg-gray-50`}>
            <div>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center text-green-600 text-sm font-bold">
                  {member.name?.[0] || '?'}
                </div>
                <div>
                  <div className="font-medium text-sm text-gray-800">{member.name}</div>
                  <div className="text-xs text-gray-400">{member.email}</div>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded">
                {ROLE_AR[member.role] || member.role}
              </span>
              {!member.active && <span className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded">معطل</span>}
              {canManage && member._id !== user?.id && (
                <button onClick={() => toggleActive(member)} title={member.active ? 'تعطيل' : 'تفعيل'}>
                  {member.active
                    ? <ToggleRight size={22} className="text-green-500" />
                    : <ToggleLeft size={22} className="text-gray-300" />}
                </button>
              )}
            </div>
          </div>
        ))}
        {!loading && staff.length === 0 && (
          <div className="text-center py-12 text-gray-400">لا يوجد موظفون</div>
        )}
      </div>

      {showModal && <AddStaffModal onSave={() => { setShowModal(false); load(); }} onClose={() => setShowModal(false)} />}
    </div>
  );
}
