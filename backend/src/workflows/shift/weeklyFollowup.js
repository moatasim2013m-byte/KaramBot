'use strict';

/**
 * Weekly follow-up for SHIFT's own leads during the October 2026 offer (owner, 2026-10-06): one approved
 * marketing template a week, four at most, to people who wrote to the bot and went quiet.
 *
 * Pure decisions and the template part. Nothing here sends or reads the DB; the sweeper executes it
 * (services/shiftSweeper.js, step weekly_followups) through dispatchIntent, so every send is an intent
 * row behind the pre-send check, and each step is claimed once — a follow-up can never go out twice.
 *
 * The series stops for good when the customer writes again after a follow-up (the bot has the
 * conversation back), opts out, is handed to the team, or the conversation is closed — «لا شكرا», not a
 * business, an opt-out — and once the offer ends or its ten places are taken. Marketing templates cost
 * money per message and every block or report lowers the number's quality rating, which every other
 * message from this number depends on: so four, not «every week» without end.
 *
 * «ضايل {{2}} أماكن» is the real count — ten minus the Karam Bot subscriptions started since the offer
 * began — never a number chosen to look urgent.
 */

const followups = require('./followups');
const templateText = require('../../services/templateText');

const DAY_MS = 24 * 60 * 60 * 1000;

const OFFER = {
  startsAt: '2026-10-01T00:00:00+03:00',
  // «عرض أكتوبر»: midnight Amman at the end of 31 October.
  endsAt: '2026-11-01T00:00:00+03:00',
  places: 10,
};

// First follow-up after three days of silence, then one a week: a lead who went quiet on 3 October
// gets all four before the offer ends.
const FIRST_DELAY_MS = 3 * DAY_MS;
const INTERVAL_MS = 7 * DAY_MS;
const LOOKBACK_MS = 35 * DAY_MS;

// Template name, and whether its body carries the places left as {{2}}.
const STEPS = [
  { name: 'karam_followup_w1', places: true },
  { name: 'karam_followup_w2', places: true },
  { name: 'karam_followup_w3', places: true },
  { name: 'karam_followup_w4', places: false },
];

// The team has it, or it is over: no sales message on top.
const STOP_STATES = ['closed', 'captured', 'handoff'];
const STOP_STATUSES = ['pending', 'human_takeover'];
const NAME_FALLBACK = 'صديقنا';
const NAME_MAX = 30;

function enabled(env = process.env) {
  return env.SHIFT_WEEKLY_FOLLOWUPS === '1';
}

function toMs(v) {
  if (v === null || v === undefined) return NaN;
  return (v instanceof Date ? v : new Date(v)).getTime();
}

function wdOf(conversation) {
  return (conversation && conversation.workflow_data) || {};
}

/**
 * What the template calls the customer. A name they gave the bot first, then their WhatsApp profile
 * name — but only plain Arabic or Latin letters: profile names like «ɴᴀꜱꜱᴇʀ ᴀʟ.ꜱʜᴀɴɴᴀɢ» or a bare email
 * read badly in «أهلين …», and Meta rejects empty or multi-line parameters.
 */
function nameFor(conversation) {
  const lead = wdOf(conversation).lead || {};
  for (const raw of [lead.name, conversation && conversation.profile_name]) {
    if (typeof raw !== 'string') continue;
    const s = raw.replace(/\s+/g, ' ').trim();
    if (!s || s.length > NAME_MAX || /[@\d]/.test(s)) continue;
    if (!/^[ء-ي٠-٩ a-zA-Z.'-]+$/.test(s)) continue;
    // Whole, up to three words: cutting at two turned «مندوب أبو راشد» into «مندوب أبو».
    const words = s.split(' ');
    return words.length <= 3 ? s : NAME_FALLBACK;
  }
  return NAME_FALLBACK;
}

/**
 * The next follow-up for this conversation, or why there is none.
 * Returns { step, template } or { skip: reason, stop?: true } — `stop` ends the series for good.
 */
function plan({ conversation, lastInbound, now = new Date(), staffNumbers = [], placesLeft = OFFER.places } = {}) {
  const t = now.getTime();
  if (t < toMs(OFFER.startsAt)) return { skip: 'offer_not_started' };
  if (t >= toMs(OFFER.endsAt)) return { skip: 'offer_ended' };
  if (placesLeft <= 0) return { skip: 'offer_full' };
  if (!conversation || !lastInbound) return { skip: 'no_inbound' };
  if (staffNumbers.includes(String(conversation.customer_wa_id || '').replace(/\D/g, ''))) return { skip: 'staff' };

  const wd = wdOf(conversation);
  const wf = wd.weekly_followup || {};
  if (wf.stopped) return { skip: wf.stopped };
  if (wd.marketing_opted_out_at) return { skip: 'opted_out', stop: true };
  if (STOP_STATES.includes(conversation.current_state)) return { skip: `state_${conversation.current_state}`, stop: true };
  // With the team means the series is over, not paused (review, 2026-10-06).
  if (STOP_STATUSES.includes(conversation.status)) return { skip: `status_${conversation.status}`, stop: true };
  if (wd.booking && ['booked', 'rescheduled'].includes(wd.booking.status)) return { skip: 'booked', stop: true };

  const lastInboundAt = toMs(lastInbound.created_at);
  const lastSentAt = toMs(wf.last_sent_at);
  // They wrote back after a follow-up: the conversation is the bot's again, the series is over.
  if (Number.isFinite(lastSentAt) && lastInboundAt > lastSentAt) return { skip: 'replied', stop: true };

  const step = (Number(wf.step) || 0) + 1;
  if (step > STEPS.length) return { skip: 'series_done', stop: true };
  if (t - lastInboundAt > LOOKBACK_MS) return { skip: 'too_old' };
  if (step === 1 && t - lastInboundAt < FIRST_DELAY_MS) return { skip: 'too_soon' };
  if (step > 1 && t - lastSentAt < INTERVAL_MS) return { skip: 'too_soon' };
  if (!followups.isFriendly(now)) return { skip: 'quiet_hours' };

  return { step, template: STEPS[step - 1].name };
}

/** The template part dispatchIntent sends. No quick-reply payloads: a tap arrives as its own text. */
function part({ conversation, step, placesLeft }) {
  const s = STEPS[step - 1];
  const name = nameFor(conversation);
  return {
    type: 'template',
    name: s.name,
    language: 'ar',
    bodyParams: s.places ? [name, String(placesLeft)] : [name],
    // The message the customer receives, for the Inbox thread (it showed an internal tag before).
    text: templateText.render(s.name, s.places ? [name, String(placesLeft)] : [name])
      || `[متابعة أسبوعية ${step}/4 — ${s.name}] ${name}${s.places ? ` · ضايل ${placesLeft}` : ''}`,
  };
}

module.exports = { enabled, plan, part, nameFor, OFFER, STEPS, FIRST_DELAY_MS, INTERVAL_MS, LOOKBACK_MS, NAME_FALLBACK };
