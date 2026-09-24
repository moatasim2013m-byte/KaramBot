import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { CheckCircle2, AlertCircle } from 'lucide-react';
import api from '../utils/api';
import { useAuth } from '../context/AuthContext';

/**
 * Where a new customer sets their own password.
 *
 * Public by necessity — they have no account yet. The link is single-use and short-lived, and
 * every failure looks the same, so a leaked link cannot be used to learn which businesses exist.
 * On success they are signed straight in: someone who has just chosen a password should not
 * immediately be asked for it.
 */
export default function ActivatePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [invite, setInvite] = useState(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get(`/auth/activate/${token}`)
      .then((res) => setInvite(res.data))
      .catch(() => setError('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من شِفت.'))
      .finally(() => setChecking(false));
  }, [token]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('كلمتا المرور غير متطابقتين');
    if (password.length < 10) return setError('كلمة المرور يجب أن تكون 10 أحرف على الأقل');

    setBusy(true); setError(null);
    try {
      const res = await api.post('/auth/activate', { token, password });
      setSession?.(res.data.token, res.data.user);
      navigate('/overview', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تفعيل الحساب');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-xl font-bold text-gray-900">شِفت</div>
          <p className="text-xs text-gray-500 mt-1">فعّل حسابك واختر كلمة المرور</p>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg p-5">
          {checking ? (
            <div className="space-y-3 animate-pulse">
              <div className="h-3 bg-gray-100 rounded w-2/3" />
              <div className="h-9 bg-gray-100 rounded" />
              <div className="h-9 bg-gray-100 rounded" />
            </div>
          ) : !invite ? (
            <div className="text-center py-4">
              <AlertCircle size={22} className="text-red-500 mx-auto" />
              <p className="mt-2 text-sm text-gray-800">{error}</p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <div className="pb-3 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900">{invite.name}</p>
                <p className="text-xs text-gray-500" dir="ltr">{invite.email}</p>
              </div>

              <label className="block">
                <span className="text-[13px] text-gray-700">كلمة المرور الجديدة</span>
                <input
                  type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password" required minLength={10}
                  className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>

              <label className="block">
                <span className="text-[13px] text-gray-700">تأكيد كلمة المرور</span>
                <input
                  type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password" required
                  className="mt-1 w-full h-9 px-3 text-sm border border-gray-200 rounded-md focus:outline-none focus:ring-1 focus:ring-green-500"
                />
              </label>

              {error && <p className="text-[13px] text-red-600">{error}</p>}

              <button
                type="submit" disabled={busy}
                className="w-full h-9 bg-green-600 text-white rounded-md text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                {busy ? 'جارٍ التفعيل...' : 'تفعيل وتسجيل الدخول'}
              </button>

              <p className="text-[11px] text-gray-400 text-center pt-1">
                <CheckCircle2 size={11} className="inline ml-1" />
                لن يطّلع أحد في شِفت على كلمة مرورك
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
