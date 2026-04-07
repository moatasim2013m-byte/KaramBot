import { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
import axios from 'axios';

const AuthContext = createContext(null);

// Frontend API calls must stay same-origin so auth cookies/tokens and
// payment callback flows always resolve under the active host.
const API_BASE_URL = '/api';

const TOKEN_KEY = 'peekaboo_token';

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [token, setToken] = useState(() => {
    // Initialize from localStorage synchronously
    try {
      return localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  });

  // Create api instance
  const api = useMemo(() => {
    const instance = axios.create({
      baseURL: API_BASE_URL,
    });
    
    // Add interceptor to always use latest token from localStorage
    instance.interceptors.request.use((config) => {
      try {
        const currentToken = localStorage.getItem(TOKEN_KEY);
        if (currentToken) {
          config.headers.Authorization = `Bearer ${currentToken}`;
        }
      } catch (e) {
        console.warn('localStorage access failed:', e);
      }
      return config;
    });

    // Handle 401 responses
    instance.interceptors.response.use(
      (response) => response,
      (error) => {
        // Don't auto-logout on /auth/me failures (handled separately)
        const isAuthCheck = error.config?.url?.includes('/auth/me');
        if (error.response?.status === 401 && !isAuthCheck) {
          console.warn('401 on API call:', error.config?.url);
        }
        return Promise.reject(error);
      }
    );
    
    return instance;
  }, []);

  // Check auth on mount
  useEffect(() => {
    const checkAuth = async () => {
      let storedToken = null;
      try {
        storedToken = localStorage.getItem(TOKEN_KEY);
      } catch (e) {
        console.warn('localStorage access failed:', e);
      }

      if (!storedToken) {
        setLoading(false);
        return;
      }

      try {
        const response = await api.get('/auth/me');
        const authenticatedUser = response?.data?.user || null;

        if (authenticatedUser) {
          setUser(authenticatedUser);
          setToken(storedToken);
        } else {
          try {
            localStorage.removeItem(TOKEN_KEY);
          } catch (e) {
            console.warn('localStorage remove failed:', e);
          }
          setToken(null);
          setUser(null);
        }
      } catch (error) {
        console.warn('Auth check failed:', error.response?.status);
        // Network errors or other issues - keep token, don't force logout
      } finally {
        setLoading(false);
      }
    };

    checkAuth();
  }, [api]);

  const login = useCallback(async (email, password) => {
    const response = await api.post('/auth/login', { email, password });
    const { token: newToken, user: userData } = response.data;
    
    // Save token to localStorage first
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
    } catch (e) {
      console.error('Failed to save token:', e);
      throw new Error('فشل حفظ بيانات الجلسة');
    }
    
    // Then update state
    setToken(newToken);
    setUser(userData);
    
    return userData;
  }, [api]);

  const register = useCallback(async (name, email, password, phone = null) => {
    const response = await api.post('/auth/register', { name, email, password, phone });
    const { token: newToken, user: userData } = response.data;
    
    try {
      localStorage.setItem(TOKEN_KEY, newToken);
    } catch (e) {
      console.error('Failed to save token:', e);
      throw new Error('فشل حفظ بيانات الجلسة');
    }
    
    setToken(newToken);
    setUser(userData);
    return userData;
  }, [api]);

  const logout = useCallback(() => {
    try {
      localStorage.removeItem(TOKEN_KEY);
    } catch (e) {
      console.warn('localStorage remove failed:', e);
    }
    setToken(null);
    setUser(null);
  }, []);

  const forgotPassword = useCallback(async (email) => {
    const origin_url = window.location.origin;
    await api.post('/auth/forgot-password', { email, origin_url });
  }, [api]);

  const resendVerificationEmail = useCallback(async (email) => {
    return api.post('/auth/resend-verification', { email });
  }, [api]);

  const resetPassword = useCallback(async (resetToken, password) => {
    await api.post('/auth/reset-password', { token: resetToken, password });
  }, [api]);

  const value = useMemo(() => ({
    user,
    token,
    loading,
    login,
    register,
    logout,
    forgotPassword,
    resendVerificationEmail,
    resetPassword,
    api,
    isAdmin: user?.role === 'admin',
    isStaff: user?.role === 'staff',
    isAuthenticated: !!user
  }), [user, token, loading, login, register, logout, forgotPassword, resendVerificationEmail, resetPassword, api]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
