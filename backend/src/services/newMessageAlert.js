'use strict';

/**
 * «رسالة جديدة من عميل»: tell staff on WhatsApp when a customer writes, for any business that asks.
 *
 * Config (businesses.ai_config):
 *   alert_new_messages           true/false — default: on when alert_wa_numbers has a number
 *   alert_new_message_quiet_min  minutes of silence from the customer before they alert again (default 30)
 *
 * Noise control: a customer's first-ever message alerts; after that only a message that follows at least
 * `quiet_min` minutes without any message from them does, so a burst of ten messages is one alert.
 * Staff numbers (alert_wa_numbers) never alert themselves. Two deliveries of the same burst racing on
 * different instances both see the same «last message before the gap» and claim it in
 * conversations.metadata.new_message_alert_after — only one of them alerts.
 *
 * Fire-and-forget from the inbound path: notifyNewMessages returns at once, never throws and its
 * promise never rejects, so the reply is neither delayed nor broken by it.
 */

const prisma = require('../config/prisma');
const jsonb = require('../db/jsonb');
const alerts = require('./alerts');

const DEFAULT_QUIET_MIN = 30;
const PREVIEW_MAX = 120;
const AD_TITLE_MAX = 80;
const CLAIM_KEY = 'new_message_alert_after';
const FIRST_MESSAGE = 'first';
// Not something the customer wrote: never alerts, and never breaks the silence either.
const SKIP_TYPES = ['reaction', 'system', 'ephemeral', 'request_welcome'];

const TYPE_LABELS = {
  image: 'صورة',
  audio: 'رسالة صوتية',
  video: 'فيديو',
  document: 'ملف',
  sticker: 'ملصق',
  location: 'موقع',
  contacts: 'جهة اتصال',
  order: 'طلب من الكتالوج',
  unsupported: 'رسالة غير مدعومة',
};

function newMessageConfig(business) {
  const cfg = (business && business.ai_config) || {};
  // Same normalisation as alerts.alertNumbers (digits only); read here so a test double of alerts is enough.
  const staff = (Array.isArray(cfg.alert_wa_numbers) ? cfg.alert_wa_numbers : [])
    .map((n) => String(n ?? '').replace(/\D/g, '')).filter(Boolean);
  const flag = cfg.alert_new_messages;
  const enabled = typeof flag === 'boolean' ? flag : staff.length > 0;
  const quiet = Number(cfg.alert_new_message_quiet_min);
  const quietMin = cfg.alert_new_message_quiet_min !== undefined && cfg.alert_new_message_quiet_min !== null
    && Number.isFinite(quiet) && quiet >= 0 ? quiet : DEFAULT_QUIET_MIN;
  return { enabled, quietMs: Math.round(quietMin * 60 * 1000), staff: new Set(staff) };
}

function oneLine(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function cut(value, max) {
  const chars = Array.from(value);
  return chars.length > max ? `${chars.slice(0, max).join('').trimEnd()}…` : value;
}

/** What the customer sent, as one short line: their text (first 120 chars) or «صورة: caption», «رسالة صوتية»… */
function messagePreview(waMsg) {
  const m = waMsg || {};
  const text = oneLine(m.text?.body || m.interactive?.button_reply?.title || m.interactive?.list_reply?.title
    || m.button?.text || '');
  if (text) return `«${cut(text, PREVIEW_MAX)}»`;
  const label = TYPE_LABELS[m.type] || 'رسالة';
  const caption = oneLine(m.image?.caption || m.video?.caption || m.document?.caption || m.document?.filename
    || m.location?.name || m.location?.address || '');
  return caption ? `${label}: ${cut(caption, PREVIEW_MAX)}` : label;
}

/** Click-to-WhatsApp: «من إعلان: <headline>» from the webhook's `referral` (null when not from an ad/post). */
function adLine(referral) {
  if (!referral || typeof referral !== 'object') return null;
  const lead = referral.source_type === 'post' ? 'من منشور' : 'من إعلان';
  const title = oneLine(referral.headline || referral.body || referral.source_url || '');
  return title ? `${lead}: ${cut(title, AD_TITLE_MAX)}` : lead;
}

function alertSummary(waMsg) {
  return [messagePreview(waMsg), adLine(waMsg && waMsg.referral)].filter(Boolean).join('\n');
}

/**
 * The silence anchor for this message: FIRST_MESSAGE when the customer never wrote before, the id of their
 * previous message when it is at least `quietMs` older, or null (inside a burst → no alert).
 */
async function silenceAnchor(message, quietMs) {
  const at = message.created_at ? new Date(message.created_at) : new Date();
  const previous = await prisma.message.findFirst({
    where: {
      conversation_id: message.conversation_id,
      direction: 'inbound',
      id: { not: message.id },
      message_type: { notIn: SKIP_TYPES },
      created_at: { lt: at },
    },
    orderBy: { created_at: 'desc' },
    select: { id: true, created_at: true },
  });
  if (!previous) return FIRST_MESSAGE;
  return at.getTime() - new Date(previous.created_at).getTime() >= quietMs ? previous.id : null;
}

async function claimAnchor(conversationId, anchor) {
  try {
    return await jsonb.claimValue('conversations', conversationId, 'metadata', CLAIM_KEY, anchor);
  } catch (err) {
    // Better a rare duplicate than a missed customer.
    console.error(`[new_message] claim failed conversation=${conversationId}: ${err.message} — alerting anyway`);
    return true;
  }
}

async function alertOne(business, item, cfg, now) {
  const conversation = item.conversation;
  const anchor = await silenceAnchor(item.message, cfg.quietMs);
  if (!anchor) return 'burst';
  if (!(await claimAnchor(conversation.id, anchor))) return 'claimed_elsewhere';
  const profileName = item.contact?.profile?.name || conversation.profile_name || null;
  await alerts.sendStaffAlert({
    reason: 'new_message',
    business,
    conversation: { ...conversation, profile_name: profileName },
    summary: alertSummary(item.waMsg),
    link: alerts.inboxUrl(),
    now,
  });
  return 'alerted';
}

// Rows this delivery inserted (a Meta retry of a stored message is not new), one per conversation: the
// first message of a delivery decides; the rest of it is the same burst.
function candidates(items, cfg) {
  const seen = new Set();
  const out = [];
  for (const item of Array.isArray(items) ? items : []) {
    const claimed = item && (item.claimed === undefined ? !!(item.created || item.recovered) : item.claimed);
    if (!claimed || !item.message || !item.conversation) continue;
    if (item.message.direction && item.message.direction !== 'inbound') continue;
    if (SKIP_TYPES.includes(item.waMsg?.type)) continue;
    const from = String(item.customerWaId || item.conversation.customer_wa_id || '').replace(/\D/g, '');
    if (!from || cfg.staff.has(from)) continue;
    if (seen.has(item.conversation.id)) continue;
    seen.add(item.conversation.id);
    out.push(item);
  }
  return out;
}

/**
 * Called by messageProcessor right after the inbound rows are stored. Returns a promise for tests; the
 * caller does not await it. Resolves to one outcome per candidate conversation; never rejects.
 */
function notifyNewMessages(business, items, { now = new Date() } = {}) {
  let list;
  let cfg;
  try {
    if (!business || business.status !== 'active') return Promise.resolve([]);
    cfg = newMessageConfig(business);
    if (!cfg.enabled) return Promise.resolve([]);
    list = candidates(items, cfg);
    if (!list.length) return Promise.resolve([]);
  } catch (err) {
    console.error(`[new_message] skipped business=${business && business.id}: ${err.message}`);
    return Promise.resolve([]);
  }

  // Starts after the caller's current synchronous step: nothing here runs ahead of the reply path.
  return Promise.resolve().then(async () => {
    const outcomes = [];
    for (const item of list) {
      try {
        outcomes.push(await alertOne(business, item, cfg, now));
      } catch (err) {
        console.error(`[new_message] alert failed conversation=${item.conversation.id}: ${err.message}`);
        outcomes.push('failed');
      }
    }
    return outcomes;
  }).catch((err) => {
    console.error(`[new_message] failed business=${business.id}: ${err.message}`);
    return [];
  });
}

module.exports = {
  notifyNewMessages,
  newMessageConfig,
  messagePreview,
  adLine,
  alertSummary,
  DEFAULT_QUIET_MIN,
  CLAIM_KEY,
};
