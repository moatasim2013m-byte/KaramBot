import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  // The token arrives in the fragment (…/activate#token). Browsers never transmit a fragment,
  // so it appears in no access log — read it once, before anything can rewrite the URL.
  const [token] = useState(() => window.location.hash.replace(/^#/, ''));
  const navigate = useNavigate();
  const { setSession } = useAuth();

  const [invite, setInvite] = useState(null);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) { setError('الرابط غير مكتمل. اطلب رابطًا جديدًا من شِفت.'); setChecking(false); return; }
    api.post('/auth/activate/lookup', { token })
      .then((res) => {
        // A shop owner's link belongs to the join wizard (password, then WhatsApp, then the bot);
        // this page stays for staff and managers. Older owner links pointing here still work.
        if (res.data?.role === 'business_owner') {
          navigate(`/join#${token}`, { replace: true });
          return;
        }
        setInvite({ ...res.data, business_name: res.data?.shop_name || res.data?.business_name });
      })
      .catch(() => setError('الرابط غير صالح أو انتهت صلاحيته. اطلب رابطًا جديدًا من شِفت.'))
      .finally(() => setChecking(false));
  }, [token, navigate]);

  const submit = async (e) => {
    e.preventDefault();
    if (password !== confirm) return setError('كلمتا المرور غير متطابقتين');
    if (password.length < 10) return setError('كلمة المرور يجب أن تكون 10 أحرف على الأقل');

    setBusy(true); setError(null);
    try {
      const res = await api.post('/auth/activate', { token, password });
      // Clear the fragment before navigating, so the token does not sit in the address bar or
      // the browser's history for the next person at that screen.
      window.history.replaceState(null, '', '/activate');
      setSession?.(res.data.token, res.data.user);
      // Staff work in the conversations; owners and managers start on the overview.
      navigate(res.data.user?.role === 'staff' ? '/inbox' : '/overview', { replace: true });
    } catch (err) {
      setError(err.response?.data?.error || 'تعذّر تفعيل الحساب');
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4" dir="rtl">
      <div className="w-full max-w-sm">
        <div className="text-center mb-6">
          <div className="text-xl font-bold text-gray-900">كرم بوت — من شِفت</div>
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
              {/* The shop's name first: it is what the owner recognises. The email stays, smaller,
                  because it is still what they sign in with. */}
              <div className="pb-3 border-b border-gray-100">
                {invite.business_name && (
                  <p className="text-base font-semibold text-gray-900">{invite.business_name}</p>
                )}
                <p className={invite.business_name ? 'text-sm text-gray-700 mt-0.5' : 'text-sm font-medium text-gray-900'}>
                  أهلًا {invite.name}
                </p>
                {/* An owner made with a mobile signs in with it (Migration 2); the server sends it
                    masked, so a leaked link does not hand out the number. */}
                {invite.phone_masked && (
                  <p className="text-xs text-gray-500 mt-1">
                    الدخول برقم الموبايل: <span dir="ltr">{invite.phone_masked}</span>
                  </p>
                )}
                {invite.email && (
                  <p className="text-xs text-gray-500 mt-1">
                    الدخول بالبريد: <span dir="ltr">{invite.email}</span>
                  </p>
                )}
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
                أنت وحدك تختار كلمة مرورك
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
