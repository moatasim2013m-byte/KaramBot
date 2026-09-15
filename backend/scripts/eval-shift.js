#!/usr/bin/env node
'use strict';

/**
 * Offline eval harness for the SHIFT sales bot (contract §11.3; eval doc «15 conversations»).
 *
 *   node scripts/eval-shift.js [--scenario 1,5] [--live] [--out docs/bot/eval]
 *
 * Replay (default) drives every scenario through the REAL pipeline — persistInbound → runBatch →
 * processShiftBatch → validators → deliverResult → services/whatsapp — and the real sweeper, with only the
 * edges faked: the in-memory fakeDb stands in for Prisma/jsonb, axios records Graph sends instead of
 * calling Meta, and the Gemini SDK answers from each turn's scripted `model` JSON. Nothing reaches the
 * network and nothing is written to the repo unless --out is given.
 *
 * --live (EVAL_LIVE=1 and GEMINI_API_KEY required) keeps prisma and axios faked but lets the real Gemini
 * SDK answer; a model 404 stops the run (exit 3). It never runs in `npm test`.
 *
 * Jest (tests/shiftEvalGates.test.js) cannot use the Module._load hooks below — it has its own module
 * registry — so the test jest.mocks the same four edges with `fakes.axios` / `fakes.gemini` from this file
 * and calls runScenario directly. Nothing under src/ is required at load time for that reason.
 *
 * Time: every scenario runs on its own clock (a patched global Date), so windows, team hours, Friday
 * blocks and nudges behave as on the scenario's wall time. Timers are bypassed: the harness calls runBatch
 * itself after each inbound turn and cancels whatever the batcher armed.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

const ROOT = path.join(__dirname, '..');
const scenarios = require('./eval/scenarios');
const gates = require('./eval/gates');

const PNID = 'pnid_shift_eval';
const BUSINESS_ID = 'biz_shift_eval';
const CUSTOMER = '962790000777';
const STAFF_ID = 'user_staff_eval';
const DEFAULT_GAP_MS = 60 * 1000;
const QUIET_MS = 5 * 1000;
const ALERT_WEBHOOK = 'https://alerts.eval.test/hook';

// ─── Fakes shared by the CLI hooks and the Jest mocks ────────────────────────

const state = {
  nowMs: Date.now(),
  modelQueue: [],
  modelCalls: [],
  graphSends: [],
  alertPosts: [],
  live404: false,
};

let wamidSeq = 0;

function fakeAxiosResponse(data) {
  return { status: 200, data };
}

const fakeAxios = {
  async post(url, payload) {
    if (url === ALERT_WEBHOOK || /alerts\.eval\.test/.test(url)) {
      state.alertPosts.push({ at: new Date().toISOString(), payload });
      return fakeAxiosResponse({ ok: true });
    }
    if (/\/messages$/.test(url) && payload && payload.status === 'read') return fakeAxiosResponse({ success: true });
    if (/\/messages$/.test(url)) {
      wamidSeq += 1;
      const id = `wamid.eval.out${wamidSeq}`;
      state.graphSends.push({ at: new Date().toISOString(), url, payload, wamid: id });
      return fakeAxiosResponse({ messaging_product: 'whatsapp', messages: [{ id }] });
    }
    return fakeAxiosResponse({});
  },
  async get(url) {
    // SHIFT_MEDIA stays off in the scenarios; a media lookup would be a harness bug, not a network call.
    throw Object.assign(new Error(`eval: unexpected GET ${url}`), { response: { status: 404, data: {} } });
  },
  create() {
    return fakeAxios;
  },
  isAxiosError(err) {
    return !!(err && err.response);
  },
};
fakeAxios.default = fakeAxios;

function modelResponse(text) {
  return { response: { text: () => text, usageMetadata: {}, candidates: [{ finishReason: 'STOP' }] } };
}

class FakeGoogleGenerativeAI {
  getGenerativeModel(params) {
    return {
      async generateContent(request) {
        const userText = request && request.contents ? request.contents[0].parts[0].text : String(request);
        state.modelCalls.push({ params, userText, at: new Date().toISOString() });
        const next = state.modelQueue.length ? state.modelQueue.shift() : undefined;
        if (next === undefined || next === null) throw new Error('eval: no scripted model reply for this call');
        if (next && next.__throw) throw new Error(next.__throw);
        return modelResponse(typeof next === 'string' ? next : JSON.stringify(next));
      },
    };
  }
}

const fakeGemini = {
  GoogleGenerativeAI: FakeGoogleGenerativeAI,
  SchemaType: { STRING: 'string', NUMBER: 'number', INTEGER: 'integer', BOOLEAN: 'boolean', ARRAY: 'array', OBJECT: 'object' },
};

const fakes = { axios: fakeAxios, gemini: fakeGemini };

// ─── Clock ──────────────────────────────────────────────────────────────────

function installClock() {
  const RealDate = global.Date;
  if (RealDate.__evalClock) return () => {};
  class EvalDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(state.nowMs);
      else super(...args);
    }

    static now() {
      return state.nowMs;
    }

    // Dates created before the clock was installed are still dates.
    static [Symbol.hasInstance](value) {
      return value instanceof RealDate;
    }
  }
  EvalDate.__evalClock = true;
  global.Date = EvalDate;
  return () => {
    global.Date = RealDate;
  };
}

const UNITS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

/** '+90s', '+15m', '+20h', or an ISO time with offset. */
function resolveAt(at, nowMs) {
  if (typeof at === 'number') return nowMs + at;
  const rel = /^\+(\d+(?:\.\d+)?)([smhd])$/.exec(String(at));
  if (rel) return nowMs + Number(rel[1]) * UNITS[rel[2]];
  const ms = Date.parse(at);
  if (!Number.isFinite(ms)) throw new Error(`eval: bad time ${at}`);
  return ms;
}

// ─── Dependencies (required lazily, after hooks or jest mocks are in place) ──

function deps() {
  return {
    db: require(path.join(ROOT, 'tests/helpers/fakeDb')).getFakeDb(),
    messageProcessor: require(path.join(ROOT, 'src/services/messageProcessor')),
    replyBatcher: require(path.join(ROOT, 'src/services/replyBatcher')),
    sweeper: require(path.join(ROOT, 'src/services/shiftSweeper')),
    shift: require(path.join(ROOT, 'src/workflows/shift')),
    tokenCrypto: require(path.join(ROOT, 'src/utils/tokenCrypto')),
  };
}

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

// ─── Inbound payloads ───────────────────────────────────────────────────────

let inSeq = 0;

function waMessage(item, nowMs) {
  inSeq += 1;
  const base = { id: item.wamid || `wamid.eval.in${inSeq}`, from: CUSTOMER, timestamp: String(Math.floor(nowMs / 1000)) };
  if (typeof item === 'string') return { ...base, type: 'text', text: { body: item } };
  if (item.tap) {
    const title = item.title || item.tap;
    const list = /^sector:/.test(item.tap);
    return {
      ...base,
      type: 'interactive',
      interactive: list
        ? { type: 'list_reply', list_reply: { id: item.tap, title } }
        : { type: 'button_reply', button_reply: { id: item.tap, title } },
    };
  }
  if (item.media) return { ...base, type: item.media, [item.media]: { id: `media_eval_${inSeq}`, mime_type: item.media === 'audio' ? 'audio/ogg' : 'image/jpeg' } };
  return { ...base, type: 'text', text: { body: String(item.text || '') } };
}

function entryFor(waMsgs, profileName) {
  return {
    id: 'waba_eval',
    changes: [{
      field: 'messages',
      value: {
        messaging_product: 'whatsapp',
        metadata: { phone_number_id: PNID },
        contacts: [{ wa_id: CUSTOMER, profile: { name: profileName || 'زبون' } }],
        messages: waMsgs,
      },
    }],
  };
}

// ─── Outbound collection ────────────────────────────────────────────────────

function partFromPayload(payload) {
  const p = { type: payload.type, text: '', buttons: [], rows: [] };
  if (payload.type === 'text') p.text = payload.text.body;
  if (payload.type === 'image') {
    p.text = payload.image.caption || '';
    p.url = payload.image.link;
  }
  if (payload.type === 'interactive') {
    const i = payload.interactive;
    p.type = i.type === 'button' ? 'interactive' : i.type;
    p.text = (i.body && i.body.text) || '';
    if (i.header) p.header = i.header.type === 'text' ? i.header.text : `[${i.header.type}]`;
    if (i.footer) p.footer = i.footer.text;
    if (i.type === 'button') p.buttons = (i.action.buttons || []).map((b) => ({ id: b.reply.id, title: b.reply.title }));
    if (i.type === 'list') {
      p.buttonLabel = i.action.button;
      p.rows = (i.action.sections || []).flatMap((s) => s.rows || []).map((r) => ({ id: r.id, title: r.title, description: r.description }));
    }
    if (i.type === 'cta_url') {
      p.displayText = i.action.parameters.display_text;
      p.url = i.action.parameters.url;
    }
  }
  return p;
}

function modelLineFor(part, result) {
  if (!result || !Array.isArray(result.messages)) return null;
  const hit = result.messages.find((m) => m && (m.text === part.text || (m.fallback && m.fallback.text === part.text)));
  if (!hit) return null;
  if (typeof hit.modelLine === 'string') return hit.modelLine;
  return result.kind === 'reply' ? hit.text : null;
}

// ─── State snapshots ────────────────────────────────────────────────────────

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

function snapshot(db, convId) {
  const conv = convId ? db.store.conversations.find((c) => c.id === convId) : null;
  const wd = (conv && conv.workflow_data) || {};
  return {
    conv: conv ? clone({ status: conv.status, current_state: conv.current_state, ai_enabled: conv.ai_enabled, metadata: conv.metadata }) : null,
    wd: clone(wd),
    lead: clone(wd.lead || {}),
    roleplay: clone(wd.roleplay || null),
  };
}

function conversationId(db) {
  const conv = db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER && c.business_id === BUSINESS_ID);
  return conv ? conv.id : null;
}

// ─── Expectations ───────────────────────────────────────────────────────────

function getPath(obj, dotted) {
  return String(dotted).split('.').reduce((acc, k) => (acc === undefined || acc === null ? undefined : acc[k]), obj);
}

/** Matchers: plain value (deep equal), {contains}, {includes: [..]}, {absent}, {present}, {not}, {lte}, {gte}, {match}. */
function matches(actual, expected) {
  if (expected && typeof expected === 'object' && !Array.isArray(expected)) {
    if ('absent' in expected) return expected.absent ? (actual === undefined || actual === null) : (actual !== undefined && actual !== null);
    if ('present' in expected) return actual !== undefined && actual !== null && actual !== '';
    if ('contains' in expected) return typeof actual === 'string' ? actual.includes(expected.contains) : (Array.isArray(actual) && actual.some((a) => typeof a === 'string' && a.includes(expected.contains)));
    if ('includes' in expected) return Array.isArray(actual) && expected.includes.every((x) => actual.includes(x));
    if ('excludes' in expected) return !Array.isArray(actual) || expected.excludes.every((x) => !actual.includes(x));
    if ('not' in expected) return JSON.stringify(actual) !== JSON.stringify(expected.not);
    if ('lte' in expected) return Number(actual) <= expected.lte;
    if ('gte' in expected) return Number(actual) >= expected.gte;
    if ('match' in expected) return new RegExp(expected.match).test(String(actual));
    if ('oneOf' in expected) return expected.oneOf.some((e) => matches(actual, e));
  }
  return JSON.stringify(actual) === JSON.stringify(expected);
}

function checkExpectations(expectations, subject, where) {
  const out = [];
  for (const [key, expected] of Object.entries(expectations || {})) {
    const actual = getPath(subject, key);
    if (!matches(actual, expected)) out.push(`${where} ${key}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  return out;
}

/** Per-turn assertions («Pass» lines that are about one turn). */
function turnSubject(t) {
  const text = t.outbound.filter((p) => !p.staff).map((p) => p.text).join('\n');
  return {
    outbound: t.outbound.filter((p) => !p.staff).length,
    aiCalls: t.aiCalls,
    stage: t.stageAfter,
    status: t.statusAfter,
    text,
    modelLine: (t.modelLines || []).join('\n'),
    buttons: t.outbound.flatMap((p) => (p.buttons || []).map((b) => b.id)),
    rows: t.outbound.flatMap((p) => (p.rows || []).map((r) => r.id)),
    types: t.outbound.filter((p) => !p.staff).map((p) => p.type),
    kinds: t.outbound.filter((p) => !p.staff).map((p) => p.kind),
    inboundStatuses: (t.inbound || []).map((m) => m.status),
    wd: t.wdAfter,
    lead: t.leadAfter,
  };
}

function checkTextRules(t, rules, where) {
  const out = [];
  const subject = turnSubject(t);
  for (const s of [].concat(rules.textIncludes || [])) if (!subject.text.includes(s)) out.push(`${where} text should include «${s}»: «${subject.text}»`);
  for (const s of [].concat(rules.textExcludes || [])) if (subject.text.includes(s)) out.push(`${where} text should not include «${s}»: «${subject.text}»`);
  return out;
}

// ─── runScenario ────────────────────────────────────────────────────────────

/**
 * Run one scenario and grade it.
 * @returns {Promise<{id, title, transcript, gateFailures, stateFailures, pass}>}
 */
async function runScenario(scenario, { mode = 'replay', quiet = true } = {}) {
  const d = deps();
  const { db, messageProcessor, replyBatcher, sweeper, shift, tokenCrypto } = d;
  const restoreClock = installClock();
  const savedEnv = {};
  const env = { SHIFT_MEDIA: '0', STAFF_ALERT_WEBHOOK_URL: ALERT_WEBHOOK, ...(scenario.env || {}) };
  for (const [k, v] of Object.entries(env)) {
    savedEnv[k] = process.env[k];
    if (v === null) delete process.env[k];
    else process.env[k] = v;
  }
  const quietConsole = quiet ? silenceConsole() : () => {};
  const originalProcess = shift.processShiftBatch;
  let lastResults = [];
  shift.processShiftBatch = async (...args) => {
    const r = await originalProcess(...args);
    lastResults.push(r);
    return r;
  };

  const transcript = { id: scenario.id, title: scenario.title, lang: scenario.lang, turns: [], final: null };
  const stateFailures = [];
  try {
    state.nowMs = Date.parse(scenario.clock || '2026-09-14T11:00:00+03:00');
    state.modelQueue = [];
    state.modelCalls = [];
    state.graphSends = [];
    state.alertPosts = [];
    db.reset();
    db.seed({
      businesses: [{
        id: BUSINESS_ID, name: 'SHIFT', business_type: 'shift', status: 'active', wa_phone_number_id: PNID,
        wa_access_token: tokenCrypto.encrypt('eval_token'), ai_config: clone((scenario.business && scenario.business.ai_config) || {}),
      }],
      users: [{ id: STAFF_ID, name: 'رامي', email: 'staff@eval.test', role: 'staff', business_id: BUSINESS_ID }],
    });
    if (scenario.lead || scenario.stage || scenario.workflow_data || scenario.conversation) {
      db.seed({
        conversations: [{
          business_id: BUSINESS_ID, customer_wa_id: CUSTOMER, profile_name: scenario.profileName || 'زبون',
          status: 'open', current_state: scenario.stage || null,
          workflow_data: { ...(clone(scenario.workflow_data) || {}), ...(scenario.lead ? { lead: clone(scenario.lead) } : {}) },
          last_inbound_at: scenario.conversation && scenario.conversation.last_inbound_at ? new Date(scenario.conversation.last_inbound_at) : null,
          ...(scenario.conversation ? clone({ ...scenario.conversation, last_inbound_at: undefined }) : {}),
        }],
      });
    }

    for (let i = 0; i < scenario.turns.length; i += 1) {
      const turn = scenario.turns[i];
      const kind = turn.sweep ? 'sweep' : turn.staff ? 'staff' : turn.inbound !== undefined ? 'inbound' : 'clock';
      state.nowMs = turn.at !== undefined ? resolveAt(turn.at, state.nowMs) : state.nowMs + (kind === 'inbound' ? DEFAULT_GAP_MS : 0);
      const convBefore = conversationId(db);
      const before = snapshot(db, convBefore);
      const sendsStart = state.graphSends.length;
      const callsStart = state.modelCalls.length;
      const outboundRowsBefore = new Set(db.store.messages.filter((m) => m.direction === 'outbound').map((m) => m.id));
      state.modelQueue = mode === 'live' ? [] : [].concat(turn.model === undefined ? [] : turn.model).map(clone);
      lastResults = [];
      const turnAt = new Date(state.nowMs).toISOString();
      let inboundRows = [];

      if (kind === 'inbound') {
        const items = Array.isArray(turn.inbound) ? turn.inbound : [turn.inbound];
        for (let j = 0; j < items.length; j += 1) {
          if (j > 0) state.nowMs += 1000;
          const msg = waMessage(items[j], state.nowMs);
          const copies = items[j] && items[j].duplicate ? 2 : 1;
          for (let c = 0; c < copies; c += 1) {
            const { items: persisted } = await messageProcessor.persistInbound(entryFor([msg], scenario.profileName));
            for (const it of persisted) if (it.message && !inboundRows.some((r) => r.id === it.message.id)) inboundRows.push(it.message);
          }
        }
        state.nowMs += QUIET_MS;
        const convId = conversationId(db);
        if (convId) await replyBatcher.runBatch(convId, { now: () => new Date() });
      } else if (kind === 'sweep') {
        await sweeper.runSweep({ now: new Date() });
        // An orphan the sweep scheduled is answered now instead of by a timer.
        const convId = conversationId(db);
        if (convId && db.store.messages.some((m) => m.conversation_id === convId && m.direction === 'inbound' && m.status === 'received')) {
          await replyBatcher.runBatch(convId, { now: () => new Date() });
        }
      } else if (kind === 'staff') {
        await staffAction(db, turn.staff);
      }
      await flush();
      replyBatcher.cancelAll();

      const convId = conversationId(db);
      const after = snapshot(db, convId);
      const rowsById = new Map(db.store.messages.map((m) => [m.id, m]));
      const lastResult = lastResults[lastResults.length - 1] || null;
      const sends = state.graphSends.slice(sendsStart).map((s) => {
        const part = partFromPayload(s.payload);
        const intent = s.payload.biz_opaque_callback_data ? rowsById.get(String(s.payload.biz_opaque_callback_data)) : null;
        const p = intent && intent.raw_payload ? intent.raw_payload : {};
        const modelLine = state.modelCalls.length > callsStart ? modelLineFor(part, lastResult) : null;
        return { ...part, at: s.at, kind: p.kind || null, batchKey: p.batch_key || null, intentId: intent ? intent.id : null, modelLine };
      });
      const staffRows = db.store.messages
        .filter((m) => m.direction === 'outbound' && m.sent_by_user_id && !outboundRowsBefore.has(m.id))
        .map((m) => ({ type: 'text', text: m.text_body, at: new Date(m.created_at).toISOString(), staff: true, kind: 'staff', buttons: [], rows: [] }));
      const aiCalls = state.modelCalls.length - callsStart;
      // Only a turn that called the model has a model line; a deterministic exit or tap is server copy.
      const delivered = aiCalls > 0 && sends.some((p) => ['reply', 'fallback', 'handoff', 'media'].includes(p.kind));
      const modelLines = delivered && lastResult && Array.isArray(lastResult.messages)
        ? lastResult.messages.map((m) => (typeof m.modelLine === 'string' ? m.modelLine : (lastResult.kind === 'reply' ? m.text : null))).filter((s) => typeof s === 'string' && s.trim())
        : [];

      const t = {
        index: i,
        at: turnAt,
        kind,
        note: turn.note || null,
        inbound: inboundRows.map((m) => {
          const row = rowsById.get(m.id) || m;
          return { rowId: m.id, type: row.message_type, text: row.text_body, tap: turn.inbound && turn.inbound.tap, status: row.status };
        }),
        outbound: [...sends, ...staffRows],
        modelLines,
        results: lastResults.map((r) => r && { kind: r.kind, action: r.action }),
        aiCalls,
        stageBefore: before.conv ? before.conv.current_state : null,
        stageAfter: after.conv ? after.conv.current_state : null,
        statusBefore: before.conv ? before.conv.status : null,
        statusAfter: after.conv ? after.conv.status : null,
        roleplayBefore: before.roleplay,
        roleplayAfter: after.roleplay,
        leadBefore: before.lead,
        leadAfter: after.lead,
        wdBefore: before.wd,
        wdAfter: after.wd,
        rowStatuses: Object.fromEntries(db.store.messages.filter((m) => m.direction === 'inbound').map((m) => [m.id, m.status])),
        forbid: turn.forbid || [],
        exemptGates: turn.exemptGates || [],
        allowSeparateReplies: !!turn.allowSeparateReplies,
      };
      transcript.turns.push(t);
      if (turn.expect) {
        stateFailures.push(...checkExpectations(Object.fromEntries(Object.entries(turn.expect).filter(([k]) => !['textIncludes', 'textExcludes'].includes(k))), turnSubject(t), `turn ${i + 1}`));
        stateFailures.push(...checkTextRules(t, turn.expect, `turn ${i + 1}`));
      }
    }

    const convId = conversationId(db);
    const conv = convId ? db.store.conversations.find((c) => c.id === convId) : null;
    transcript.final = {
      conversation: conv ? clone({ status: conv.status, current_state: conv.current_state, ai_enabled: conv.ai_enabled, metadata: conv.metadata }) : null,
      workflow_data: clone((conv && conv.workflow_data) || {}),
      lead: clone(((conv && conv.workflow_data) || {}).lead || {}),
      orders: db.store.orders.length,
      alerts: state.alertPosts.map((a) => a.payload && a.payload.reason).filter(Boolean),
      botOutbound: transcript.turns.reduce((n, t) => n + t.outbound.filter((p) => !p.staff).length, 0),
      aiCalls: state.modelCalls.length,
    };
    const expect = scenario.expect || {};
    stateFailures.push(...checkExpectations(expect.state, transcript.final, 'final'));
  } finally {
    shift.processShiftBatch = originalProcess;
    replyBatcher.cancelAll();
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    quietConsole();
    restoreClock();
  }

  const expect = scenario.expect || {};
  const gateFailures = gates.runGates(transcript, { exempt: expect.exemptGates || [] });
  return {
    id: scenario.id,
    title: scenario.title,
    transcript,
    gateFailures,
    stateFailures,
    pass: gateFailures.length === 0 && stateFailures.length === 0,
  };
}

/** What the Inbox does for the harness: a staff message (pause) or a claim. */
async function staffAction(db, action) {
  const convId = conversationId(db);
  if (!convId) return;
  const now = new Date();
  if (action.send) {
    db.seed({
      messages: [{
        business_id: BUSINESS_ID, conversation_id: convId, direction: 'outbound', message_type: 'text', text_body: action.send,
        status: 'sent', sent_by_user_id: STAFF_ID, is_ai_generated: false, created_at: now,
      }],
    });
    await db.jsonb.patchJson('conversations', convId, 'metadata', { human_active_until: new Date(now.getTime() + 30 * 60 * 1000).toISOString() });
  }
  if (action.claim) {
    await db.prisma.conversation.updateMany({
      where: { id: convId },
      data: { status: 'human_takeover', ai_enabled: false, assigned_staff_id: STAFF_ID },
    });
  }
}

function silenceConsole() {
  const saved = { log: console.log, warn: console.warn, error: console.error, info: console.info };
  console.log = () => {};
  console.warn = () => {};
  console.error = () => {};
  console.info = () => {};
  return () => Object.assign(console, saved);
}

// ─── Reports ────────────────────────────────────────────────────────────────

function summaryMarkdown(results, mode, date) {
  const lines = [
    `# Karam eval — ${date} (${mode})`,
    '',
    `| Scenario | ${gates.GATE_IDS.join(' | ')} | State | Pass |`,
    `|---|${gates.GATE_IDS.map(() => '---').join('|')}|---|---|`,
  ];
  for (const r of results) {
    const failed = new Set(r.gateFailures.map((f) => f.gate));
    const exempt = new Set(((scenarios.byId(r.id) || {}).expect || {}).exemptGates || []);
    const cells = gates.GATE_IDS.map((g) => (failed.has(g) ? '❌' : exempt.has(g) ? '—' : '✓'));
    lines.push(`| ${r.id}. ${r.title} | ${cells.join(' | ')} | ${r.stateFailures.length ? `❌ ${r.stateFailures.length}` : '✓'} | ${r.pass ? 'yes' : '**no**'} |`);
  }
  lines.push('', '## Failures', '');
  for (const r of results) {
    for (const f of r.gateFailures) lines.push(`- ${r.id} · ${f.gate} · turn ${f.turn === null ? '-' : f.turn + 1}: ${f.detail}`);
    for (const f of r.stateFailures) lines.push(`- ${r.id} · state: ${f}`);
  }
  lines.push('', '## Reviewer sheet (per run)', '',
    '| Scenario | Gates failed | Truth /4 | Intent /4 | Progression /4 | Arabic/English /4 | Memory /4 | Sample /4 | Pressure /4 | Form /4 | Weighted | Notes |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    lines.push(`| ${r.id} | ${[...new Set(r.gateFailures.map((f) => f.gate))].join(', ')} | | | | | | | | | | |`);
  }
  lines.push('', 'Weighted = Σ(score/4 × weight). Ship when every run passes every gate, the mean ≥ 85 with no dimension mean < 2.5, and no run has Pressure ≤ 1.');
  return lines.join('\n');
}

function transcriptJson(results) {
  return results.map((r) => ({
    id: r.id,
    title: r.title,
    pass: r.pass,
    gateFailures: r.gateFailures,
    stateFailures: r.stateFailures,
    turns: r.transcript.turns.map((t) => ({
      at: t.at, kind: t.kind, inbound: t.inbound, outbound: t.outbound, aiCalls: t.aiCalls,
      results: t.results, stage: t.stageAfter, status: t.statusAfter, leadDiff: leadDiff(t.leadBefore, t.leadAfter),
      gates: r.gateFailures.filter((f) => f.turn === t.index).map((f) => f.gate),
    })),
    final: r.transcript.final,
  }));
}

function leadDiff(a = {}, b = {}) {
  const out = {};
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (k === '_prov' || k === 'version') continue;
    if (JSON.stringify((a || {})[k]) !== JSON.stringify((b || {})[k])) out[k] = (b || {})[k];
  }
  return out;
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function printTranscript(r, { full = false } = {}) {
  if (full) {
    for (const t of r.transcript.turns) {
      const inbound = t.inbound.map((m) => `${m.text || m.type} [${m.status}]`).join(' | ');
      console.log(`  #${t.index + 1} ${t.at} ${t.kind}${inbound ? ` C: ${inbound}` : ''}  ai=${t.aiCalls} stage ${t.stageBefore}→${t.stageAfter} status ${t.statusAfter}`);
      for (const p of t.outbound) {
        const extras = [
          p.buttons && p.buttons.length ? `buttons ${p.buttons.map((b) => `${b.id}:${b.title}`).join(', ')}` : '',
          p.rows && p.rows.length ? `rows ${p.rows.map((b) => b.id).join(', ')}` : '',
          p.url ? `url ${p.url}` : '',
        ].filter(Boolean).join(' · ');
        console.log(`     ${p.staff ? 'STAFF' : `K(${p.kind}/${p.type})`}: ${String(p.text).replace(/\n/g, ' ⏎ ')}${extras ? `  {${extras}}` : ''}`);
      }
      if (t.modelLines.length) console.log(`     model: ${t.modelLines.join(' ⏎ ')}`);
    }
  }
  for (const f of r.gateFailures) console.log(`  ✗ ${f.gate} turn ${f.turn === null ? '-' : f.turn + 1}: ${f.detail}`);
  for (const f of r.stateFailures) console.log(`  ✗ ${f}`);
}

function parseArgs(argv) {
  const args = { scenario: null, live: false, out: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--live') args.live = true;
    else if (a === '--scenario') args.scenario = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
    else if (a.startsWith('--scenario=')) args.scenario = a.slice(11).split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--out') args.out = argv[++i];
    else if (a.startsWith('--out=')) args.out = a.slice(6);
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

/** CLI only: swap the network/DB edges before anything under src/ is required. */
// SDKs that make their own HTTP calls (not through axios): loading one in replay is a bug, and it fails loudly.
const REPLAY_BLOCKED_MODULES = ['openai', '@anthropic-ai/sdk', 'node-fetch', 'undici', 'got'];

function installHooks({ live }) {
  // Test-only defaults so config and token encryption load without a real environment (never production).
  const defaults = {
    NODE_ENV: 'test', DATABASE_URL: 'postgresql://eval:eval@localhost:5432/eval', JWT_SECRET: 'eval_secret_that_is_long_enough_for_the_harness',
    META_APP_SECRET: 'eval_meta_secret', WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'eval_verify', TOKEN_ENCRYPTION_KEY: 'b'.repeat(64),
    AI_PROVIDER: 'gemini', GEMINI_API_KEY: live ? process.env.GEMINI_API_KEY : 'eval_key',
  };
  for (const [k, v] of Object.entries(defaults)) if (!process.env[k] || (k === 'TOKEN_ENCRYPTION_KEY' && !live)) process.env[k] = v;
  if (!live) {
    // Replay never reaches a network: whatever the shell exported (AI_PROVIDER=openai from a sourced .env,
    // say), the provider is the scripted Gemini fake, and no other SDK key is left for a fallback to use.
    process.env.GEMINI_API_KEY = 'eval_key';
    process.env.AI_PROVIDER = 'gemini';
    for (const k of ['OPENAI_API_KEY', 'OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY']) delete process.env[k];
  }

  const fakeDb = require(path.join(ROOT, 'tests/helpers/fakeDb')).getFakeDb();
  const prismaPath = path.join(ROOT, 'src/config/prisma.js');
  const jsonbPath = path.join(ROOT, 'src/db/jsonb.js');
  const originalLoad = Module._load;
  let liveModule = null;
  Module._load = function evalLoad(request, parent, isMain) {
    if (request === 'axios') return fakeAxios;
    if (!live && REPLAY_BLOCKED_MODULES.includes(request)) {
      throw new Error(`eval-shift replay: '${request}' would reach the network — replay uses the scripted Gemini fake only`);
    }
    if (request === '@google/generative-ai') {
      if (!live) return fakeGemini;
      if (!liveModule) liveModule = wrapLiveGemini(originalLoad.call(this, request, parent, isMain));
      return liveModule;
    }
    if (request.startsWith('.') || request.startsWith('/')) {
      let resolved = null;
      try {
        resolved = Module._resolveFilename(request, parent, isMain);
      } catch (err) {
        resolved = null;
      }
      if (resolved === prismaPath) return fakeDb.prisma;
      if (resolved === jsonbPath) return fakeDb.jsonb;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
}

// --live: the real SDK, with a 404 (unknown model) recorded so the run stops with exit 3.
function wrapLiveGemini(real) {
  class LiveGoogleGenerativeAI extends real.GoogleGenerativeAI {
    getGenerativeModel(params, ...rest) {
      const model = super.getGenerativeModel(params, ...rest);
      const generate = model.generateContent.bind(model);
      model.generateContent = async (...args) => {
        state.modelCalls.push({ params, at: new Date().toISOString() });
        try {
          return await generate(...args);
        } catch (err) {
          if (/404|not found/i.test(String(err && err.message))) state.live404 = true;
          throw err;
        }
      };
      return model;
    }
  }
  return { ...real, GoogleGenerativeAI: LiveGoogleGenerativeAI };
}

async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('node scripts/eval-shift.js [--scenario 1,5] [--live] [--out docs/bot/eval] [--verbose]');
    return 0;
  }
  if (args.live && (process.env.EVAL_LIVE !== '1' || !process.env.GEMINI_API_KEY)) {
    console.error('eval-shift: --live needs EVAL_LIVE=1 and GEMINI_API_KEY (it calls the real Gemini API).');
    return 2;
  }
  installHooks({ live: args.live });
  const mode = args.live ? 'live' : 'replay';
  const list = args.scenario ? scenarios.ALL.filter((s) => args.scenario.includes(String(s.id))) : scenarios.ALL;
  if (!list.length) {
    console.error(`eval-shift: no scenario matches ${args.scenario}`);
    return 2;
  }

  const results = [];
  for (const s of list) {
    const r = await runScenario(s, { mode });
    results.push(r);
    const gatesFailed = [...new Set(r.gateFailures.map((f) => f.gate))];
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${s.id}. ${s.title}${gatesFailed.length ? `  gates: ${gatesFailed.join(',')}` : ''}${r.stateFailures.length ? `  state: ${r.stateFailures.length}` : ''}`);
    if (args.verbose || !r.pass) printTranscript(r, { full: args.verbose });
    if (state.live404) {
      console.error('eval-shift: the model returned 404 — check GEMINI_MODEL.');
      return 3;
    }
  }

  const date = new Date().toISOString().slice(0, 10);
  const scratch = process.env.EVAL_SCRATCH_DIR || os.tmpdir();
  if (!args.out) fs.mkdirSync(scratch, { recursive: true });
  const outDir = args.out ? path.resolve(process.cwd(), args.out) : fs.mkdtempSync(path.join(scratch, 'karam-eval-'));
  fs.mkdirSync(outDir, { recursive: true });
  const base = path.join(outDir, `${date}-${mode}`);
  fs.writeFileSync(`${base}.json`, JSON.stringify(transcriptJson(results), null, 2));
  fs.writeFileSync(`${base}.md`, summaryMarkdown(results, mode, date));
  console.log(`\nreport: ${base}.md`);

  const hardFail = results.some((r) => r.gateFailures.length > 0);
  const stateFail = results.some((r) => r.stateFailures.length > 0);
  if (hardFail) return 1;
  return stateFail ? 1 : 0;
}

module.exports = {
  runScenario,
  fakes,
  state,
  parseArgs,
  summaryMarkdown,
  transcriptJson,
  matches,
  resolveAt,
  CUSTOMER,
  BUSINESS_ID,
};

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
    // Timers the batcher may have armed are cancelled per turn; exit promptly regardless.
    setImmediate(() => process.exit(code));
  }, (err) => {
    console.error(err);
    process.exit(1);
  });
}
