import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../utils/api';
import { Plus, Settings2 } from 'lucide-react';

const TYPE_LABEL = { restaurant: 'مطعم', clinic: 'عيادة', generic: 'عام' };
const STATUS_BADGE = {
  active:    'bg-green-100 text-green-700',
  inactive:  'bg-gray-100 text-gray-500',
  suspended: 'bg-red-100 text-red-600',
};

function maskPhone(phone) {
  if (!phone) return '—';
  return phone.length > 4 ? '•'.repeat(phone.length - 4) + phone.slice(-4) : phone;
}

function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('ar-EG', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get('/businesses')
      .then(r => setBusinesses(r.data.businesses || []))
      .catch(e => setError(e.response?.data?.error || 'حدث خطأ في تحميل البيانات'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h1 className="text-xl font-bold text-gray-800">إدارة الأعمال</h1>
        <button
          onClick={() => navigate('/admin/businesses/new')}
          className="flex items-center gap-2 bg-green-500 text-white px-4 py-2 rounded-lg text-sm hover:bg-green-600"
        >
          <Plus size={16} />
          إضافة عمل
        </button>
      </div>

      {loading && <div className="text-center py-16 text-gray-400">جاري التحميل...</div>}
      {error   && <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mb-4">{error}</div>}

      {!loading && !error && (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          {businesses.length === 0 ? (
            <div className="text-center py-16 text-gray-400 text-sm">
              لا توجد أعمال مسجّلة بعد.{' '}
              <Link to="/admin/businesses/new" className="text-green-600 hover:underline">إضافة أول عمل</Link>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    {['الاسم', 'Slug', 'النوع', 'الحالة', 'رقم واتساب', 'تاريخ الإنشاء', ''].map(h => (
                      <th key={h} className="text-right text-xs font-semibold text-gray-500 px-4 py-3">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {businesses.map(biz => (
                    <tr key={biz.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3 font-medium text-gray-800">{biz.name}</td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs">{biz.slug}</td>
                      <td className="px-4 py-3 text-gray-600">{TYPE_LABEL[biz.business_type] || biz.business_type}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[biz.status] || 'bg-gray-100 text-gray-500'}`}>
                          {biz.status === 'active' ? 'نشط' : biz.status === 'inactive' ? 'غير نشط' : biz.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-500 font-mono text-xs ltr" dir="ltr">{maskPhone(biz.wa_phone_number_id)}</td>
                      <td className="px-4 py-3 text-gray-400 text-xs">{fmtDate(biz.created_at)}</td>
                      <td className="px-4 py-3">
                        <Link
                          to={`/admin/businesses/${biz.id}`}
                          className="inline-flex items-center gap-1 text-green-600 hover:text-green-700 text-xs font-medium"
                        >
                          <Settings2 size={13} />
                          إدارة
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
