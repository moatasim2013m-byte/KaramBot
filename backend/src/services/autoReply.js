'use strict';

/**
 * A customer's own WhatsApp away message must never start a machine-to-machine loop (owner, 2026-10-08:
 * staff wrote «hi» to Laraca and four seconds later their phone answered «Thank you for your message.
 * We're unavailable right now, but will respond as soon as possible.»).
 *
 * Recognising an away message by its WORDING was tried and rejected after two adversarial reviews: the
 * honest answer of a shop owner to Karam's own discovery question («شو بيصير بالرسائل بعد الدوام؟») has
 * exactly that wording («احنا مش متواجدين بعد الدوام، بنرد بأقرب وقت»), and so do urgent requests («بدي رد
 * تلقائي لمحلي بأسرع وقت»). Silencing those loses the best leads.
 *
 * What a machine does and a person almost never does: send the SAME text again, word for word, seconds
 * after we wrote. So the first away message is answered like any message (the model sees what it is), and
 * an exact repeat — of a text long enough to be a template — arriving within AWAY_WINDOW_MS of our last
 * message is stored as message_type `auto_reply`, status `skipped`, and never answered. A loop therefore
 * stops after one round.
 */

const AWAY_WINDOW_MS = 30 * 1000;
const REPEAT_LOOKBACK_MS = 7 * 24 * 3600 * 1000;
const MIN_LENGTH = 30;

// Tashkeel, tatweel, spacing and case do not make a different message.
function normalizeText(text) {
  return typeof text === 'string'
    ? text.replace(/[ً-ْٰـ]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()
    : '';
}

/** Long enough to be a template rather than «تمام» or «مرحبا». */
function templateLength(text) {
  return Array.from(normalizeText(text)).length >= MIN_LENGTH;
}

/** Sent within the window after our last message (a few seconds of clock skew allowed). */
function withinAwayWindow(inboundAtMs, lastOutboundAtMs) {
  if (!Number.isFinite(inboundAtMs) || !Number.isFinite(lastOutboundAtMs)) return false;
  const gap = inboundAtMs - lastOutboundAtMs;
  return gap >= -5000 && gap <= AWAY_WINDOW_MS;
}

module.exports = { normalizeText, templateLength, withinAwayWindow, AWAY_WINDOW_MS, REPEAT_LOOKBACK_MS, MIN_LENGTH };
