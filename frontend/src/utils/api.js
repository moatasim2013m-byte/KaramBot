import axios from 'axios';
import { isWrongSurface } from './surface';

const api = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
});

// Inject token
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 401, and a session on the wrong door (utils/surface)
api.interceptors.response.use(
  (res) => res,
  (err) => {
    // SHIFT signs in at karambots.com and the shops at app.shifts-ai.com. A session opened on the
    // other door is signed out here and sent home. The login form shows its own message first.
    if (isWrongSurface(err) && !String(err.config?.url || '').includes('/auth/login')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.replace(err.response.data.home_url);
      return Promise.reject(err);
    }
    if (err.response?.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;
