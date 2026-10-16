/**
 * The two doors.
 *
 * SHIFT (the platform admin and SHIFT's own shop team) signs in at karambots.com and sees only the
 * console (/admin, with SHIFT's own sales-bot inbox inside it). Customer shops sign in at
 * app.shifts-ai.com and see only the shop panel. Both are served by the same Cloud Run service;
 * the split is about who uses which address and what each address shows, so a shop owner never
 * sees SHIFT's login or console and SHIFT's team never works in customer-panel screens.
 *
 * Which door a request came through: the browser's Origin header first (sent on every POST, and
 * a page cannot change it), then X-Forwarded-Host (app.shifts-ai.com reaches Cloud Run through
 * Firebase Hosting, which rewrites Host to the run.app address), then Host (karambots.com is
 * mapped to Cloud Run directly). Anything else — run.app, localhost, tests, webhooks — is null and
 * nothing is enforced, so a door that cannot be told apart never locks anyone out.
 */

const trimOrigin = (v) => String(v || '').trim().replace(/\/+$/, '');

const OPERATOR_ORIGIN = trimOrigin(process.env.OPERATOR_ORIGIN) || 'https://karambots.com';
const APP_ORIGIN = trimOrigin(process.env.APP_ORIGIN) || 'https://app.shifts-ai.com';

const hostOf = (origin) => origin.replace(/^https?:\/\//, '').toLowerCase();

const OPERATOR_HOSTS = new Set([hostOf(OPERATOR_ORIGIN), `www.${hostOf(OPERATOR_ORIGIN)}`]);
// The .store address still forwards to the .com one; a page opened before the switch may post from it.
const CUSTOMER_HOSTS = new Set([hostOf(APP_ORIGIN), 'app.shifts-ai.store']);

function headerHost(value) {
  const first = String(value || '').split(',')[0].trim().toLowerCase();
  if (!first) return '';
  return first.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

function classify(host) {
  if (!host) return null;
  if (OPERATOR_HOSTS.has(host)) return 'operator';
  if (CUSTOMER_HOSTS.has(host)) return 'customer';
  return null;
}

/** 'operator' | 'customer' | null for the door this request came through. */
function surfaceOf(req) {
  const h = req.headers || {};
  return classify(headerHost(h.origin))
    || classify(headerHost(h['x-forwarded-host']))
    || classify(headerHost(h.host));
}

/** The door an account belongs to: SHIFT's admins and SHIFT's own shop team use the operator one. */
function homeSurface({ role, business_type: businessType } = {}) {
  return role === 'platform_admin' || businessType === 'shift' ? 'operator' : 'customer';
}

function originFor(surface) {
  return surface === 'operator' ? OPERATOR_ORIGIN : APP_ORIGIN;
}

/** Where a shop's invite and activation links open: SHIFT's own shop on karambots.com, every other on the app. */
function originForBusinessType(businessType) {
  return businessType === 'shift' ? OPERATOR_ORIGIN : APP_ORIGIN;
}

const WRONG_SURFACE_AR = {
  operator: 'حسابات فريق شِفت تدخل من karambots.com — سننقلك إليه.',
  customer: 'حسابات المحلات تدخل من app.shifts-ai.com — سننقلك إليه.',
};

/**
 * null when the request may go on; otherwise the body to answer with. The client sends the person
 * to `home_url` (and signs out of this door), which is the whole fix for a wrong-door session.
 */
function wrongSurface(req, user) {
  const here = surfaceOf(req);
  if (!here) return null;
  const home = homeSurface(user);
  if (here === home) return null;
  return { error: WRONG_SURFACE_AR[home], code: 'WRONG_SURFACE', home_url: `${originFor(home)}/login` };
}

module.exports = {
  OPERATOR_ORIGIN, APP_ORIGIN, surfaceOf, homeSurface, originFor, originForBusinessType, wrongSurface,
};
