'use strict';

/**
 * Coexistence: a shop's existing number keeps working in the WhatsApp Business app on the owner's
 * phone while Karam Bot answers through Cloud API (docs/panels/spec.md P5; meta-facts.md Q4a–d).
 *
 * Built, and off (decisions-2026-10-08.md #10: fresh SIMs in October). Everything here is inert
 * until SHIFT flips PlatformSetting coexistence.enabled in «إعدادات المنصة»:
 *   - the connect screen does not offer the option (routes/embeddedSignup.js config);
 *   - a FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING that arrives anyway goes to SHIFT, unregistered,
 *     exactly as before (services/embeddedSignup.js);
 *   - the three webhook fields below are logged and dropped.
 * The sweep step and the bot's «the owner is replying» check read only rows this file writes, so
 * with the switch never flipped they find nothing.
 *
 * What Meta requires of a Tech Provider once it is on (meta-facts.md Q4d):
 *   1. no /register (the app already registered the number) — embeddedSignup.runOnboarding;
 *   2. within 24 h of the onboarding, POST /{phone_number_id}/smb_app_data with sync_type
 *      'smb_app_state_sync' (contacts) and then 'history', or the business must be offboarded and
 *      redo the flow. startSync makes the calls at connect; the minute sweep retries what failed and
 *      tells SHIFT at 20 h, while there is still time to act;
 *   3. digest the webhook fields smb_message_echoes (what the owner sends from the app), history
 *      (the chats from before the connect) and smb_app_state_sync (contacts).
 *
 * The sync's progress is the account's log (AccountEvent coex_sync_started, coex_sync_done,
 * coex_sync_failed, coex_sync_late), not a new column: the log is where SHIFT already looks, and
 * P5 adds no migration. coex_sync_started is resolved when both syncs are done.
 *
 * The three payload shapes are Meta's documented examples, not recorded ones
 * (tests/fixtures/coexAssumed.js). G1, on one friendly Irbid number, records the real ones.
 */

const axios = require('axios');
const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const { decrypt } = require('../utils/tokenCrypto');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');
const platformSettings = require('./platformSettings');
const { markOutbound } = require('./lastOutbound');
const sseEmitter = require('../utils/sseEmitter');

const FEATURE_TYPE = 'whatsapp_business_app_onboarding';
// In the order Meta lists them: contacts first, then the message history.
const SYNC_TYPES = Object.freeze(['smb_app_state_sync', 'history']);
const HOUR = 60 * 60 * 1000;
// Meta's deadline, and when SHIFT hears about a sync still not done: four hours left to fix it.
const SYNC_DEADLINE_MS = 24 * HOUR;
const SYNC_ALERT_AFTER_MS = 20 * HOUR;
// A failed call is retried by the minute sweep, but not every minute: Meta's busy errors clear in
// minutes, and sixty calls an hour would only add to them.
const SYNC_RETRY_EVERY_MS = 10 * 60 * 1000;
// Past Meta's deadline a retry can still be accepted, so the sweep keeps trying a while longer;
// after this it stops and leaves the row to SHIFT (the late alert is already out).
const SYNC_GIVE_UP_MS = 72 * HOUR;
// After the owner answers a customer from the app, the bot stays quiet in that chat this long: the
// owner is in the conversation, and the bot answering underneath reads as two people talking over
// each other. Longer than the inbox's 30 minutes: a phone reply is slower and comes in bursts.
const OWNER_HOLD_MS = 2 * HOUR;
const HOLD_KEY = 'owner_app_until';

// The 14-day rule and the 20 mps limit, in the owner's words (meta-facts.md Q4c). The connect
// screen shows its own copy of the first; keep the two in step.
const NOTICE_AR = Object.freeze({
  inactivity: 'افتح واتساب للأعمال على هاتف المحل مرة كل بضعة أيام على الأقل: إذا بقي الهاتف دون استخدام نحو 14 يومًا تفصل Meta الرقم عن كرم بوت، ويلزم ربطه من جديد.',
  throughput: 'سرعة الإرسال على هذا الرقم محدودة بـ20 رسالة في الثانية، وهذا أكثر من كافٍ لمحل.',
  owner_hold: 'حين ترد على زبون من التطبيق يسكت البوت في تلك المحادثة ساعتين.',
});

function graphBase() {
  return `https://graph.facebook.com/${process.env.GRAPH_API_VERSION || 'v24.0'}`;
}

/** PlatformSetting coexistence.enabled. A failed read is «off», the safe side. */
async function isEnabled() {
  try {
    return platformSettings.isOn(await platformSettings.get('coexistence'));
  } catch (err) {
    console.error(`[coexistence] setting unreadable, treating as off: ${err.message}`);
    return false;
  }
}

// ─── The two syncs ──────────────────────────────────────────────────────────

/** POST /{phone_number_id}/smb_app_data — one sync. Throws a Graph error with `graph` attached. */
async function requestSync(phoneNumberId, token, syncType) {
  try {
    const { data } = await axios.post(
      `${graphBase()}/${phoneNumberId}/smb_app_data`,
      { messaging_product: 'whatsapp', sync_type: syncType },
      { headers: { Authorization: `Bearer ${token}` }, timeout: 15000 },
    );
    return data;
  } catch (err) {
    const meta = err.response?.data?.error;
    const clean = new Error(`smb_app_data ${syncType} failed: ${meta?.message || err.message}${meta?.code ? ` (code ${meta.code})` : ''}`);
    clean.graph = meta || null;
    throw clean;
  }
}

const logFor = (businessId) => (type, data) => accountEvents.record({ businessId, actorKind: 'system', type, data });

/** The sync events written since `started` for its number: which types are done, the last failure. */
async function progressOf(started) {
  const phone = started.data?.phone_number_id;
  const rows = await prisma.accountEvent.findMany({
    where: {
      business_id: started.business_id,
      type: { in: ['coex_sync_done', 'coex_sync_failed', 'coex_sync_late'] },
      created_at: { gte: started.created_at },
    },
    orderBy: { created_at: 'asc' },
  });
  const mine = rows.filter((r) => r.data?.phone_number_id === phone);
  const done = new Set(mine.filter((r) => r.type === 'coex_sync_done').map((r) => r.data?.sync_type));
  const failures = mine.filter((r) => r.type === 'coex_sync_failed');
  return {
    done,
    lastFailureAt: failures.length ? new Date(failures[failures.length - 1].created_at) : null,
    attempts: failures.length,
    alerted: mine.some((r) => r.type === 'coex_sync_late'),
  };
}

/** The onboarding row behind a started sync, still the shop's and still connected; else null. */
async function liveOnboarding(started) {
  const phone = started.data?.phone_number_id;
  if (!phone) return null;
  const row = await prisma.whatsappOnboarding.findUnique({ where: { phone_number_id: String(phone) } });
  if (!row || row.business_id !== started.business_id || row.revoked_at || row.detached_at) return null;
  return row;
}

/**
 * Make whichever syncs are still missing, in order, stopping at the first failure: history is
 * asked for only after the contacts, as Meta lists them. Resolves `started` when both are done.
 * Never throws; returns what it did.
 */
async function runSync(started, { now = new Date() } = {}) {
  const log = logFor(started.business_id);
  const row = await liveOnboarding(started);
  if (!row) return { ran: false, reason: 'not_connected' };
  const token = decrypt(row.access_token_enc);
  if (!token) return { ran: false, reason: 'no_token' };

  const { done } = await progressOf(started);
  const made = [];
  for (const syncType of SYNC_TYPES) {
    if (done.has(syncType)) continue;
    try {
      await requestSync(row.phone_number_id, token, syncType);
    } catch (err) {
      await log('coex_sync_failed', {
        phone_number_id: row.phone_number_id,
        sync_type: syncType,
        error_message: err.message,
        error_code: err.graph?.code ?? null,
      });
      return { ran: true, made, failed: syncType };
    }
    await log('coex_sync_done', { phone_number_id: row.phone_number_id, sync_type: syncType });
    done.add(syncType);
    made.push(syncType);
  }
  if (SYNC_TYPES.every((t) => done.has(t))) {
    await accountEvents.resolve(started.id).catch((err) => console.error(`[coexistence] resolve ${started.id}: ${err.message}`));
  }
  return { ran: true, made, complete: SYNC_TYPES.every((t) => done.has(t)), at: now };
}

/**
 * After a coexistence number is connected: write the 24-hour obligation on the account's log, then
 * make both syncs at once. Idempotent per number: a resume or a second connect of the same number
 * while one is open reuses it rather than starting a second clock. Never throws: the shop is
 * connected already, and the sweep retries whatever this did not finish.
 */
async function startSync({ businessId, onboarding, now = new Date() }) {
  try {
    if (!businessId || !onboarding?.phone_number_id) return null;
    const open = await accountEvents.list({ businessId, types: 'coex_sync_started', unresolved: true, limit: 20 });
    let started = open.find((e) => e.data?.phone_number_id === onboarding.phone_number_id);
    if (!started) {
      started = await accountEvents.record({
        businessId,
        actorKind: 'system',
        type: 'coex_sync_started',
        data: {
          phone_number_id: onboarding.phone_number_id,
          waba_id: onboarding.waba_id,
          due_by: new Date(new Date(now).getTime() + SYNC_DEADLINE_MS).toISOString(),
        },
      });
    }
    if (!started) return null;
    return await runSync(started, { now });
  } catch (err) {
    console.error(`[coexistence] sync start business=${businessId}: ${err.message}`);
    return null;
  }
}

/**
 * The minute sweep's step: every open sync gets its missing calls retried (at most every
 * SYNC_RETRY_EVERY_MS), SHIFT hears once at 20 h if it is still not done, and after
 * SYNC_GIVE_UP_MS the row is closed with a note. Reads only coex_sync_started rows, so with
 * coexistence never switched on it is one empty query.
 */
async function sweepSyncs(now = new Date()) {
  const report = { open: 0, retried: 0, completed: 0, alerted: 0, given_up: 0 };
  const open = await accountEvents.list({ allBusinesses: true, types: 'coex_sync_started', unresolved: true, limit: 200 });
  const nowMs = new Date(now).getTime();
  for (const started of open) {
    report.open += 1;
    try {
      const age = nowMs - new Date(started.created_at).getTime();
      const log = logFor(started.business_id);
      if (age > SYNC_GIVE_UP_MS) {
        await log('coex_sync_failed', { phone_number_id: started.data?.phone_number_id, sync_type: null, gave_up: true });
        await accountEvents.resolve(started.id);
        report.given_up += 1;
        continue;
      }
      const progress = await progressOf(started);
      const due = !progress.lastFailureAt || nowMs - progress.lastFailureAt.getTime() >= SYNC_RETRY_EVERY_MS;
      let complete = SYNC_TYPES.every((t) => progress.done.has(t));
      if (!complete && due) {
        const result = await runSync(started, { now });
        if (result.ran) report.retried += 1;
        complete = Boolean(result.complete);
        if (complete) report.completed += 1;
      } else if (complete) {
        await accountEvents.resolve(started.id);
        report.completed += 1;
      }
      if (!complete && age >= SYNC_ALERT_AFTER_MS && !progress.alerted) {
        await log('coex_sync_late', { phone_number_id: started.data?.phone_number_id, attempts: progress.attempts });
        const hoursLeft = Math.max(0, Math.round((SYNC_DEADLINE_MS - age) / HOUR));
        Promise.resolve(alerts.notifyShift({
          reason: 'needs_operator',
          businessId: started.business_id,
          summary: `مزامنة الرقم المشترك مع تطبيق واتساب للأعمال لم تكتمل — بقي نحو ${hoursLeft} ساعات على مهلة Meta`,
        })).catch(() => {});
        report.alerted += 1;
      }
    } catch (err) {
      console.error(`[coexistence] sweep ${started.id}: ${err.message}`);
    }
  }
  return report;
}

// ─── The webhook fields ─────────────────────────────────────────────────────

const BUSINESS_SELECT = {
  id: true, status: true, business_type: true, wa_phone_number_id: true, wa_business_account_id: true, wa_app_id: true,
};

/**
 * The shop a coexistence delivery belongs to, under the same rule as every other delivery
 * (messageProcessor.refusesDelivery, wabaIsolation.test.js): the number must be the shop's, the
 * WABA it arrived on must be the shop's, and the endpoint must serve the shop's Meta app. Null
 * when coexistence is off, or when any of that fails.
 */
async function deliveryOwner(entry, value, { servesApp, endpoint } = {}, field) {
  if (!(await isEnabled())) {
    console.log(`[coexistence] ${field} ignored: coexistence is off`);
    return null;
  }
  const phoneNumberId = value?.metadata?.phone_number_id;
  if (!phoneNumberId) return null;
  const business = await prisma.business.findFirst({ where: { wa_phone_number_id: String(phoneNumberId) }, select: BUSINESS_SELECT });
  if (!business) {
    console.warn(`[coexistence] ${field} for a number no shop holds: ${phoneNumberId}`);
    return null;
  }
  const wabaId = entry?.id ? String(entry.id) : null;
  if (wabaId && business.wa_business_account_id && business.wa_business_account_id !== wabaId) {
    console.error(`[coexistence] WABA mismatch — dropping ${field} for business ${business.id}: arrived on ${wabaId}`);
    return null;
  }
  if (servesApp && business.wa_app_id && !servesApp(business.wa_app_id)) {
    console.error(`[coexistence] app mismatch — dropping ${field} for business ${business.id} on the ${endpoint || 'unknown'} endpoint`);
    return null;
  }
  return business;
}

const digits = (v) => (v === undefined || v === null ? '' : String(v).replace(/\D/g, ''));
const NUL_RE = new RegExp(String.fromCharCode(0), 'g');
const clean = (s) => (typeof s === 'string' ? s.replace(NUL_RE, '') : s);

function tsOf(message, fallback) {
  const n = Number(message?.timestamp);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : fallback;
}

function textOf(m) {
  return clean(m?.text?.body || m?.[m?.type]?.caption || null);
}

/** Find or create the chat, without the inbound bookkeeping (no unread, no 24-hour window). */
async function conversationFor(businessId, customerWaId, at) {
  const where = { business_id: businessId, customer_wa_id: customerWaId };
  let conv = await prisma.conversation.findFirst({ where });
  if (conv) return conv;
  try {
    conv = await prisma.conversation.create({
      data: { ...where, status: 'open', ai_enabled: true, last_message_at: at },
    });
  } catch (err) {
    if (!err || err.code !== 'P2002') throw err;
    conv = await prisma.conversation.findFirst({ where });
  }
  return conv;
}

/** Store one message by its wamid, once. Returns the row, or null when it was already there. */
async function storeOnce(data) {
  if (!data.meta_message_id) return null;
  const existing = await prisma.message.findUnique({ where: { meta_message_id: data.meta_message_id } });
  if (existing) return null;
  try {
    return await prisma.message.create({ data });
  } catch (err) {
    if (err && err.code === 'P2002') return null; // a retry of the same delivery won the race
    throw err;
  }
}

async function bumpLastMessage(conversationId, at) {
  try {
    await prisma.conversation.updateMany({
      where: { id: conversationId, last_message_at: { lt: at } },
      data: { last_message_at: at },
    });
  } catch (err) {
    console.error(`[coexistence] last_message_at conversation=${conversationId}: ${err.message}`);
  }
}

/**
 * smb_message_echoes: what the owner sent from the WhatsApp Business app. Stored as the shop's
 * outbound message (not the bot's: is_ai_generated false, no staff user), last_outbound_at moves,
 * and the chat is held for the owner (metadata.owner_app_until) so the bot does not answer
 * underneath them. An echo whose wamid is already stored is a retry, or the bot's own send coming
 * back: it changes nothing, and in particular never silences the bot.
 */
async function handleEchoes(entry, change, opts = {}) {
  const value = change?.value || {};
  const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : [];
  if (!echoes.length) return { stored: 0 };
  const business = await deliveryOwner(entry, value, opts, 'smb_message_echoes');
  if (!business) return { stored: 0, refused: true };

  const now = opts.now ? new Date(opts.now) : new Date();
  let stored = 0;
  for (const echo of echoes) {
    const customer = digits(echo?.to);
    if (!echo?.id || !customer) continue;
    const at = tsOf(echo, now);
    const conv = await conversationFor(business.id, customer, at);
    const msg = await storeOnce({
      business_id: business.id,
      conversation_id: conv.id,
      meta_message_id: String(echo.id),
      direction: 'outbound',
      message_type: echo.type || 'text',
      text_body: textOf(echo),
      media_id: echo[echo.type]?.id || null,
      media_mime_type: echo[echo.type]?.mime_type || null,
      status: 'sent',
      sender_wa_id: digits(echo.from) || null,
      is_ai_generated: false,
      // No `kind`: replyBatcher reads raw_payload.kind as one of the bot's own intents.
      raw_payload: { source: 'owner_app' },
      created_at: at,
    });
    if (!msg) continue;
    stored += 1;
    await markOutbound(conv.id, at);
    await bumpLastMessage(conv.id, at);
    // Never moves backwards: an older echo delivered late must not shorten a newer hold.
    const until = new Date(at.getTime() + OWNER_HOLD_MS);
    const current = conv.metadata?.[HOLD_KEY] ? new Date(conv.metadata[HOLD_KEY]) : null;
    if (!current || Number.isNaN(current.getTime()) || current < until) {
      await jsonb.patchJson('conversations', conv.id, 'metadata', { [HOLD_KEY]: until.toISOString() });
    }
    sseEmitter.emit(`business:${business.id}`, { type: 'new_message', conversationId: conv.id, businessId: business.id });
  }
  return { stored };
}

/**
 * history: the chats from before the connect, in chunks. Each message is stored once by its wamid,
 * so Meta's retries and repeated chunks add nothing. Imported rows are already settled (inbound
 * 'delivered', the value a handled tenant row ends with) so no sweep answers a months-old message,
 * and they move neither unread, nor last_inbound_at (the 24-hour window), nor the waiting list.
 * A chunk carrying errors is the owner declining to share history: logged, nothing to import.
 */
async function handleHistory(entry, change, opts = {}) {
  const value = change?.value || {};
  const chunks = Array.isArray(value.history) ? value.history : [];
  if (!chunks.length) return { imported: 0 };
  const business = await deliveryOwner(entry, value, opts, 'history');
  if (!business) return { imported: 0, refused: true };

  const now = opts.now ? new Date(opts.now) : new Date();
  let imported = 0;
  let skipped = 0;
  for (const chunk of chunks) {
    if (Array.isArray(chunk?.errors) && chunk.errors.length) {
      const e = chunk.errors[0] || {};
      console.warn(`[coexistence] history unavailable business=${business.id}: ${e.code || ''} ${e.title || e.message || ''}`);
      await accountEvents.record({
        businessId: business.id, actorKind: 'meta', type: 'coex_history_unavailable', data: { error_code: e.code ?? null },
      });
      continue;
    }
    for (const thread of Array.isArray(chunk?.threads) ? chunk.threads : []) {
      const customer = digits(thread?.id);
      if (!customer) continue;
      const messages = Array.isArray(thread.messages) ? thread.messages : [];
      if (!messages.length) continue;
      const first = tsOf(messages[0], now);
      const conv = await conversationFor(business.id, customer, first);
      let newest = null;
      for (const m of messages) {
        const at = tsOf(m, now);
        const inbound = digits(m?.from) === customer;
        const seen = String(m?.history_context?.status || '').toLowerCase();
        const msg = await storeOnce({
          business_id: business.id,
          conversation_id: conv.id,
          meta_message_id: m?.id ? String(m.id) : null,
          direction: inbound ? 'inbound' : 'outbound',
          message_type: m?.type || 'text',
          text_body: textOf(m),
          media_id: m?.[m?.type]?.id || null,
          status: inbound ? 'delivered' : (['sent', 'delivered', 'read'].includes(seen) ? seen : 'sent'),
          sender_wa_id: digits(m?.from) || null,
          is_ai_generated: false,
          raw_payload: { source: 'history' },
          created_at: at,
        });
        if (!msg) { skipped += 1; continue; }
        imported += 1;
        if (!newest || at > newest) newest = at;
      }
      if (newest) await bumpLastMessage(conv.id, newest);
    }
  }
  if (imported) console.log(`[coexistence] history business=${business.id}: ${imported} imported, ${skipped} already there`);
  return { imported, skipped };
}

/** smb_app_state_sync: the app's contacts. Nothing is stored; the count says the sync arrived. */
async function handleStateSync(entry, change, opts = {}) {
  const value = change?.value || {};
  const items = Array.isArray(value.state_sync) ? value.state_sync : [];
  const business = await deliveryOwner(entry, value, opts, 'smb_app_state_sync');
  if (!business) return { count: 0, refused: true };
  console.log(`[coexistence] smb_app_state_sync business=${business.id}: ${items.length} contact changes`);
  return { count: items.length };
}

/**
 * The bot's check (messageProcessor.runTenantWorkflow): the owner answered this chat from the app
 * within OWNER_HOLD_MS. Pure, on the conversation already loaded: only handleEchoes writes the key,
 * so a shop that is not on coexistence never has it.
 */
function ownerHolds(conversation, now = new Date()) {
  const until = conversation?.metadata?.[HOLD_KEY];
  if (!until) return false;
  const t = new Date(until).getTime();
  return Number.isFinite(t) && t > new Date(now).getTime();
}

module.exports = {
  isEnabled,
  requestSync,
  startSync,
  runSync,
  sweepSyncs,
  handleEchoes,
  handleHistory,
  handleStateSync,
  ownerHolds,
  FEATURE_TYPE,
  SYNC_TYPES,
  SYNC_DEADLINE_MS,
  SYNC_ALERT_AFTER_MS,
  SYNC_RETRY_EVERY_MS,
  SYNC_GIVE_UP_MS,
  OWNER_HOLD_MS,
  HOLD_KEY,
  NOTICE_AR,
};
