import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ login: '', password: '' });
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [forgot, setForgot] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await login(form.login, form.password);
      // Each role lands where its work is: SHIFT on the platform, staff in the conversations,
      // owners and managers on the overview.
      const role = data?.user?.role;
      navigate(role === 'platform_admin' ? '/admin/overview' : role === 'staff' ? '/inbox' : '/overview');
    } catch (err) {
      setError(err.response?.data?.error || 'حدث خطأ، يرجى المحاولة مجدداً');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-green-500 rounded-2xl mb-4">
            <MessageSquare size={32} className="text-white" />
          </div>
          <h1 className="text-white text-2xl font-bold">كرم بوت — من شِفت</h1>
          <p className="text-gray-400 text-sm mt-1">لوحة المحل</p>
        </div>

        {/* Form */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-gray-800 text-xl font-bold mb-6 text-center">تسجيل الدخول</h2>

          {error && (
            <div className="bg-red-50 text-red-600 text-sm px-4 py-3 rounded-lg mb-4 text-center">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">رقم الموبايل أو البريد الإلكتروني</label>
              {/* type text, not email: an owner types «079…» here, which an email field rejects. */}
              <input
                type="text"
                inputMode="email"
                autoComplete="username"
                value={form.login}
                onChange={e => setForm(f => ({ ...f, login: e.target.value }))}
                className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                placeholder="07XXXXXXXX"
                required
                dir="ltr"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">كلمة المرور</label>
              <div className="relative">
                <input
                  type={showPass ? 'text' : 'password'}
                  value={form.password}
                  onChange={e => setForm(f => ({ ...f, password: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  placeholder="••••••••"
                  required
                  dir="ltr"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-green-500 hover:bg-green-600 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition-colors"
            >
              {loading ? 'جاري الدخول...' : 'دخول'}
            </button>
          </form>

          {/* No email reset: most owners sign in with a mobile and no OTP exists yet. SHIFT sends a
              new link instead, through «إعادة ضبط الدخول», which is audited. */}
          <div className="mt-5 text-center">
            {!forgot ? (
              <button type="button" onClick={() => setForgot(true)} className="text-sm text-gray-500 hover:text-gray-800 underline underline-offset-2">
                نسيت كلمة المرور؟
              </button>
            ) : (
              <div className="rounded-lg bg-gray-50 p-3 text-sm text-gray-700">
                <p>راسل شِفت على واتساب ونرسل لك رابطًا جديدًا.</p>
                <a
                  href={`https://wa.me/962776788972?text=${encodeURIComponent(`مرحبًا، نسيت كلمة مرور كرم بوت${form.login ? ` (الدخول: ${form.login})` : ''}. أرجو رابطًا جديدًا.`)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-flex items-center justify-center w-full h-10 rounded-lg bg-green-500 hover:bg-green-600 text-white font-medium"
                >
                  راسل شِفت على واتساب
                </a>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
