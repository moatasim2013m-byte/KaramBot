/**
 * Which door this page was opened on (the server's twin is backend/src/config/surfaces.js).
 *
 * SHIFT — the platform admin and SHIFT's own shop team — works on karambots.com; customer shops
 * on app.shifts-ai.com. Same app on both; only who signs in where differs. On any other host
 * (localhost, a preview) the door is unknown and nothing is redirected.
 */

const trim = (v) => String(v || '').trim().replace(/\/+$/, '');

export const OPERATOR_ORIGIN = trim(import.meta.env.VITE_OPERATOR_ORIGIN) || 'https://karambots.com';
export const APP_ORIGIN = trim(import.meta.env.VITE_APP_ORIGIN) || 'https://app.shifts-ai.com';

const hostOf = (origin) => origin.replace(/^https?:\/\//, '').toLowerCase();
const OPERATOR_HOSTS = [hostOf(OPERATOR_ORIGIN), `www.${hostOf(OPERATOR_ORIGIN)}`];
const CUSTOMER_HOSTS = [hostOf(APP_ORIGIN), 'app.shifts-ai.store'];

/** 'operator' | 'customer' | null */
export function currentSurface(host = typeof window !== 'undefined' ? window.location.hostname : '') {
  const h = String(host || '').toLowerCase();
  if (OPERATOR_HOSTS.includes(h)) return 'operator';
  if (CUSTOMER_HOSTS.includes(h)) return 'customer';
  return null;
}

/** Leave for the other door, keeping the path, query and #fragment (a /join#token survives). */
export function goToOrigin(origin, path) {
  const { pathname, search, hash } = window.location;
  window.location.replace(`${origin}${path ?? `${pathname}${search}${hash}`}`);
}

/** The server said this account belongs on the other door: sign out here and go there. */
export function isWrongSurface(err) {
  return err?.response?.data?.code === 'WRONG_SURFACE' && Boolean(err.response.data.home_url);
}
