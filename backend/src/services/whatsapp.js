const axios = require('axios');
const crypto = require('crypto');
const { isWithinServiceWindow } = require('../utils/serviceWindow');

// Read on every call (not a module constant) so a version bump is an env change, not a
// deploy. v19.0 is expired and v20.0 expires 2026-09-24 (decision D10).
function graphVersion() {
  return process.env.GRAPH_API_VERSION || 'v24.0';
}

function graphBase() {
  return `https://graph.facebook.com/${graphVersion()}`;
}

// D17: Meta echoes this string in every status webhook for the message, so a status can be matched to
// the intent row that caused the send without guessing by recipient and time. Max 512 characters; a
// longer value is dropped rather than cut, because a cut id would match no intent.
const CALLBACK_DATA_MAX = 512;

function withCallbackData(payload, callbackData) {
  if (callbackData === undefined || callbackData === null || callbackData === '') return payload;
  const value = String(callbackData);
  if (value.length > CALLBACK_DATA_MAX) {
    console.error(`[wa] biz_opaque_callback_data over ${CALLBACK_DATA_MAX} chars — not sent`);
    return payload;
  }
  return { ...payload, biz_opaque_callback_data: value };
}

/**
 * Validate Meta webhook signature
 */
function validateSignature(rawBody, signature) {
  const appSecret = process.env.META_APP_SECRET;
  if (!appSecret) return true; // skip in dev if not set

  const expected = 'sha256=' + crypto
    .createHmac('sha256', appSecret)
    .update(rawBody)
    .digest('hex');

  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Interactive limits ──────────────────────────────────────────────────────
// Meta rejects the whole message when one limit is broken, and it counts characters,
// not UTF-16 units — «اليوم 4–6» must pass, so lengths are code points.

const codePoints = (s) => Array.from(String(s)).length;

function limitsError(message) {
  const err = new Error(`Interactive limits: ${message}`);
  err.code = 'INTERACTIVE_LIMITS';
  return err;
}

function assertBodyLimits(body, footer) {
  if (typeof body !== 'string' || codePoints(body) < 1 || codePoints(body) > 1024) {
    throw limitsError('body must be 1..1024 characters');
  }
  if (footer !== undefined && footer !== null && (typeof footer !== 'string' || codePoints(footer) > 60)) {
    throw limitsError('footer must be at most 60 characters');
  }
}

/**
 * Throws (err.code = 'INTERACTIVE_LIMITS') when a reply-button message would be rejected by Meta.
 */
function assertInteractiveLimits(buttons, { body = '', footer } = {}) {
  if (!Array.isArray(buttons) || buttons.length < 1 || buttons.length > 3) {
    throw limitsError('buttons must be an array of 1..3');
  }
  const ids = new Set();
  for (const b of buttons) {
    if (!b || typeof b.id !== 'string' || b.id.length === 0 || b.id.length > 256) {
      throw limitsError('button id must be 1..256 characters');
    }
    if (ids.has(b.id)) throw limitsError(`duplicate button id ${b.id}`);
    ids.add(b.id);
    if (typeof b.title !== 'string' || codePoints(b.title) < 1 || codePoints(b.title) > 20) {
      throw limitsError(`button title must be 1..20 characters (${b.title})`);
    }
  }
  assertBodyLimits(body, footer);
}

// ─── Legacy throwing senders (restaurant / clinic / staff routes) ────────────

// D24: a restaurant/clinic row still `processing` after 2 minutes is re-run by the sweeper. Without a
// timeout a hung Graph connection could outlive that, and the re-run would send (or order) twice while
// the original delivery is still alive. Well under 2 minutes, with room for the AI calls around it.
const LEGACY_TIMEOUT_MS = 15000;

/**
 * Send a plain text message
 */
async function sendTextMessage(phoneNumberId, accessToken, to, text, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: LEGACY_TIMEOUT_MS,
  });

  return res.data;
}

/**
 * Send interactive button message (up to 3 buttons)
 */
async function sendButtonMessage(phoneNumberId, accessToken, to, bodyText, buttons, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const replies = buttons.map((b, i) => ({ id: b.id || `btn_${i}`, title: b.title }));
  assertInteractiveLimits(replies, { body: bodyText });
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: replies.map((reply) => ({ type: 'reply', reply })),
      },
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Send interactive list message
 */
async function sendListMessage(phoneNumberId, accessToken, to, bodyText, buttonLabel, sections, { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  assertBodyLimits(bodyText);
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: bodyText },
      action: { button: buttonLabel, sections },
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
  });
  return res.data;
}

/**
 * Send a WhatsApp template message.
 * Used for outbound messages outside the 24-hour customer service window.
 *
 * @param {string} phoneNumberId
 * @param {string} accessToken
 * @param {string} to - recipient phone number
 * @param {string} templateName - approved template name in Meta
 * @param {string} languageCode - e.g. 'ar', 'en_US'
 * @param {Array}  components - header/body/button variable components (optional)
 */
async function sendTemplateMessage(phoneNumberId, accessToken, to, templateName, languageCode = 'ar', components = [], { callbackData } = {}) {
  const url = `${graphBase()}/${phoneNumberId}/messages`;
  const payload = withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: languageCode },
      ...(components.length > 0 && { components }),
    },
  }, callbackData);

  const res = await axios.post(url, payload, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

/**
 * Mark message as read. With {typing:true} (and WA_TYPING_INDICATOR=1) also shows the typing
 * indicator, which Meta dismisses after ~25 s or when we reply.
 * Never throws — a failed read receipt must not block a reply.
 */
async function markAsRead(phoneNumberId, accessToken, messageId, { typing = false } = {}) {
  try {
    const payload = {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: messageId,
    };
    if (typing === true && process.env.WA_TYPING_INDICATOR === '1') {
      payload.typing_indicator = { type: 'text' };
    }
    await axios.post(`${graphBase()}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: LEGACY_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false; // non-critical
  }
}

// ─── Structured senders (SHIFT) ──────────────────────────────────────────────
// These never throw: the reply batcher needs to tell "Meta refused" apart from "we don't
// know whether it went out" (ambiguous) so it never double-sends and never goes silent.
//
// D18: Graph has no idempotency key, so a resend after an unknown outcome can reach the customer
// twice. Only results that prove Graph did not accept the message are failures (and only a request
// that never left this host is retried at once); everything else is `ambiguous` and is settled by
// the echoed status webhook or, after 2 minutes, by replyBatcher.reconcileUnconfirmedIntents.

const BILLING_CODES = new Set([131042]);
const BILLING_SUBCODES = new Set([2494010]);
const RATE_LIMIT_CODES = new Set([130429, 131056, 80007]);
const INVALID_RECIPIENT_CODES = new Set([131026, 131030]);
// The request may have reached Meta before the socket died: resending could duplicate.
const AMBIGUOUS_ERRNOS = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET']);
// The request never left this host: safe to retry.
const NETWORK_ERRNOS = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

/**
 * Map an axios error to {reason, code, httpStatus, retryable}.
 */
function classifySendError(err) {
  const graphError = err?.response?.data?.error || null;
  const code = graphError && graphError.code !== undefined ? graphError.code : null;
  const subcode = graphError ? graphError.error_subcode : undefined;
  const httpStatus = err?.response?.status ?? null;
  const result = (reason, retryable = false) => ({ reason, code, httpStatus, retryable });

  if (BILLING_CODES.has(code) || BILLING_SUBCODES.has(subcode)) return result('billing');
  if (code === 131047) return result('window');
  if (RATE_LIMIT_CODES.has(code)) return result('rate_limit');
  if (INVALID_RECIPIENT_CODES.has(code)) return result('invalid_recipient');
  if (code === 190 || httpStatus === 401 || httpStatus === 403) return result('auth');
  if (AMBIGUOUS_ERRNOS.has(err?.code)) return result('ambiguous');
  // Checked before the generic "request but no response" rule: axios sets err.request for
  // DNS/refused errors too, and those are known not to have been delivered.
  if (NETWORK_ERRNOS.has(err?.code)) return result('network', true);
  if (err?.request && !err?.response) return result('ambiguous');
  // GPT-6 #4: a gateway 502/503 can be returned after Graph accepted the POST. Without a documented
  // rejection code above, a 5xx proves nothing about delivery.
  if (httpStatus !== null && httpStatus >= 500) return result('ambiguous');
  return result('rejected');
}

async function postStructured(phoneNumberId, accessToken, payload, timeoutMs) {
  try {
    const res = await axios.post(`${graphBase()}/${phoneNumberId}/messages`, payload, {
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      timeout: timeoutMs,
    });
    const id = res?.data?.messages?.[0]?.id || null;
    return { ok: true, id, error: null, reason: null, code: null, httpStatus: res?.status ?? 200, retryable: false };
  } catch (err) {
    const { reason, code, httpStatus, retryable } = classifySendError(err);
    const error = err?.response?.data?.error?.message || err?.message || 'send failed';
    console.error(`[wa] send failed reason=${reason} code=${code} http=${httpStatus}: ${error}`);
    return { ok: false, id: null, error, reason, code, httpStatus, retryable };
  }
}

/**
 * Send a text message. Resolves to a SendResult; never throws.
 */
async function sendText(phoneNumberId, accessToken, to, text, { timeoutMs = 10000, callbackData } = {}) {
  return postStructured(phoneNumberId, accessToken, withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body: text },
  }, callbackData), timeoutMs);
}

/**
 * Send reply buttons. A payload Meta would reject returns reason 'invalid_payload' without an
 * HTTP call. Resolves to a SendResult; never throws.
 */
async function sendInteractiveButtons(phoneNumberId, accessToken, to, body, buttons, { timeoutMs = 10000, callbackData } = {}) {
  try {
    assertInteractiveLimits(buttons, { body });
  } catch (err) {
    console.error(`[wa] invalid interactive payload: ${err.message}`);
    return { ok: false, id: null, error: err.message, reason: 'invalid_payload', code: null, httpStatus: null, retryable: false };
  }
  return postStructured(phoneNumberId, accessToken, withCallbackData({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: body },
      action: {
        buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })),
      },
    },
  }, callbackData), timeoutMs);
}

// ─── PR2 structured parts (images, header/footer buttons, lists, CTA URLs) ────
// The reply batcher's part sender is the only caller (D17): it creates the intent row first and passes
// its id as callbackData. Builders are pure so tests can deep-equal the exact Graph payloads.

const TEXT_BODY_MAX = 4096;
const CAPTION_MAX = 1024;
const HEADER_TEXT_MAX = 60;
const LIST_ROWS_MAX = 10;
const LIST_ROW_TITLE_MAX = 24;
const LIST_ROW_DESCRIPTION_MAX = 72;
// Meta's documented list limits: row id ≤ 200, section title ≤ 24, ≤ 10 sections.
const LIST_ROW_ID_MAX = 200;
const LIST_SECTION_TITLE_MAX = 24;
const LIST_SECTIONS_MAX = 10;
const LABEL_MAX = 20; // list button label and CTA display text

const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isHttpsUrl = (v) => typeof v === 'string' && /^https:\/\/[^\s]+$/.test(v);

function envelope(to, type, callbackData, body) {
  return withCallbackData({ messaging_product: 'whatsapp', recipient_type: 'individual', to, type, ...body }, callbackData);
}

// A media object carries either a hosted link or an uploaded media id; never both.
function mediaRef(image) {
  if (image && isNonEmptyString(image.id)) return { id: image.id };
  return { link: image && image.link };
}

function headerPayload(header) {
  if (!header) return null;
  if (header.type === 'image') return { type: 'image', image: mediaRef(header.image) };
  return { type: 'text', text: header.text };
}

function interactiveEnvelope(to, callbackData, { kind, header, text, footer, action }) {
  const interactive = { type: kind };
  const h = headerPayload(header);
  if (h) interactive.header = h;
  interactive.body = { text };
  if (footer !== undefined && footer !== null && footer !== '') interactive.footer = { text: footer };
  interactive.action = action;
  return envelope(to, 'interactive', callbackData, { interactive });
}

function buildImagePayload(to, { image, caption } = {}, { callbackData } = {}) {
  const media = mediaRef(image);
  if (caption !== undefined && caption !== null && caption !== '') media.caption = caption;
  return envelope(to, 'image', callbackData, { image: media });
}

function buildButtonsPayload(to, { text, buttons, header, footer } = {}, { callbackData } = {}) {
  return interactiveEnvelope(to, callbackData, {
    kind: 'button',
    header,
    text,
    footer,
    action: { buttons: (buttons || []).map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
  });
}

function buildListPayload(to, { text, buttonLabel, sections, header, footer } = {}, { callbackData } = {}) {
  const cleanSections = (sections || []).map((s) => {
    const section = {};
    if (isNonEmptyString(s.title)) section.title = s.title;
    section.rows = (s.rows || []).map((r) => {
      const row = { id: r.id, title: r.title };
      if (isNonEmptyString(r.description)) row.description = r.description;
      return row;
    });
    return section;
  });
  return interactiveEnvelope(to, callbackData, {
    kind: 'list', header, text, footer, action: { button: buttonLabel, sections: cleanSections },
  });
}

function buildCtaUrlPayload(to, { text, displayText, url, header, footer } = {}, { callbackData } = {}) {
  return interactiveEnvelope(to, callbackData, {
    kind: 'cta_url', header, text, footer, action: { name: 'cta_url', parameters: { display_text: displayText, url } },
  });
}

function assertOptionalText(value, max, what) {
  if (value === undefined || value === null || value === '') return;
  if (typeof value !== 'string' || codePoints(value) > max) throw limitsError(`${what} must be at most ${max} characters`);
}

function assertMedia(image, what) {
  const hasId = image && isNonEmptyString(image.id);
  const hasLink = image && isHttpsUrl(image.link);
  if (!hasId && !hasLink) throw limitsError(`${what} needs an https:// link or a media id`);
}

// Only text headers go on lists and CTA URLs in PR2; reply buttons may also carry an image header.
function assertHeader(header, { allowImage }) {
  if (header === undefined || header === null) return;
  if (header.type === 'image' && allowImage) {
    assertMedia(header.image, 'image header');
    return;
  }
  if (header.type === 'text') {
    if (!isNonEmptyString(header.text) || codePoints(header.text) > HEADER_TEXT_MAX) {
      throw limitsError(`header text must be 1..${HEADER_TEXT_MAX} characters`);
    }
    return;
  }
  throw limitsError(`unsupported header type ${header && header.type}`);
}

function assertListLimits(part) {
  assertBodyLimits(part.text, part.footer);
  assertHeader(part.header, { allowImage: false });
  if (!isNonEmptyString(part.buttonLabel) || codePoints(part.buttonLabel) > LABEL_MAX) {
    throw limitsError(`list button label must be 1..${LABEL_MAX} characters`);
  }
  const sections = part.sections;
  if (!Array.isArray(sections) || sections.length < 1 || sections.length > LIST_SECTIONS_MAX) {
    throw limitsError(`sections must be an array of 1..${LIST_SECTIONS_MAX}`);
  }
  const ids = new Set();
  let rows = 0;
  for (const section of sections) {
    if (!section || !Array.isArray(section.rows) || section.rows.length < 1) throw limitsError('every section needs rows');
    // Meta requires a title on every section once there is more than one.
    if (sections.length > 1 && !isNonEmptyString(section.title)) throw limitsError('section title required with several sections');
    assertOptionalText(section.title, LIST_SECTION_TITLE_MAX, 'section title');
    for (const row of section.rows) {
      rows += 1;
      if (!row || typeof row.id !== 'string' || row.id.length < 1 || row.id.length > LIST_ROW_ID_MAX) {
        throw limitsError(`row id must be 1..${LIST_ROW_ID_MAX} characters`);
      }
      if (ids.has(row.id)) throw limitsError(`duplicate row id ${row.id}`);
      ids.add(row.id);
      if (!isNonEmptyString(row.title) || codePoints(row.title) > LIST_ROW_TITLE_MAX) {
        throw limitsError(`row title must be 1..${LIST_ROW_TITLE_MAX} characters (${row.title})`);
      }
      assertOptionalText(row.description, LIST_ROW_DESCRIPTION_MAX, 'row description');
    }
  }
  if (rows > LIST_ROWS_MAX) throw limitsError(`a list holds at most ${LIST_ROWS_MAX} rows`);
}

/**
 * Throws (err.code = 'INTERACTIVE_LIMITS') when Graph would reject the part (contract §1.4 limits).
 * Lengths are code points, the unit Meta counts.
 */
function assertStructuredLimits(part) {
  if (!part || typeof part !== 'object') throw limitsError('part must be an object');
  switch (part.type) {
    case 'text':
      if (!isNonEmptyString(part.text) || codePoints(part.text) > TEXT_BODY_MAX) {
        throw limitsError(`text body must be 1..${TEXT_BODY_MAX} characters`);
      }
      return;
    case 'interactive':
      assertInteractiveLimits(part.buttons, { body: part.text, footer: part.footer });
      assertHeader(part.header, { allowImage: true });
      return;
    case 'list':
      assertListLimits(part);
      return;
    case 'cta_url':
      assertBodyLimits(part.text, part.footer);
      assertHeader(part.header, { allowImage: false });
      if (!isNonEmptyString(part.displayText) || codePoints(part.displayText) > LABEL_MAX) {
        throw limitsError(`display text must be 1..${LABEL_MAX} characters`);
      }
      if (!isHttpsUrl(part.url)) throw limitsError('url must start with https://');
      return;
    case 'image':
      assertMedia(part.image, 'image');
      assertOptionalText(part.text, CAPTION_MAX, 'caption');
      return;
    default:
      throw limitsError(`unknown part type ${part.type}`);
  }
}

function invalidPayload(err) {
  console.error(`[wa] invalid structured payload: ${err.message}`);
  return { ok: false, id: null, error: err.message, reason: 'invalid_payload', code: null, httpStatus: null, retryable: false };
}

// Validate, build, POST through postStructured so the D18 classification is shared by every type.
async function sendValidated(phoneNumberId, accessToken, part, build, timeoutMs) {
  let payload;
  try {
    assertStructuredLimits(part);
    payload = build();
  } catch (err) {
    return invalidPayload(err);
  }
  return postStructured(phoneNumberId, accessToken, payload, timeoutMs);
}

async function sendImage(phoneNumberId, accessToken, to, part, { callbackData, timeoutMs = 10000 } = {}) {
  const p = { ...part, type: 'image' };
  return sendValidated(phoneNumberId, accessToken, p,
    () => buildImagePayload(to, { image: p.image, caption: p.text }, { callbackData }), timeoutMs);
}

async function sendButtons(phoneNumberId, accessToken, to, part, { callbackData, timeoutMs = 10000 } = {}) {
  const p = { ...part, type: 'interactive' };
  return sendValidated(phoneNumberId, accessToken, p, () => buildButtonsPayload(to, p, { callbackData }), timeoutMs);
}

async function sendList(phoneNumberId, accessToken, to, part, { callbackData, timeoutMs = 10000 } = {}) {
  const p = { ...part, type: 'list' };
  return sendValidated(phoneNumberId, accessToken, p, () => buildListPayload(to, p, { callbackData }), timeoutMs);
}

async function sendCtaUrl(phoneNumberId, accessToken, to, part, { callbackData, timeoutMs = 10000 } = {}) {
  const p = { ...part, type: 'cta_url' };
  return sendValidated(phoneNumberId, accessToken, p, () => buildCtaUrlPayload(to, p, { callbackData }), timeoutMs);
}

/**
 * Send any WorkflowResult part (contract §1.4). `modelLine`, `ack`, `fallback`, `delayMs` and
 * `serverButtons` are metadata for the batcher and never reach Graph. Never throws.
 */
async function sendStructured(phoneNumberId, accessToken, to, part, { callbackData, timeoutMs = 10000 } = {}) {
  const opts = { callbackData, timeoutMs };
  switch (part && part.type) {
    case 'text':
      try {
        assertStructuredLimits(part);
      } catch (err) {
        return invalidPayload(err);
      }
      return sendText(phoneNumberId, accessToken, to, part.text, opts);
    case 'interactive':
      return sendButtons(phoneNumberId, accessToken, to, part, opts);
    case 'list':
      return sendList(phoneNumberId, accessToken, to, part, opts);
    case 'cta_url':
      return sendCtaUrl(phoneNumberId, accessToken, to, part, opts);
    case 'image':
      return sendImage(phoneNumberId, accessToken, to, part, opts);
    default:
      return invalidPayload(limitsError(`unknown part type ${part && part.type}`));
  }
}

const str = (v) => (typeof v === 'string' ? v : '');

/**
 * What the Inbox thread shows for a part (the intent row's message_type and text_body, §4.3).
 * Never throws; an unknown part is summarised by its text.
 */
function partSummary(part, lang = 'ar') {
  const imageMark = lang === 'en' ? '[image] ' : '[صورة] ';
  const p = part && typeof part === 'object' ? part : {};
  const text = str(p.text);
  const withLine = (line) => (line ? (text ? `${text}\n${line}` : line) : text);
  switch (p.type) {
    case 'interactive': {
      const titles = (Array.isArray(p.buttons) ? p.buttons : []).map((b) => `[${str(b && b.title)}]`).join(' ');
      const prefix = p.header && p.header.type === 'image' ? imageMark : '';
      return { message_type: 'interactive', text_body: prefix + withLine(titles) };
    }
    case 'list': {
      const rows = (Array.isArray(p.sections) ? p.sections : [])
        .flatMap((s) => (s && Array.isArray(s.rows) ? s.rows : []))
        .map((r) => str(r && r.title));
      return { message_type: 'interactive', text_body: withLine(`[${str(p.buttonLabel)}]: ${rows.join(' · ')}`) };
    }
    case 'cta_url':
      return { message_type: 'interactive', text_body: withLine(`[${str(p.displayText)}] ${str(p.url)}`) };
    case 'image':
      return { message_type: 'image', text_body: imageMark + text };
    default:
      return { message_type: 'text', text_body: text };
  }
}

// ─── Media download (SHIFT_MEDIA=1; a GET, not an outbound message) ──────────

function mediaErrorText(err) {
  if (err && /maxContentLength/i.test(err.message || '')) return 'too_large';
  if (err && AMBIGUOUS_ERRNOS.has(err.code)) return 'timeout';
  if (err && err.response && err.response.status) return `http_${err.response.status}`;
  return (err && err.message) || 'request failed';
}

/** Resolve a WhatsApp media id to its short-lived download URL. Never throws. */
async function getMediaInfo(mediaId, accessToken, { timeoutMs = 8000 } = {}) {
  const fail = (error) => ({ ok: false, url: null, mime_type: null, file_size: null, error });
  if (!isNonEmptyString(mediaId) || !/^[A-Za-z0-9_.-]+$/.test(mediaId)) return fail('invalid_media_id');
  try {
    const res = await axios.get(`${graphBase()}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: timeoutMs,
    });
    const data = (res && res.data) || {};
    if (!isHttpsUrl(data.url)) return fail('no_url');
    return { ok: true, url: data.url, mime_type: data.mime_type || null, file_size: data.file_size ?? null };
  } catch (err) {
    const error = mediaErrorText(err);
    console.error(`[wa] media info failed: ${error}`);
    return fail(error);
  }
}

/**
 * Download media bytes. The bearer token goes only to an https URL, and the body is capped so a large
 * voice note cannot exhaust memory. Never throws.
 */
async function downloadMedia(url, accessToken, { maxBytes = 5 * 1024 * 1024, timeoutMs = 10000 } = {}) {
  const fail = (error) => ({ ok: false, buffer: null, mime_type: null, error });
  if (!isHttpsUrl(url)) return fail('invalid_url');
  try {
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
      maxContentLength: maxBytes,
      timeout: timeoutMs,
    });
    const buffer = Buffer.from((res && res.data) || []);
    // maxContentLength is not enforced by every adapter; check again on what arrived.
    if (buffer.length > maxBytes) return fail('too_large');
    const type = res && res.headers && (res.headers['content-type'] || res.headers['Content-Type']);
    return { ok: true, buffer, mime_type: type ? String(type).split(';')[0].trim() : null };
  } catch (err) {
    const error = mediaErrorText(err);
    console.error(`[wa] media download failed: ${error}`);
    return fail(error);
  }
}

/**
 * Parse inbound message from webhook payload
 */
function parseInboundMessage(entry) {
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  if (!value) return null;

  const phoneNumberId = value.metadata?.phone_number_id;
  const contacts = value.contacts;
  const messages = value.messages;
  const statuses = value.statuses;

  return { phoneNumberId, contacts, messages, statuses };
}

/**
 * Normalize phone: remove +, spaces
 */
function normalizePhone(phone) {
  return phone?.replace(/\D/g, '') || phone;
}

module.exports = {
  graphVersion,
  graphBase,
  validateSignature,
  sendTextMessage,
  sendButtonMessage,
  sendListMessage,
  sendTemplateMessage,
  markAsRead,
  assertInteractiveLimits,
  sendText,
  sendInteractiveButtons,
  classifySendError,
  CALLBACK_DATA_MAX,
  buildImagePayload,
  buildButtonsPayload,
  buildListPayload,
  buildCtaUrlPayload,
  assertStructuredLimits,
  sendImage,
  sendButtons,
  sendList,
  sendCtaUrl,
  sendStructured,
  partSummary,
  getMediaInfo,
  downloadMedia,
  parseInboundMessage,
  normalizePhone,
  // The window rule lives in one place; this re-export keeps old imports working.
  isWithinServiceWindow,
};
