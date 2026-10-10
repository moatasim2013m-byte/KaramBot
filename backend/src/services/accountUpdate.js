/**
 * The account-level webhook fields: account_update, phone_number_quality_update and
 * message_template_status_update.
 *
 * Meta requires the app to subscribe to account_update for Embedded Signup, and it is how we
 * learn about a customer's account after the browser flow is over: the signup completing, SHIFT
 * removed from it, a ban. The other two say how Meta rates a number and whether a template was
 * approved. None of them carries a message, so none may delay the 200 that inbound messages
 * depend on (routes/whatsapp.js answers them on the side).
 *
 * The payload shapes below are Meta's documented examples (docs/panels/meta-facts.md Q5a–c). They
 * are assumed until G1 records the real ones under tests/fixtures/es/, and the daily sweep
 * re-reads Meta either way.
 */

const prisma = require('../config/prisma');
const accountEvents = require('./accountEvents');
const alerts = require('./alerts');

// SHIFT is no longer on the customer's account: the token is dead or about to be, and the bot
// stops receiving. Each one sets revoked_at and tells SHIFT and the owner.
const REMOVAL_EVENTS = Object.freeze(['PARTNER_REMOVED', 'PARTNER_APP_UNINSTALLED', 'ACCOUNT_DELETED', 'ACCOUNT_OFFBOARDED']);
// Meta acting against the account. A state of the account, not a failed signup step, so it goes
// to the log (meta_restriction) rather than over last_error, where it hid the real resume point.
const RESTRICTION_EVENTS = Object.freeze(['ACCOUNT_VIOLATION', 'ACCOUNT_RESTRICTION', 'DISABLED_UPDATE']);
// The customer finished Embedded Signup (or granted the app). Confirmation for a row we have; the
// only trace of a signup we do not (Hosted ES, a lost code), which SHIFT then matches by hand.
const ADDED_EVENTS = Object.freeze(['PARTNER_ADDED', 'PARTNER_APP_INSTALLED']);

// The owner's panel has no reconnect button yet (ConnectWhatsApp lives on SHIFT's «الحالة» tab,
// and the owner's route waits for es_owner_enabled), so the way back goes through SHIFT.
const REMOVED_AR = 'انفصل كرم بوت عن حسابك في Meta — البوت لا يستقبل الرسائل. تواصل مع شِفت لإعادة الربط.';

const metaId = (v) => (v !== undefined && v !== null && /^\d{1,32}$/.test(String(v)) ? String(v) : null);

/**
 * The WABA an account_update is about. In Meta's PARTNER_ADDED and PARTNER_APP_* examples entry.id
 * is the PARTNER's portfolio (SHIFT's), and the WABA is in value.waba_info.waba_id; other events
 * use the WABA as entry.id. Reading entry.id alone logged every signup as an unknown WABA.
 */
function wabaOf(entry, value) {
  return metaId(value?.waba_info?.waba_id) || metaId(entry?.id);
}

/** The newest row for a WABA that still stands for a shop's number (not an old detached one). */
async function onboardingFor(wabaId) {
  return prisma.whatsappOnboarding.findFirst({
    where: { waba_id: wabaId, detached_at: null },
    orderBy: { created_at: 'desc' },
  });
}

/**
 * The shop's own alert about a removal, best effort. It goes through the shop's alert numbers
 * like any other alert; after a removal the shop's own token may no longer send, so the red
 * panel and SHIFT (notifyShift) are what the owner can count on.
 */
async function alertOwner(businessId, summary) {
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return;
    await alerts.sendStaffAlert({
      reason: 'partner_removed',
      business,
      conversation: { id: null, profile_name: business.name || '-', customer_wa_id: null },
      summary,
    });
  } catch (err) {
    console.error(`[account_update] owner alert business=${businessId} failed: ${err.message}`);
  }
}

/** A PARTNER_ADDED for a WABA no row holds, once: Meta repeats webhooks. */
async function recordUnmatched(wabaId, event, value) {
  const open = await accountEvents.list({
    businessId: null, types: 'partner_added_unmatched', unresolved: true, limit: 200,
  }).catch(() => []);
  if (open.some((e) => e?.data?.waba_id === wabaId)) return null;
  return accountEvents.record({
    businessId: null,
    actorKind: 'meta',
    type: 'partner_added_unmatched',
    data: {
      event,
      waba_id: wabaId,
      owner_business_id: metaId(value?.waba_info?.owner_business_id),
    },
  });
}

/** Handle one `account_update` change. Returns what it did, for the tests and the log. */
async function handleAccountUpdate(entry, change) {
  const value = change?.value || {};
  const event = typeof value.event === 'string' ? value.event : 'unknown';
  const wabaId = wabaOf(entry, value);
  if (!wabaId) return { handled: false, reason: 'no waba id' };

  const row = await onboardingFor(wabaId);
  if (!row) {
    if (ADDED_EVENTS.includes(event)) {
      await recordUnmatched(wabaId, event, value);
      console.warn(`[account_update] ${event} for WABA ${wabaId} with no signup row — listed for SHIFT`);
      return { handled: true, event, unmatched: true };
    }
    // A WABA we were subscribed to but never onboarded here: worth seeing, not an error.
    console.warn(`[account_update] ${event} for unknown WABA ${wabaId}`);
    return { handled: false, reason: 'unknown waba' };
  }

  const log = (type, data) => accountEvents.record({ businessId: row.business_id, actorKind: 'meta', type, data });
  const now = new Date();

  if (ADDED_EVENTS.includes(event)) {
    // The token exchange is already running in the request that opened it: confirmation only.
    await log('partner_added', { event, waba_id: wabaId });
  } else if (REMOVAL_EVENTS.includes(event)) {
    // Conditional, not check-then-write: Meta can deliver the same removal twice, or
    // PARTNER_REMOVED with PARTNER_APP_UNINSTALLED, and routes/whatsapp.js handles them side by
    // side. Only the delivery that flips revoked_at logs and alerts (as tokenHealth.markInvalid).
    const { count } = row.revoked_at ? { count: 0 } : await prisma.whatsappOnboarding.updateMany({
      where: { id: row.id, revoked_at: null },
      data: { revoked_at: now, revoked_reason: event.toLowerCase() },
    });
    if (count === 1) {
      await log('partner_removed', { event, waba_id: wabaId });
      if (row.business_id) {
        Promise.resolve(alerts.notifyShift({
          reason: 'partner_removed', businessId: row.business_id, summary: `أزال الزبون شِفت من حسابه في Meta (${event})`,
        })).catch(() => {});
        await alertOwner(row.business_id, REMOVED_AR);
      }
    }
  } else if (event === 'ACCOUNT_RECONNECTED') {
    if (row.revoked_at) {
      await prisma.whatsappOnboarding.update({ where: { id: row.id }, data: { revoked_at: null, revoked_reason: null } });
    }
    await log('partner_reconnected', { event, waba_id: wabaId });
  } else if (RESTRICTION_EVENTS.includes(event)) {
    await log('meta_restriction', {
      event,
      waba_id: wabaId,
      restriction_info: value.restriction_info ?? null,
      violation_info: value.violation_info ?? null,
      ban_info: value.ban_info ?? null,
    });
  }

  console.log(`[account_update] ${event} waba=${wabaId} onboarding=${row.id}`);
  return { handled: true, event, onboardingId: row.id };
}

const QUALITY = new Set(['GREEN', 'YELLOW', 'RED', 'UNKNOWN']);

/**
 * `phone_number_quality_update`: Meta's rating of a number changed.
 *
 * Assumed shape: { display_phone_number, event: FLAGGED | UNFLAGGED | DOWNGRADE | UPGRADE | …,
 * current_limit }, keyed by the WABA in entry.id. FLAGGED means the rating dropped to low (RED)
 * and UNFLAGGED that it recovered (GREEN); a quality_rating field, if Meta sends one, wins. The
 * limit events say nothing about quality and leave it alone. The number is matched by its
 * display form against the shop's, or taken as the WABA's only row.
 */
async function handleQualityUpdate(entry, change) {
  const value = change?.value || {};
  const wabaId = metaId(entry?.id);
  if (!wabaId) return { handled: false, reason: 'no waba id' };

  let rating = typeof value.quality_rating === 'string' ? value.quality_rating.toUpperCase() : null;
  if (!rating || !QUALITY.has(rating)) {
    rating = value.event === 'FLAGGED' ? 'RED' : value.event === 'UNFLAGGED' ? 'GREEN' : null;
  }
  if (!rating) return { handled: false, reason: `no rating in ${value.event || 'event'}` };

  const rows = await prisma.whatsappOnboarding.findMany({
    where: { waba_id: wabaId, detached_at: null, business_id: { not: null } },
    select: { id: true, business_id: true },
  });
  let target = rows.length === 1 ? rows[0] : null;
  if (rows.length > 1) {
    const digits = String(value.display_phone_number || '').replace(/\D/g, '');
    const businesses = await prisma.business.findMany({
      where: { id: { in: rows.map((r) => r.business_id) } },
      select: { id: true, wa_display_phone: true },
    });
    const match = businesses.find((b) => digits && String(b.wa_display_phone || '').replace(/\D/g, '') === digits);
    target = match ? rows.find((r) => r.business_id === match.id) : null;
  }
  if (!target) return { handled: false, reason: 'no matching number' };

  await prisma.whatsappOnboarding.update({ where: { id: target.id }, data: { meta_quality_rating: rating } });
  console.log(`[quality_update] ${value.event} waba=${wabaId} onboarding=${target.id} rating=${rating}`);
  return { handled: true, rating, onboardingId: target.id };
}

// The owner-alert templates a shop's WABA may hold. staff_alert is the name scripts/
// create-alert-template.js submits; owner_alert is the name P2's auto-submission is to use. Both
// take the same three variables alerts.js fills, so either can carry the owner's alerts.
const OWNER_ALERT_TEMPLATES = new Set([alerts.ALERT_TEMPLATE_NAME, 'owner_alert']);

/**
 * `message_template_status_update`: a template on a shop's WABA was approved, rejected, paused….
 *
 * Assumed shape: { event: APPROVED | REJECTED | PENDING | PAUSED | DISABLED, message_template_id,
 * message_template_name, message_template_language, reason }, keyed by the WABA in entry.id.
 * Every change goes on the shop's log. An APPROVED owner-alert template becomes the shop's
 * ai_config.alert_template, which is what lets an owner's alert out after 24 hours
 * (alerts.js); a template the shop already uses for that is never swapped for another name.
 */
async function handleTemplateStatusUpdate(entry, change) {
  const value = change?.value || {};
  const wabaId = metaId(entry?.id);
  if (!wabaId) return { handled: false, reason: 'no waba id' };
  const name = typeof value.message_template_name === 'string' ? value.message_template_name : null;
  const language = typeof value.message_template_language === 'string' ? value.message_template_language : null;
  const event = typeof value.event === 'string' ? value.event : 'unknown';

  const businesses = await prisma.business.findMany({
    where: { wa_business_account_id: wabaId },
    select: { id: true, ai_config: true },
  });
  if (!businesses.length) return { handled: false, reason: 'unknown waba' };

  let set = 0;
  for (const business of businesses) {
    await accountEvents.record({
      businessId: business.id,
      actorKind: 'meta',
      type: 'template_status',
      data: {
        event, name, language, waba_id: wabaId, reason: value.reason ?? null,
      },
    });
    if (event !== 'APPROVED' || !name || !language || !OWNER_ALERT_TEMPLATES.has(name)) continue;
    const config = business.ai_config && typeof business.ai_config === 'object' && !Array.isArray(business.ai_config)
      ? business.ai_config : {};
    const current = config.alert_template;
    if (current?.name && current.name !== name) continue;
    if (current?.name === name && current.language === language) continue;
    await prisma.business.update({
      where: { id: business.id },
      data: { ai_config: { ...config, alert_template: { name, language } } },
    });
    set += 1;
  }
  console.log(`[template_status] ${event} ${name || '-'} waba=${wabaId} alert_template_set=${set}`);
  return { handled: true, event, alertTemplateSet: set };
}

module.exports = {
  handleAccountUpdate,
  handleQualityUpdate,
  handleTemplateStatusUpdate,
  wabaOf,
  REMOVAL_EVENTS,
  RESTRICTION_EVENTS,
  OWNER_ALERT_TEMPLATES,
  REMOVED_AR,
};
