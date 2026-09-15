'use strict';

/**
 * Google Calendar for SHIFT sales calls (PR3 design §Infrastructure, §Flow 2).
 *
 * Keyless: the service account karambot-calendar@… has no key. The Cloud Run runtime service account holds
 * roles/iam.serviceAccountTokenCreator on it, so a calendar-scoped token is minted in two hops:
 *   1. the runtime's own token from the metadata server (only reachable inside Google Cloud);
 *   2. IAM Credentials `generateAccessToken` for CALENDAR_SA_EMAIL, authorised by that token.
 * The minted token is cached until 5 minutes before it expires. Local development can skip both hops with
 * GOOGLE_CALENDAR_ACCESS_TOKEN (e.g. `gcloud auth print-access-token --impersonate-service-account=…`).
 *
 * Plain axios (no googleapis dependency). Every function resolves to a result object and never throws, so
 * the booking flow can fall back to the PR2 "call request" whenever the calendar is unreachable. Errors are
 * classified as auth | notFound | conflict | rate | network | invalid | server.
 */

const axios = require('axios');

const METADATA_TOKEN_URL = 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token';
const IAM_BASE = 'https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts';
const CALENDAR_BASE = 'https://www.googleapis.com/calendar/v3';
const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar';
const DEFAULT_SA_EMAIL = 'karambot-calendar@karam-bot.iam.gserviceaccount.com';
const TOKEN_LIFETIME = '3600s';
// A token this close to its expiry is not used: a booking can take several calls.
const REFRESH_MARGIN_MS = 5 * 60 * 1000;
const METADATA_TIMEOUT_MS = 3000;
const IAM_TIMEOUT_MS = 5000;
const CALENDAR_TIMEOUT_MS = 8000;

let cached = null; // { token, expiresAtMs, sa }
let inFlight = null;

function saEmail(env = process.env) {
  return (env.CALENDAR_SA_EMAIL || '').trim() || DEFAULT_SA_EMAIL;
}

function nowMs(now) {
  if (now instanceof Date) return now.getTime();
  if (typeof now === 'number') return now;
  return Date.now();
}

/**
 * Map an axios error (or a response status) to a kind the booking flow can act on.
 * conflict = 409 (a client event id that already exists); notFound = 404/410 (calendar not shared, event gone).
 */
function classifyError(err) {
  const status = err?.response?.status ?? null;
  const data = err?.response?.data;
  const message = data?.error?.message || data?.error_description || err?.message || 'request failed';
  const reason = Array.isArray(data?.error?.errors) && data.error.errors[0] ? data.error.errors[0].reason : null;
  const out = (kind) => ({ kind, status, reason, message: String(message).slice(0, 300) });
  if (status === 409) return out('conflict');
  if (status === 404 || status === 410) return out('notFound');
  if (status === 401) return out('auth');
  if (status === 403) {
    // Calendar reports quota exhaustion as 403 with a rate reason; everything else is a permission problem.
    return /rateLimitExceeded|userRateLimitExceeded|quotaExceeded/i.test(reason || '') ? out('rate') : out('auth');
  }
  if (status === 429) return out('rate');
  if (status !== null && status >= 500) return out('server');
  if (status !== null && status >= 400) return out('invalid');
  return out('network');
}

function fail(err, where) {
  const e = err && err.kind ? err : classifyError(err);
  console.error(`[calendar] ${where} failed kind=${e.kind} status=${e.status}: ${e.message}`);
  return { ok: false, error: e };
}

async function mintToken(sa) {
  const meta = await axios.get(METADATA_TOKEN_URL, {
    headers: { 'Metadata-Flavor': 'Google' },
    timeout: METADATA_TIMEOUT_MS,
  });
  const runtimeToken = meta?.data?.access_token;
  if (!runtimeToken) throw Object.assign(new Error('metadata server returned no access_token'), { kind: 'auth' });
  const res = await axios.post(`${IAM_BASE}/${encodeURIComponent(sa)}:generateAccessToken`,
    { scope: [CALENDAR_SCOPE], lifetime: TOKEN_LIFETIME },
    { headers: { Authorization: `Bearer ${runtimeToken}`, 'Content-Type': 'application/json' }, timeout: IAM_TIMEOUT_MS });
  const token = res?.data?.accessToken;
  const expireTime = Date.parse(res?.data?.expireTime || '');
  if (!token) throw Object.assign(new Error('generateAccessToken returned no accessToken'), { kind: 'auth' });
  return { token, expiresAtMs: Number.isFinite(expireTime) ? expireTime : Date.now() + 3600 * 1000, sa };
}

/**
 * A calendar-scoped access token. Resolves to {ok, token} or {ok:false, error}; never throws.
 * Concurrent callers share one mint.
 */
async function getAccessToken({ now, env = process.env } = {}) {
  const local = (env.GOOGLE_CALENDAR_ACCESS_TOKEN || '').trim();
  if (local) return { ok: true, token: local, source: 'env' };
  const sa = saEmail(env);
  const t = nowMs(now);
  if (cached && cached.sa === sa && cached.expiresAtMs - REFRESH_MARGIN_MS > t) {
    return { ok: true, token: cached.token, source: 'cache' };
  }
  if (!inFlight) {
    inFlight = mintToken(sa)
      .then((minted) => {
        cached = minted;
        return minted;
      })
      .finally(() => { inFlight = null; });
  }
  try {
    const minted = await inFlight;
    return { ok: true, token: minted.token, source: 'minted' };
  } catch (err) {
    return fail(err.kind ? { kind: err.kind, status: null, reason: null, message: err.message } : err, 'token');
  }
}

function resetTokenCache() {
  cached = null;
  inFlight = null;
}

async function authorised(where, now, fn) {
  const auth = await getAccessToken({ now });
  if (!auth.ok) return auth;
  try {
    return await fn({ Authorization: `Bearer ${auth.token}`, 'Content-Type': 'application/json' });
  } catch (err) {
    // A token revoked or expired early: forget it so the next call mints a fresh one.
    if (err?.response?.status === 401) cached = null;
    return fail(err, where);
  }
}

function calendarPath(calendarId) {
  return `${CALENDAR_BASE}/calendars/${encodeURIComponent(calendarId)}`;
}

/**
 * Busy intervals of every calendar in [timeMin, timeMax). A calendar Google cannot read (not shared, wrong
 * id) makes the whole answer unusable: a slot that looks free there may not be. Resolves to
 * {ok, busy: [{start: Date, end: Date}]} or {ok:false, error}.
 */
async function freeBusy({ timeMin, timeMax, calendarIds, timeZone = 'Asia/Amman', now } = {}) {
  const ids = (Array.isArray(calendarIds) ? calendarIds : []).filter((id) => typeof id === 'string' && id.trim());
  if (!ids.length) return { ok: false, error: { kind: 'invalid', status: null, reason: null, message: 'no calendars' } };
  return authorised('freeBusy', now, async (headers) => {
    const res = await axios.post(`${CALENDAR_BASE}/freeBusy`, {
      timeMin: new Date(timeMin).toISOString(),
      timeMax: new Date(timeMax).toISOString(),
      timeZone,
      items: ids.map((id) => ({ id })),
    }, { headers, timeout: CALENDAR_TIMEOUT_MS });
    const calendars = (res && res.data && res.data.calendars) || {};
    const busy = [];
    for (const id of ids) {
      const cal = calendars[id];
      if (!cal) return fail({ kind: 'notFound', status: null, reason: 'missing', message: `calendar ${id} missing from freeBusy` }, 'freeBusy');
      if (Array.isArray(cal.errors) && cal.errors.length) {
        const reason = cal.errors[0].reason || 'error';
        return fail({ kind: reason === 'notFound' ? 'notFound' : 'server', status: null, reason, message: `calendar ${id}: ${reason}` }, 'freeBusy');
      }
      for (const b of Array.isArray(cal.busy) ? cal.busy : []) {
        const start = new Date(b.start);
        const end = new Date(b.end);
        if (!Number.isNaN(start.getTime()) && !Number.isNaN(end.getTime()) && end > start) busy.push({ start, end });
      }
    }
    busy.sort((a, b) => a.start - b.start);
    return { ok: true, busy };
  });
}

async function getEvent(calendarId, eventId, { now } = {}) {
  return authorised('getEvent', now, async (headers) => {
    const res = await axios.get(`${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`, { headers, timeout: CALENDAR_TIMEOUT_MS });
    return { ok: true, event: res.data };
  });
}

/**
 * Insert with a client-supplied id. Google answers 409 when that id exists: a retry of the same booking
 * (the id is derived from the booking), which counts as booked — unless the existing event was cancelled
 * (deleted events keep their id), which is a conflict. Resolves to {ok, event, existed} or {ok:false, error}.
 */
async function insertEvent(calendarId, event, { now } = {}) {
  const result = await authorised('insertEvent', now, async (headers) => {
    const res = await axios.post(`${calendarPath(calendarId)}/events`, event, {
      headers, timeout: CALENDAR_TIMEOUT_MS, params: { sendUpdates: 'none' },
    });
    return { ok: true, event: res.data, existed: false };
  });
  if (result.ok || result.error.kind !== 'conflict' || !event || !event.id) return result;
  const existing = await getEvent(calendarId, event.id, { now });
  if (!existing.ok) return { ok: false, error: result.error };
  if (existing.event && existing.event.status === 'cancelled') {
    return { ok: false, error: { kind: 'conflict', status: 409, reason: 'cancelled', message: 'event id belongs to a cancelled event' } };
  }
  return { ok: true, event: existing.event, existed: true };
}

async function patchEvent(calendarId, eventId, patch, { now } = {}) {
  return authorised('patchEvent', now, async (headers) => {
    const res = await axios.patch(`${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`, patch, {
      headers, timeout: CALENDAR_TIMEOUT_MS, params: { sendUpdates: 'none' },
    });
    return { ok: true, event: res.data };
  });
}

/** Delete; an event that is already gone (404/410) counts as deleted. */
async function deleteEvent(calendarId, eventId, { now } = {}) {
  const result = await authorised('deleteEvent', now, async (headers) => {
    await axios.delete(`${calendarPath(calendarId)}/events/${encodeURIComponent(eventId)}`, {
      headers, timeout: CALENDAR_TIMEOUT_MS, params: { sendUpdates: 'none' },
    });
    return { ok: true, alreadyGone: false };
  });
  if (!result.ok && result.error.kind === 'notFound') return { ok: true, alreadyGone: true };
  return result;
}

module.exports = {
  METADATA_TOKEN_URL,
  IAM_BASE,
  CALENDAR_BASE,
  CALENDAR_SCOPE,
  DEFAULT_SA_EMAIL,
  REFRESH_MARGIN_MS,
  saEmail,
  classifyError,
  getAccessToken,
  resetTokenCache,
  freeBusy,
  getEvent,
  insertEvent,
  patchEvent,
  deleteEvent,
};
