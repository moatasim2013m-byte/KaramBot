'use strict';

/**
 * The single in-window nudge (design §7.4, contract §8.3): pure decisions and fixed texts. The sweeper
 * executes them through deliverResult, so every nudge is an intent row with callback data and passes
 * the pre-send fence check (D17/D20/D21). Nothing here sends, reads the DB or calls the model.
 *
 * Rules that keep the nudge honest and rare:
 * - one per silence (keyed by the inbound it follows), at most two per conversation;
 * - only after a bot message that asked something (next_step question/buttons);
 * - only in friendly Amman hours (09:00–21:30, never in the Friday prayer block);
 * - never later than 23.5 h after the customer's last message — past that it is dropped and the team
 *   gets a call task instead. No text mentions the window or claims what WhatsApp allows (G13).
 *
 * OWNER-APPROVAL-PENDING: the Arabic nudge texts (contract §13). The no_contact line is design-approved.
 */

const hours = require('./hours');
const { windowClosesAt, isWithinServiceWindow, NOTE_WINDOW_MARGIN_MS } = require('../../utils/serviceWindow');
const assets = require('./assets');
const roleplay = require('./roleplay');

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

const FRIENDLY = { from: '09:00', to: '21:30', fridayBlock: ['11:00', '14:00'], tz: 'Asia/Amman' };
const NUDGE_DELAY_MS = 20 * HOUR_MS;
const SAMPLE_TOUCH_MS = 2 * HOUR_MS;
const WINDOW_GUARD_MS = 30 * MINUTE_MS;
const MAX_LIFETIME = 2;
const ROLEPLAY_RESUME_MS = HOUR_MS;
// «ضايل كم سؤال» only reads true soon after the example paused: the resume nudge goes out after 2 h.
const ROLEPLAY_RESUME_DELAY_MS = 2 * HOUR_MS;
const CLOSE_NUDGE_STAGES = ['close', 'objection'];
const FRIDAY = 5;
const BLOCKED_STAGES = ['captured', 'handoff', 'closed'];
const NUDGE_STEPS = ['question', 'buttons'];
// The customer's own message is with the team (D18 escalation, a quote request): no sales nudge on top.
const WAITING_INBOUND = ['awaiting_staff', 'unconfirmed'];

function nudgesEnabled(env = process.env) {
  return !!env && env.SHIFT_NUDGES !== '0';
}

function toMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

function toDate(value) {
  const ms = toMs(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

function wdOf(conversation) {
  return (conversation && conversation.workflow_data) || {};
}

function ceilingFor(lastInboundAt) {
  const closes = windowClosesAt(lastInboundAt);
  return closes ? new Date(closes.getTime() - WINDOW_GUARD_MS) : null;
}

function isFriendly(date) {
  const p = hours.localParts(date, FRIENDLY.tz);
  const from = hours.hmToMinutes(FRIENDLY.from);
  const to = hours.hmToMinutes(FRIENDLY.to);
  if (p.minutes < from || p.minutes > to) return false;
  if (p.weekday === FRIDAY) {
    const [bFrom, bTo] = FRIENDLY.fridayBlock.map(hours.hmToMinutes);
    if (p.minutes >= bFrom && p.minutes < bTo) return false;
  }
  return true;
}

/**
 * The first friendly minute at or after `date` (Amman local). Before 09:00 → 09:00 that day; after
 * 21:30 → 09:00 the next day; Friday 11:00–13:59 → 14:00. Re-checked because one move can land in
 * another rule (at most 3 moves are ever needed).
 */
function nextFriendlyMinute(date) {
  let d = toDate(date) || new Date();
  const from = hours.hmToMinutes(FRIENDLY.from);
  const to = hours.hmToMinutes(FRIENDLY.to);
  for (let i = 0; i < 3; i += 1) {
    if (isFriendly(d)) return d;
    const p = hours.localParts(d, FRIENDLY.tz);
    if (p.minutes < from) d = hours.zonedDate(p.dateKey, FRIENDLY.from, FRIENDLY.tz);
    else if (p.minutes > to) d = hours.zonedDate(hours.addDays(p.dateKey, 1), FRIENDLY.from, FRIENDLY.tz);
    else d = hours.zonedDate(p.dateKey, FRIENDLY.fridayBlock[1], FRIENDLY.tz);
  }
  return d;
}

/**
 * The customer is waiting on the team: an open team request on a pending conversation (unsent_reply, a
 * quote), or their newest message parked for staff or not yet confirmed answered (review r2 #9).
 */
function waitingOnTeam(conversation, inbound) {
  const conv = conversation || {};
  const nt = wdOf(conv).needs_team;
  if (conv.status === 'pending' && nt && typeof nt === 'object' && !nt.resolved_at) return true;
  return !!(inbound && WAITING_INBOUND.includes(inbound.status));
}

function hasName(lead) {
  return !!(lead && ((typeof lead.name === 'string' && lead.name.trim())
    || (typeof lead.business_name === 'string' && lead.business_name.trim())));
}

function nudgeKind(conversation, now) {
  const wd = wdOf(conversation);
  const stage = conversation.current_state || 'opening';
  const samples = wd.samples_sent || {};
  // «المثال جاهز، أبعثه هون؟» only when nothing was sent yet: not after the page link went out.
  if (stage === 'sample' && samples.accepted_at && !samples.image && !samples.page) return 'sample_touch';
  const rp = wd.roleplay;
  if (rp && rp.end_reason === 'idle') {
    const endedMs = toMs(rp.ended_at);
    if (Number.isFinite(endedMs) && toMs(now) - endedMs < ROLEPLAY_RESUME_MS) return 'roleplay_resume';
  }
  if (Number(wd.close_declines) >= 1) return 'close_declined';
  if (!hasName(wd.lead)) return 'no_contact';
  return 'stage';
}

/**
 * The nudge object of §1.3 for the silence after `lastInbound`, or null when none may be scheduled.
 * A nudge whose friendly due time is past the ceiling is still returned, born dropped ('window'), so
 * the sweeper records it once and raises the staff call task.
 *
 * `for_inbound_at` is an addition to §1.3: dueCheck needs the inbound's time to rebuild the ceiling and
 * to notice a newer inbound without another query.
 */
function planNudge({ conversation, lastInbound, lastBot, now = new Date(), newestMessage } = {}) {
  if (!nudgesEnabled() || !conversation || !lastInbound || !lastInbound.id) return null;
  const wd = wdOf(conversation);
  const inboundMs = toMs(lastInbound.created_at);
  if (!Number.isFinite(inboundMs)) return null;

  if ((Number(wd.nudges_sent) || 0) >= MAX_LIFETIME) return null;
  if (wd.marketing_opted_out_at || wd.not_now_at) return null;
  if (BLOCKED_STAGES.includes(conversation.current_state)) return null;
  // Not while an example is live: the sweeper ends an idle one first and then plans the resume nudge.
  if (wd.roleplay && wd.roleplay.active === true) return null;
  if (conversation.status === 'human_takeover' || conversation.ai_enabled === false) return null;
  if (waitingOnTeam(conversation, lastInbound)) return null;

  const bot = lastBot || wd.last_bot;
  if (!bot || !NUDGE_STEPS.includes(bot.next_step)) return null;
  // The newest message must be ours: a bot outbound after the customer's last message.
  const botMs = toMs(bot.at);
  if (!Number.isFinite(botMs) || botMs <= inboundMs) return null;
  if (newestMessage) {
    const newestMs = toMs(newestMessage.created_at);
    if (newestMessage.direction !== 'outbound' || newestMessage.sent_by_user_id || !(newestMs > inboundMs)) return null;
  }
  // One per silence, whether that nudge was sent or dropped.
  if (wd.nudge && wd.nudge.for_inbound_id === lastInbound.id) return null;

  const kind = nudgeKind(conversation, now);
  const delay = kind === 'sample_touch' ? SAMPLE_TOUCH_MS : kind === 'roleplay_resume' ? ROLEPLAY_RESUME_DELAY_MS : NUDGE_DELAY_MS;
  const due = nextFriendlyMinute(new Date(inboundMs + delay));
  const ceiling = ceilingFor(inboundMs);
  const past = due.getTime() > ceiling.getTime();
  return {
    due_at: due.toISOString(),
    kind,
    stage: conversation.current_state || 'opening',
    for_inbound_id: lastInbound.id,
    for_inbound_at: new Date(inboundMs).toISOString(),
    sent_at: null,
    dropped_at: past ? new Date(toMs(now)).toISOString() : null,
    drop_reason: past ? 'window' : null,
  };
}

/**
 * Why a planned nudge must not be sent, or null. `newestInbound` / `newestStaffOutbound` are the rows
 * the sweeper loaded; without them the conversation's own last_inbound_at is compared with the nudge.
 */
function cancelReason(conversation, { newestInbound, newestStaffOutbound } = {}) {
  if (!nudgesEnabled()) return 'disabled';
  const conv = conversation || {};
  const wd = wdOf(conv);
  const nudge = wd.nudge || null;
  if (wd.marketing_opted_out_at) return 'optout';
  if (wd.not_now_at) return 'not_now';
  const stage = conv.current_state;
  if (stage === 'captured' || stage === 'handoff' || stage === 'closed') return stage;

  const forMs = nudge ? toMs(nudge.for_inbound_at) : NaN;
  if (newestInbound && nudge && newestInbound.id && newestInbound.id !== nudge.for_inbound_id) {
    const newestMs = toMs(newestInbound.created_at);
    if (!Number.isFinite(forMs) || !Number.isFinite(newestMs) || newestMs > forMs) return 'inbound';
  }
  const lastInboundMs = toMs(conv.last_inbound_at);
  if (Number.isFinite(forMs) && Number.isFinite(lastInboundMs) && lastInboundMs > forMs) return 'inbound';

  // A staff member stepped in: the conversation is theirs now.
  if (conv.status === 'human_takeover' || conv.ai_enabled === false) return 'staff';
  if (waitingOnTeam(conv, newestInbound)) return 'staff';
  if (newestStaffOutbound) {
    const staffMs = toMs(newestStaffOutbound.created_at);
    const since = Number.isFinite(forMs) ? forMs : lastInboundMs;
    if (!Number.isFinite(since) || !Number.isFinite(staffMs) || staffMs > since) return 'staff';
  }

  if (!(nudge && nudge.sent_at) && (Number(wd.nudges_sent) || 0) >= MAX_LIFETIME) return 'lifetime';
  return null;
}

/**
 * The decision with its reason: {decision:'send'|'wait'|'drop', reason, until?}. A settled nudge (sent
 * or dropped already) is 'drop' with reason 'settled' — the sweeper must not re-patch it.
 */
function dueDecision(nudge, conversation, now = new Date(), opts = {}) {
  if (!nudge) return { decision: 'drop', reason: 'none' };
  if (nudge.sent_at || nudge.dropped_at) return { decision: 'drop', reason: 'settled' };
  const conv = conversation || {};
  const withNudge = { ...conv, workflow_data: { ...wdOf(conv), nudge } };
  const cancel = cancelReason(withNudge, opts);
  if (cancel) return { decision: 'drop', reason: cancel };

  const nowMs = toMs(now);
  const dueMs = toMs(nudge.due_at);
  if (Number.isFinite(dueMs) && nowMs < dueMs) return { decision: 'wait', reason: 'not_due', until: new Date(dueMs).toISOString() };

  const inboundAt = nudge.for_inbound_at || conv.last_inbound_at;
  const ceiling = ceilingFor(inboundAt);
  if (!ceiling || nowMs > ceiling.getTime()) return { decision: 'drop', reason: 'window' };
  if (!isWithinServiceWindow(conv.last_inbound_at || inboundAt, new Date(nowMs), { marginMs: NOTE_WINDOW_MARGIN_MS })) {
    return { decision: 'drop', reason: 'window' };
  }
  if (!isFriendly(new Date(nowMs))) {
    const next = nextFriendlyMinute(new Date(nowMs));
    if (next.getTime() > ceiling.getTime()) return { decision: 'drop', reason: 'window' };
    return { decision: 'wait', reason: 'friendly_hours', until: next.toISOString() };
  }
  return { decision: 'send', reason: null };
}

function dueCheck(nudge, conversation, now = new Date(), opts = {}) {
  return dueDecision(nudge, conversation, now, opts).decision;
}

// ---------------------------------------------------------------------------------------------------
// Texts (fixed, no AI). Buttons are server buttons: validators never strip them.

const SUGGESTED_Q = {
  clinic: { ar: 'في موعد بكرا؟', en: 'Any appointment tomorrow?' },
  restaurant: { ar: 'في توصيل؟', en: 'Do you deliver?' },
  store: { ar: 'طلبي وين صار؟', en: "Where's my order?" },
  other: { ar: 'شو أوقات الدوام؟', en: 'What are your opening hours?' },
};

const BUTTONS = {
  ar: {
    tryMe: 'جرّبني كزبون', sendExample: 'ابعت مثال', notNow: 'مش هلأ', sendIt: 'ابعثه',
    continue: 'نكمّل', endExample: 'خلص المثال', quote: 'عرض مكتوب', call: 'مكالمة',
  },
  en: {
    tryMe: 'Try me as a customer', sendExample: 'Send an example', notNow: 'Not now', sendIt: 'Send it',
    continue: 'Continue', endExample: 'End the example', quote: 'Written quote', call: 'A call',
  },
};

const CUSTOMER_TEXT_MAX = 60;

function isEn(lang) {
  return lang === 'en';
}

// A value that carries a link or a promise is left out of the line: the nudge is SHIFT's text, and it comes back
// as a «كرم:» history line (review minor).
const UNSAFE_VALUE_RE = /https?:|www\.|[a-z0-9-]+\.[a-z]{2,}\/?|خصم|تخفيض|مجان|ببلاش|وعد|ضمان|مضمون|discount|free\b|promise|guarantee/i;

/** Customer text inside a fixed line: one line, bounded, and no quote marks that would break ours. */
function cleanValue(value) {
  if (typeof value !== 'string') return '';
  if (UNSAFE_VALUE_RE.test(value)) return '';
  const flat = value.replace(/[«»"]/g, '').replace(/\s+/g, ' ').trim();
  const chars = Array.from(flat);
  return chars.length > CUSTOMER_TEXT_MAX ? chars.slice(0, CUSTOMER_TEXT_MAX).join('').trim() : flat;
}

function sectorOf(lead) {
  const s = lead && typeof lead.sector === 'string' ? lead.sector : '';
  return assets.SAMPLE_SECTORS.includes(s) ? s : 'other';
}

// «أبو أحمد» / «أم سامي» / «د. رنا» are used as given: «أستاذ أبو أحمد» reads wrong (prompt doc rule).
const OWN_TITLE_RE = /^(أبو|ابو|أم|ام|د\.|دكتور|دكتورة)\s/;

function honorific(lead, lang) {
  const name = cleanValue(lead && lead.name);
  if (!name) return '';
  if (isEn(lang)) return `${name}, `;
  return OWN_TITLE_RE.test(name) ? `${name}، ` : `أستاذ ${name}، `;
}

function businessOf(wd, lang) {
  const rp = wd.roleplay || {};
  const lead = wd.lead || {};
  return cleanValue(rp.business_name) || cleanValue(lead.business_name) || (isEn(lang) ? 'your business' : 'شغلك');
}

function interactive(text, buttons) {
  return { type: 'interactive', text, buttons, serverButtons: true };
}

function stageText(wd, lang) {
  const lead = wd.lead || {};
  const q = SUGGESTED_Q[sectorOf(lead)][isEn(lang) ? 'en' : 'ar'];
  const need = cleanValue(Array.isArray(lead.need) ? lead.need[0] : '');
  const h = honorific(lead, lang);
  // Q carries its own question mark, so the sentence ends on the quote: one question, no «؟»؟».
  if (isEn(lang)) {
    const tail = `want to see how Karam answers when a customer asks "${q}"`;
    if (need) return `${h ? h + 'about' : 'About'} what you told me (${need}) — ${tail}`;
    return h ? `${h}${tail}` : `W${tail.slice(1)}`;
  }
  const tail = `بدك أوريك كيف بيرد كرم لما الزبون يسأل «${q}»`;
  if (need) return `${h}بخصوص اللي حكيتلي عنه (${need}) — ${tail}`;
  return `${h}${tail}`;
}

/** The part the sweeper hands to deliverResult. `nudge.kind` picks the text; `nudge.stage` refines `stage`. */
function nudgePart(conversation, nudge, lang) {
  const wd = wdOf(conversation);
  const l = isEn(lang) ? 'en' : 'ar';
  const b = BUTTONS[l];
  const kind = nudge && nudge.kind;
  const stage = (nudge && nudge.stage) || (conversation && conversation.current_state) || 'opening';

  switch (kind) {
    case 'sample_touch':
      return interactive(
        isEn(lang) ? 'The example we talked about is ready — shall I send it here?' : 'المثال اللي حكينا عنه جاهز، أبعثه هون؟',
        [{ id: 'send_sample_now', title: b.sendIt }, { id: 'nudge_not_now', title: b.notNow }],
      );
    case 'roleplay_resume': {
      const business = businessOf(wd, lang);
      return interactive(
        isEn(lang)
          ? `Shall we continue the example for ${business}? Just a few questions left.`
          : `نكمّل المثال على ${business}؟ ضايل كم سؤال.`,
        [{ id: 'roleplay_continue', title: b.continue }, { id: 'end_roleplay', title: b.endExample }],
      );
    }
    case 'close_declined':
      return interactive(
        isEn(lang)
          ? "If a call doesn't suit you, I can request a written quote from the team. Would you like that?"
          : 'إذا المكالمة مش مناسبة، بطلبلك عرض مكتوب من الفريق. بدك هيك؟',
        [{ id: 'quote_written', title: b.quote }, { id: 'lead_call', title: b.call }, { id: 'nudge_not_now', title: b.notNow }],
      );
    case 'no_contact':
      return {
        type: 'text',
        text: isEn(lang)
          ? 'Before this chat closes on our side: just the business name, so the team can get back to you on this number?'
          : 'قبل ما يسكر الشات من جهتنا: اسم المحل بس، عشان الفريق يرجعلك على هالرقم؟',
      };
    default: {
      if (stage === 'sample') {
        const lead = wd.lead || {};
        const business = cleanValue(lead.business_name) || (isEn(lang) ? 'your business' : 'شغلك');
        return interactive(
          isEn(lang)
            ? `If you'd still like to see the example on ${business}, I can send it here.`
            : `إذا لسه حاب تشوف المثال على ${business}، بقدر أبعثه هون.`,
          [{ id: 'send_sample_now', title: b.sendIt }, { id: 'nudge_not_now', title: b.notNow }],
        );
      }
      const rp = wd.roleplay || {};
      if (CLOSE_NUDGE_STAGES.includes(stage) || (stage === 'roleplay' && rp.active !== true)) {
        // After the example or an objection the open question is continuing here or a call, not another
        // example: the close stage's own approved line (validators.stageFallback('close')).
        return interactive(
          isEn(lang)
            ? 'If you like, we can continue here, or I can request a short call with the team — which is easier for you?'
            : 'إذا بتحب، منكمّل هون، أو بطلبلك مكالمة قصيرة مع الفريق — أيهم أريح إلك؟',
          [{ id: 'lead_call', title: b.call }, { id: 'nudge_not_now', title: b.notNow }],
        );
      }
      const s = sectorOf(wd.lead);
      // With role-play off (SHIFT_ROLEPLAY=0 / SHIFT_PROMPT_V1=1) a «جرّبني كزبون» tap only opens a page: the
      // button says what it does (review minor).
      const first = roleplay.roleplayEnabled()
        ? { id: `sample_roleplay:${s}`, title: b.tryMe }
        : { id: `sample_page:${s}`, title: assets.REGISTRY[s][`buttons_${l}`].page };
      return interactive(stageText(wd, lang), [
        first,
        { id: 'send_sample_now', title: b.sendExample },
        { id: 'nudge_not_now', title: b.notNow },
      ]);
    }
  }
}

/** Every static button title, for buttons.assertButtons (§9.1) and the language suite. */
function staticTitles() {
  return ['ar', 'en'].flatMap((l) => Object.values(BUTTONS[l]));
}

module.exports = {
  nudgesEnabled,
  FRIENDLY,
  NUDGE_DELAY_MS,
  SAMPLE_TOUCH_MS,
  ROLEPLAY_RESUME_DELAY_MS,
  WINDOW_GUARD_MS,
  MAX_LIFETIME,
  planNudge,
  cancelReason,
  waitingOnTeam,
  nextFriendlyMinute,
  isFriendly,
  dueCheck,
  dueDecision,
  nudgePart,
  staticTitles,
  SUGGESTED_Q,
};
