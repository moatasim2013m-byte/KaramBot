'use strict';

/**
 * Voice-note transcription and photo text reading for the SHIFT bot (contract §8.4). Off unless
 * SHIFT_MEDIA=1 (D13): the privacy page needs its media sentence first.
 *
 * Only downloads (GET) happen here — never a send. The Gemini SDK is called directly with inline data
 * (§14 #9) so ai/provider.js and the restaurant/clinic call shape stay untouched. Every failure leaves
 * the row with status 'failed' and the PR1 placeholder path applies: a broken download or a slow model
 * can never cost the customer their reply.
 *
 * The transcript is customer text. context.js fences it like any inbound message.
 */

const whatsapp = require('../../services/whatsapp');
const { resolveModel } = require('../../ai/provider');
const { decrypt } = require('../../utils/tokenCrypto');

const MEDIA_KINDS = ['audio', 'image'];
const MAX_PER_BATCH = 2;
const DEFAULT_DEADLINE_MS = 8000;
const MAX_BYTES = { audio: 2 * 1024 * 1024, image: 5 * 1024 * 1024 };
const TEXT_MAX = 1000;
const EMPTY_MARKERS = ['[غير واضح]', '[بلا نص]'];

const PROMPT = {
  audio: 'فرّغ الرسالة الصوتية حرفيًا بلغتها بدون أي إضافة. إذا ما فيها كلام واضح اكتب: [غير واضح]',
  image: 'اكتب النص الظاهر بالصورة حرفيًا (أسماء أصناف وأسعار وأوقات إن وجدت) بأسطر قصيرة. لا تصف الصورة ولا تستنتج. إذا ما في نص اكتب: [بلا نص]',
};

// Graph's defaults when neither the download nor the webhook named a type.
const DEFAULT_MIME = { audio: 'audio/ogg', image: 'image/jpeg' };

function mediaEnabled(env = process.env) {
  return !!env && env.SHIFT_MEDIA === '1';
}

function existingMedia(row) {
  return (row && row.shift_media) || (row && row.raw_payload && row.raw_payload.shift_media) || null;
}

function isCandidate(row) {
  return !!row
    && MEDIA_KINDS.includes(row.message_type)
    && typeof row.media_id === 'string' && row.media_id
    && !existingMedia(row);
}

function baseMime(value) {
  return typeof value === 'string' && value.trim() ? value.split(';')[0].trim().toLowerCase() : null;
}

function cutChars(text, max) {
  const chars = Array.from(text);
  return chars.length > max ? chars.slice(0, max).join('') : text;
}

function resolveToken(business, accessToken) {
  if (accessToken) return accessToken;
  try {
    return business && business.wa_access_token ? decrypt(business.wa_access_token) : null;
  } catch (err) {
    console.error(`[media] token decrypt failed business=${business && business.id}: ${err.message}`);
    return null;
  }
}

class BudgetError extends Error {}

/** Rejects after `ms`, clearing its timer when the work settles first. */
function withBudget(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new BudgetError(`media budget exhausted after ${ms}ms`)), Math.max(0, ms));
  });
  return Promise.race([Promise.resolve(promise), timeout]).finally(() => clearTimeout(timer));
}

function logUsage(fields) {
  console.log('[ai] ' + JSON.stringify(fields));
}

async function readRow(row, token, remainingMs) {
  const type = row.message_type;
  const started = Date.now();
  const left = () => remainingMs - (Date.now() - started);

  const info = await withBudget(whatsapp.getMediaInfo(row.media_id, token, { timeoutMs: Math.max(1, left()) }), left());
  if (!info || !info.ok) return { status: 'failed', text: null, error: (info && info.error) || 'media_info' };
  if (Number(info.file_size) > MAX_BYTES[type]) return { status: 'failed', text: null, error: 'too_large' };

  const file = await withBudget(
    whatsapp.downloadMedia(info.url, token, { maxBytes: MAX_BYTES[type], timeoutMs: Math.max(1, left()) }),
    left(),
  );
  if (!file || !file.ok || !file.buffer) return { status: 'failed', text: null, error: (file && file.error) || 'download' };

  const mimeType = baseMime(file.mime_type) || baseMime(info.mime_type) || baseMime(row.media_mime_type) || DEFAULT_MIME[type];
  const model = resolveModel();
  let response = null;
  let ok = false;
  const callStarted = Date.now();
  try {
    const { GoogleGenerativeAI } = require('@google/generative-ai');
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    const geminiModel = genAI.getGenerativeModel({ model, generationConfig: { temperature: 0, maxOutputTokens: 400 } });
    const timeout = Math.max(1, left());
    const result = await withBudget(
      geminiModel.generateContent(
        [{ inlineData: { mimeType, data: file.buffer.toString('base64') } }, { text: PROMPT[type] }],
        { timeout },
      ),
      timeout,
    );
    response = result && result.response;
    const text = response && typeof response.text === 'function' ? String(response.text() || '').trim() : '';
    ok = true;
    if (!text || EMPTY_MARKERS.some((m) => text === m || text.replace(/[.\s]/g, '') === m.replace(/\s/g, ''))) {
      return { status: 'empty', text: null };
    }
    return { status: 'ok', text: cutChars(text, TEXT_MAX) };
  } finally {
    const usage = (response && response.usageMetadata) || {};
    logUsage({
      model,
      ms: Date.now() - callStarted,
      in: usage.promptTokenCount ?? null,
      out: usage.candidatesTokenCount ?? null,
      finish: response?.candidates?.[0]?.finishReason ?? null,
      conv: row.conversation_id || null,
      attempt: 1,
      ok,
      kind: 'media',
    });
  }
}

/**
 * Reads at most two audio/image rows, one after another, within `deadlineMs` in total. Returns the
 * batch with `shift_media` on the rows it processed and the updates the batcher persists into
 * raw_payload. Rows it had no budget left for stay untouched. Never throws.
 */
async function enrichBatch(business, accessToken, batch, { now, deadlineMs = DEFAULT_DEADLINE_MS } = {}) {
  const rows = Array.isArray(batch) ? batch : [];
  if (!mediaEnabled()) return { batch: rows, updates: [] };

  const candidates = rows.filter(isCandidate).slice(0, MAX_PER_BATCH);
  if (!candidates.length) return { batch: rows, updates: [] };

  const token = resolveToken(business, accessToken);
  const started = Date.now();
  const results = new Map();

  for (const row of candidates) {
    const remaining = deadlineMs - (Date.now() - started);
    if (remaining <= 0) break;
    const rowStarted = Date.now();
    let outcome;
    try {
      outcome = token
        ? await readRow(row, token, remaining)
        : { status: 'failed', text: null, error: 'no_token' };
    } catch (err) {
      outcome = { status: 'failed', text: null, error: err instanceof BudgetError ? 'timeout' : 'error' };
      console.error(`[media] ${row.message_type} failed conversation=${row.conversation_id || '-'}: ${err && err.message}`);
    }
    const at = (now instanceof Date ? now : new Date()).toISOString();
    results.set(row, {
      type: row.message_type,
      text: outcome.status === 'ok' ? outcome.text : null,
      status: outcome.status,
      at,
      ms: Date.now() - rowStarted,
    });
  }

  const updates = [];
  const out = rows.map((row) => {
    const shiftMedia = results.get(row);
    if (!shiftMedia) return row;
    if (row.id) updates.push({ id: row.id, shift_media: shiftMedia });
    return { ...row, shift_media: shiftMedia };
  });
  return { batch: out, updates };
}

/**
 * The short text lines read from an image (a menu photo): what the role-play setup can use as facts.
 * The model still has to emit START_ROLEPLAY — there is no server shortcut (§8.4).
 */
function transcriptLines(row) {
  const sm = existingMedia(row);
  if (!sm || sm.status !== 'ok' || typeof sm.text !== 'string') return [];
  return sm.text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}

module.exports = {
  mediaEnabled,
  enrichBatch,
  transcriptLines,
  PROMPT,
  MAX_PER_BATCH,
  MAX_BYTES,
};
