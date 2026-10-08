import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../utils/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('user')); } catch { return null; }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      // /me answers with business_name too (the brand line «كرم بوت · {اسم المحل}»), and the
      // stored copy is refreshed so a reload before /me returns already shows the right name.
      api.get('/auth/me')
        .then(res => {
          setUser(res.data);
          try { localStorage.setItem('user', JSON.stringify(res.data)); } catch { /* storage full or blocked */ }
        })
        .catch(() => { localStorage.removeItem('token'); localStorage.removeItem('user'); })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    localStorage.setItem('token', res.data.token);
    localStorage.setItem('user', JSON.stringify(res.data.user));
    setUser(res.data.user);
    return res.data;
  };

  /**
   * Adopt a session minted somewhere other than the login form — today, activation, where the
   * customer has just chosen a password and should not be asked for it again immediately. The
   * server sends the full user (role, business_type, business_name), the same shape as login.
   */
  const setSession = (token, nextUser) => {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(nextUser));
    setUser(nextUser);
  };

  const logout = () => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, setSession }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
