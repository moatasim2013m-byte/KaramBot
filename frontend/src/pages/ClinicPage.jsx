import React, { useEffect, useState } from 'react';
import api from '../utils/api';
import { Plus, Edit2, Trash2, X, Calendar, User, Stethoscope, Clock } from 'lucide-react';

const STATUS_AR = {
  draft: 'مسودة',
  confirmed: 'مؤكد',
  completed: 'منتهي',
  cancelled: 'ملغى',
  no_show: 'لم يحضر',
};

const STATUS_COLOR = {
  confirmed: 'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
  cancelled: 'bg-red-100 text-red-600',
  no_show: 'bg-yellow-100 text-yellow-700',
  draft: 'bg-blue-100 text-blue-700',
};

// ── Service Modal ──────────────────────────────────────────────────────────────
function ServiceModal({ service, onSave, onClose }) {
  const [form, setForm] = useState(service || { name_ar: '', name_en: '', duration_minutes: 30, price: '', active: true });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name_ar) return alert('الاسم بالعربي مطلوب');
    setSaving(true);
    try {
      if (service?.id) {
        await api.patch(`/clinic/services/${service.id}`, form);
      } else {
        await api.post('/clinic/services', form);
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
          <h3 className="font-semibold text-gray-800">{service?.id ? 'تعديل خدمة' : 'إضافة خدمة'}</h3>
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">المدة (دقيقة)</label>
            <input type="number" min="5" step="5" value={form.duration_minutes}
              onChange={e => setForm(f => ({ ...f, duration_minutes: parseInt(e.target.value) }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">السعر (JOD)</label>
            <input type="number" step="0.5" min="0" value={form.price || ''}
              onChange={e => setForm(f => ({ ...f, price: e.target.value ? parseFloat(e.target.value) : null }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            نشط
          </label>
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

// ── Doctor Modal ───────────────────────────────────────────────────────────────
function DoctorModal({ doctor, onSave, onClose }) {
  const [form, setForm] = useState(doctor || { name_ar: '', name_en: '', specialty_ar: '', active: true });
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name_ar) return alert('اسم الطبيب بالعربي مطلوب');
    setSaving(true);
    try {
      if (doctor?.id) {
        await api.patch(`/clinic/doctors/${doctor.id}`, form);
      } else {
        await api.post('/clinic/doctors', form);
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
          <h3 className="font-semibold text-gray-800">{doctor?.id ? 'تعديل طبيب' : 'إضافة طبيب'}</h3>
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
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" dir="ltr" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">التخصص</label>
            <input value={form.specialty_ar || ''} onChange={e => setForm(f => ({ ...f, specialty_ar: e.target.value }))}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none" />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input type="checkbox" checked={form.active} onChange={e => setForm(f => ({ ...f, active: e.target.checked }))} />
            نشط
          </label>
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

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ClinicPage() {
  const [tab, setTab] = useState('appointments'); // appointments | services | doctors
  const [appointments, setAppointments] = useState([]);
  const [services, setServices] = useState([]);
  const [doctors, setDoctors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null); // null | { type: 'service'|'doctor', item }
  const [statusFilter, setStatusFilter] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [apptRes, svcRes, docRes] = await Promise.all([
        api.get('/clinic/appointments', { params: statusFilter ? { status: statusFilter } : {} }),
        api.get('/clinic/services'),
        api.get('/clinic/doctors'),
      ]);
      setAppointments(apptRes.data.appointments || []);
      setServices(svcRes.data.services || []);
      setDoctors(docRes.data.doctors || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [statusFilter]);

  const updateAppointmentStatus = async (id, status) => {
    await api.patch(`/clinic/appointments/${id}`, { status });
    load();
  };

  const deleteService = async (id) => {
    if (!confirm('تأكيد حذف الخدمة؟')) return;
    await api.delete(`/clinic/services/${id}`);
    load();
  };

  const deleteDoctor = async (id) => {
    if (!confirm('تأكيد حذف الطبيب؟')) return;
    await api.delete(`/clinic/doctors/${id}`);
    load();
  };

  const TAB_STYLE = (t) => `px-4 py-2 text-sm font-medium rounded-lg transition-colors ${tab === t ? 'bg-green-500 text-white' : 'text-gray-600 hover:bg-gray-100'}`;

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">العيادة</h1>
        <div className="flex items-center gap-2">
          {tab === 'services' && (
            <button onClick={() => setModal({ type: 'service', item: null })}
              className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600">
              <Plus size={16} /> إضافة خدمة
            </button>
          )}
          {tab === 'doctors' && (
            <button onClick={() => setModal({ type: 'doctor', item: null })}
              className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600">
              <Plus size={16} /> إضافة طبيب
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-5 bg-gray-50 p-1 rounded-xl w-fit">
        <button className={TAB_STYLE('appointments')} onClick={() => setTab('appointments')}>
          <Calendar size={14} className="inline ml-1" /> المواعيد
        </button>
        <button className={TAB_STYLE('services')} onClick={() => setTab('services')}>
          <Stethoscope size={14} className="inline ml-1" /> الخدمات
        </button>
        <button className={TAB_STYLE('doctors')} onClick={() => setTab('doctors')}>
          <User size={14} className="inline ml-1" /> الأطباء
        </button>
      </div>

      {loading && <div className="text-center py-12 text-gray-400">جاري التحميل...</div>}

      {/* Appointments Tab */}
      {tab === 'appointments' && !loading && (
        <div>
          <div className="mb-4">
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none">
              <option value="">كل المواعيد</option>
              {Object.entries(STATUS_AR).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </div>
          <div className="space-y-3">
            {appointments.map(appt => (
              <div key={appt.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm text-gray-800">{appt.customer_name || appt.customer_wa_id || '—'}</div>
                    <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-3">
                      {appt.service && <span><Stethoscope size={10} className="inline ml-1" />{appt.service.name_ar}</span>}
                      {appt.doctor && <span><User size={10} className="inline ml-1" />{appt.doctor.name_ar}</span>}
                      {appt.scheduled_at && (
                        <span><Clock size={10} className="inline ml-1" />
                          {new Date(appt.scheduled_at).toLocaleString('ar-JO', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${STATUS_COLOR[appt.status] || 'bg-gray-100 text-gray-600'}`}>
                    {STATUS_AR[appt.status] || appt.status}
                  </span>
                </div>
                {appt.notes && <div className="text-xs text-gray-500 mt-1">📝 {appt.notes}</div>}
                {appt.status === 'confirmed' && (
                  <div className="flex gap-2 mt-2">
                    <button onClick={() => updateAppointmentStatus(appt.id, 'completed')}
                      className="text-xs bg-green-50 text-green-600 px-3 py-1.5 rounded-lg hover:bg-green-100">
                      منتهي
                    </button>
                    <button onClick={() => updateAppointmentStatus(appt.id, 'no_show')}
                      className="text-xs bg-yellow-50 text-yellow-700 px-3 py-1.5 rounded-lg hover:bg-yellow-100">
                      لم يحضر
                    </button>
                    <button onClick={() => updateAppointmentStatus(appt.id, 'cancelled')}
                      className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-lg hover:bg-red-100">
                      إلغاء
                    </button>
                  </div>
                )}
              </div>
            ))}
            {appointments.length === 0 && (
              <div className="text-center py-12 text-gray-400">لا توجد مواعيد</div>
            )}
          </div>
        </div>
      )}

      {/* Services Tab */}
      {tab === 'services' && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {services.length === 0 && (
            <div className="text-center py-12 text-gray-400">لا توجد خدمات</div>
          )}
          {services.map((svc, i) => (
            <div key={svc.id} className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 ${i < services.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div>
                <div className="font-medium text-sm text-gray-800">{svc.name_ar}</div>
                <div className="text-xs text-gray-400 mt-0.5">
                  <Clock size={10} className="inline ml-1" />{svc.duration_minutes} دقيقة
                  {svc.price != null && ` · ${parseFloat(svc.price).toFixed(2)} JOD`}
                  {!svc.active && <span className="mr-2 text-red-400">معطل</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setModal({ type: 'service', item: svc })} className="text-gray-400 hover:text-blue-500">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => deleteService(svc.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Doctors Tab */}
      {tab === 'doctors' && !loading && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {doctors.length === 0 && (
            <div className="text-center py-12 text-gray-400">لا يوجد أطباء</div>
          )}
          {doctors.map((doc, i) => (
            <div key={doc.id} className={`flex items-center justify-between px-4 py-3 hover:bg-gray-50 ${i < doctors.length - 1 ? 'border-b border-gray-50' : ''}`}>
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                  {doc.name_ar?.[0] || 'د'}
                </div>
                <div>
                  <div className="font-medium text-sm text-gray-800">د. {doc.name_ar}</div>
                  {doc.specialty_ar && <div className="text-xs text-gray-400">{doc.specialty_ar}</div>}
                  {!doc.active && <span className="text-xs text-red-400">معطل</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => setModal({ type: 'doctor', item: doc })} className="text-gray-400 hover:text-blue-500">
                  <Edit2 size={15} />
                </button>
                <button onClick={() => deleteDoctor(doc.id)} className="text-gray-400 hover:text-red-500">
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      {modal?.type === 'service' && (
        <ServiceModal
          service={modal.item}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.type === 'doctor' && (
        <DoctorModal
          doctor={modal.item}
          onSave={() => { setModal(null); load(); }}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
