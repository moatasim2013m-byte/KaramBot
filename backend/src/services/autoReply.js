'use strict';

/**
 * A WhatsApp Business away/greeting message is not a customer talking (owner, 2026-10-08: Laraca's phone
 * answered staff's «hi» four seconds later with «Thank you for your message. We're unavailable right now,
 * but will respond as soon as possible.»). Answering it — with the bot's reply, the «waiting for the team»
 * note, or a staff alert — talks to a machine, and the machine may answer back: a loop on two paid numbers.
 *
 * Such a row is kept (staff see it in the Inbox) but marked `skipped` with raw_payload.auto_reply, so no
 * reply, note, alert or follow-up sweep ever acts on it.
 *
 * Deliberately narrow: a real customer's «شكرا» or «thanks, I'll get back to you» must never be silenced.
 * A message counts only when it says BOTH that nobody is available (or that it is automatic) AND that a
 * reply will come later — the shape every away message has and a person writing to a sales bot does not.
 */

// It says it is automatic.
const AUTOMATIC_RE = /\bauto(?:matic|mated)?[- ]?(?:reply|response|message)\b|\bthis is an automated\b|رد\s*(?:آلي|الي|تلقائي)|رسالة\s*(?:آلية|الية|تلقائية)|هذه رسالة تلقائية/i;
// Nobody is there right now.
const UNAVAILABLE_RE = /\b(?:we(?:'|’)?re|we are|i(?:'|’)?m|i am|currently)\s+(?:currently\s+)?(?:unavailable|away|closed|offline|out of (?:the )?office|not available)\b|\bout of office\b|\boutside (?:our )?(?:business|working|office) hours\b|\bour (?:business|working|office) hours are\b|غير متاح(?:ين|ون)?|غير متواجد(?:ين|ون)?|مش متواجد(?:ين)?|خارج (?:أوقات|اوقات|ساعات) (?:الدوام|العمل)|مغلق(?:ين)? (?:حال(?:ي)?ا|الآن|هلأ)|مسكرين هلأ|نحن في إجازة|في عطلة/i;
// A reply will come later.
const LATER_RE = /\b(?:will|we'll|we’ll|i'll|i’ll)\s+(?:respond|reply|get back|be in touch|contact you|answer)\b|\bas soon as (?:possible|we can)\b|\bat the earliest\b|\bshortly\b|سنرد|سوف نرد|سيتم الرد|سنقوم بالرد|سنتواصل|سنعاود|منرد عليك|بنرد عليك|رح نرد|بأقرب وقت|في أقرب وقت|باقرب وقت|في اقرب وقت|حال تواجدنا|عند عودتنا/i;
// The thank-you opening most templates start with («شكراً لتواصلك…», "Thanks for your message").
const THANKS_RE = /\bthank(?:s| you)\s+for\s+(?:your message|contacting|reaching out|messaging|getting in touch)\b|شكرا?ً?\s*(?:لك\s*)?(?:لتواصلك|على تواصلك|لرسالتك|على رسالتك|لاتصالك|لتواصلكم|على تواصلكم)/i;

const MAX_LEN = 600;

/** True only for the away/greeting shape; never throws. */
function isAutoReply(text) {
  if (typeof text !== 'string') return false;
  const s = text.trim();
  if (!s || s.length > MAX_LEN) return false;
  if (AUTOMATIC_RE.test(s)) return true;
  if (UNAVAILABLE_RE.test(s) && (LATER_RE.test(s) || THANKS_RE.test(s))) return true;
  return THANKS_RE.test(s) && LATER_RE.test(s) && /\b(?:we|our|team)\b|سنرد|سيتم الرد|سنتواصل|منرد|بنرد/i.test(s);
}

module.exports = { isAutoReply };
