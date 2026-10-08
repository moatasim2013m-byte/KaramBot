'use strict';

/**
 * A customer's own WhatsApp Business away message is not the customer talking (owner, 2026-10-08: staff
 * wrote «hi» to Laraca and four seconds later their phone answered «Thank you for your message. We're
 * unavailable right now, but will respond as soon as possible.»). Answering it — with a bot reply, the
 * «waiting for the team» note or a staff alert — talks to a machine that may answer back.
 *
 * Two conditions, both required (an adversarial review showed wording alone silences real people:
 * «ليش ما حدا رد الي؟», «بدي رد تلقائي لمحلي», a shop owner describing their own hours):
 *   1. TIMING — it arrives within AWAY_WINDOW_MS of a message we sent (staff, bot or template). WhatsApp
 *      sends an away message within seconds; a person rarely answers that fast with this shape.
 *   2. SHAPE — it says that "we" are unavailable / it is automatic / the message was received, AND that a
 *      reply will come later. A mention of «رد آلي» or "auto reply" on its own never counts.
 *
 * Such a row is stored as message_type `auto_reply`, status `skipped`: staff see it in the Inbox, and no
 * reply, note, alert, nudge, follow-up or language choice ever treats it as the customer writing.
 */

const AWAY_WINDOW_MS = 30 * 1000;
const MAX_LEN = 1200;

// Tashkeel and tatweel vary by keyboard («شكرًا» vs «شكراً», «شكـــراً»): stripped before matching.
const DIACRITICS_RE = /[ً-ْٰـ]/g;

// "We" are not there. A first-person "I" is a person, not a business's away setting.
const UNAVAILABLE_RE = new RegExp([
  "\\b(?:we(?:'|’)?re|we are|our (?:team|office|shop|store|clinic) (?:is|are))\\s+(?:currently\\s+|now\\s+)?(?:unavailable|away|closed|offline|out of (?:the )?office|not available|on (?:a )?(?:holiday|vacation|leave))\\b",
  '\\b(?:the )?(?:office|shop|store|clinic) is (?:currently )?closed\\b',
  '\\boutside (?:our )?(?:business|working|office) hours\\b',
  'غير متاحين', 'غير متوفرين', 'غير متواجدين', 'مش متواجدين', 'مش موجودين', 'مش متاحين', 'مو متواجدين',
  'خارج (?:أوقات|اوقات|ساعات) (?:الدوام|العمل)', 'المحل مسكر', 'المكتب مغلق', 'المحل مغلق', 'العيادة مغلقة',
  'نحن مغلقون', 'نحن مغلقين', 'احنا مسكرين', 'احنا قافلين', 'ما في حدا متواجد', 'لا يوجد احد متاح',
  'نحن في (?:إجازة|اجازة|عطلة)', 'احنا (?:بإجازة|باجازة|بعطلة)',
].join('|'), 'i');

// Explicitly automatic or "received" — only ever counted together with a "later" phrase.
const AUTOMATIC_RE = /\b(?:this is an )?auto(?:matic|mated)? (?:reply|response|message)\b|\bwe (?:have )?received your message\b|رسالة (?:آلية|تلقائية)|رد (?:آلي|تلقائي)|تم استلام رسالتك|وصلتنا رسالتك/i;

// A thank-you opening for the message (business voice).
const THANKS_RE = /\bthanks? (?:you )?for (?:your message|contacting us|reaching out|messaging us|getting in touch)\b|شكرا (?:لك )?(?:لتواصلك|على تواصلك|لرسالتك|على رسالتك|لتواصلكم|على تواصلكم|لتواصل حضرتك)|نشكرك(?:م)? (?:على|ل)/i;

// "We" will reply later.
const LATER_RE = new RegExp([
  "\\b(?:we will|we(?:'|’)ll|our team will|someone will|one of our [a-z]+ will)\\s+(?:respond|reply|get back|be in touch|contact you|answer)\\b",
  '\\bas soon as (?:possible|we can|we(?:\'|’)re back)\\b', '\\bat the earliest\\b',
  // «…out of the office and will get back to you shortly»: the "we" is dropped after «and».
  '\\band will (?:respond|reply|get back|be in touch|contact you|answer)\\b',
  'سنرد', 'سوف نرد', 'سيتم الرد', 'سنقوم بالرد', 'سنتواصل', 'سيتم التواصل', 'سنعاود', 'سيقوم (?:أحد|احد|فريقنا)',
  'منرد عليك', 'بنرد عليك', 'رح نرد', 'هنرد', 'رح نرجعلك', 'بنرجعلك', 'منرجعلك', 'بنتواصل معك',
  '(?:في|ب)(?:أ|ا)قرب وقت', '(?:في|ب)(?:أ|ا)سرع وقت', 'حال (?:تواجدنا|عودتنا)', 'عند عودتنا', 'أول ما نفتح', 'اول ما نفتح',
].join('|'), 'i');

/** The away-message SHAPE (condition 2). Never throws. */
function looksLikeAwayText(text) {
  if (typeof text !== 'string') return false;
  const s = text.replace(DIACRITICS_RE, '').trim();
  if (!s || s.length > MAX_LEN) return false;
  if (!LATER_RE.test(s)) return false;
  return UNAVAILABLE_RE.test(s) || AUTOMATIC_RE.test(s) || THANKS_RE.test(s);
}

/** Condition 1: sent within the window after our last message (clock skew of a few seconds allowed). */
function withinAwayWindow(inboundAtMs, lastOutboundAtMs) {
  if (!Number.isFinite(inboundAtMs) || !Number.isFinite(lastOutboundAtMs)) return false;
  const gap = inboundAtMs - lastOutboundAtMs;
  return gap >= -5000 && gap <= AWAY_WINDOW_MS;
}

module.exports = { looksLikeAwayText, withinAwayWindow, AWAY_WINDOW_MS };
