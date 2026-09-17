#!/usr/bin/env node
'use strict';

/**
 * Live conversation simulator for the SHIFT sales bot (dev tool — never part of `npm test`).
 *
 *   OPENROUTER_API_KEY=… GEMINI_API_KEY=… \
 *   node scripts/sim-chat.js --customer moonshotai/kimi-k3 --persona restaurant --out docs/bot/sims
 *
 * The SHIFT side is REAL: persistInbound → runBatch → processShiftBatch → the v2 prompt → the validators →
 * deliverResult, plus the real booking module and the real button path. Gemini is the real API.
 *
 * Everything at the edges is faked and nothing leaves the machine except the two model calls:
 *   • prisma / jsonb  → tests/helpers/fakeDb
 *   • axios           → records Graph sends (WhatsApp) and staff-alert posts instead of sending them
 *   • googleCalendar  → an in-memory calendar (free/busy from a fixture; insert/patch/delete recorded)
 *
 * The customer is another model, through OpenRouter. It is given a persona and answers with JSON:
 *   {"messages": ["…", "…"], "tap": "<exact button title>|null", "voice_note": false, "done": false}
 * Several `messages` are persisted as ONE batch, exactly as the real batcher would collect them, and a
 * `tap` is fed back through the interactive path replyBatcher reads (never as free text).
 */

const path = require('path');
const fs = require('fs');
const Module = require('module');

const ROOT = path.join(__dirname, '..');

const PNID = 'pnid_shift_sim';
const BUSINESS_ID = 'biz_shift_sim';
const CUSTOMER = '962790000555';
const STAFF_ID = 'user_staff_sim';
const ALERT_WEBHOOK = 'https://alerts.sim.test/hook';
const FAKE_CALENDAR_ID = 'sim-sales-calendar@group.calendar.google.invalid';

const QUIET_MS = 5 * 1000;
const TURN_GAP_MS = 45 * 1000;
const DEFAULT_MAX_TURNS = 14;
const DEFAULT_BUDGET_MS = 8 * 60 * 1000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── shared run state ────────────────────────────────────────────────────────

const state = {
  clockOffsetMs: 0,
  graphSends: [],
  alertPosts: [],
  geminiCalls: [],
  calendarOps: [],
  openrouterUsage: [],
};

let wamidSeq = 0;
let inSeq = 0;

// ─── clock: today's team-hours morning, advancing with real time ─────────────

/**
 * A constant offset (plus explicit between-turn jumps) so every delta a real run would see is preserved —
 * model deadlines, the batch quiet window and the busy cache all behave as they do in production — while
 * the wall time the bot reads sits inside SHIFT's team hours so real slots can be offered.
 */
function installClock(anchorMs) {
  const RealDate = global.Date;
  if (RealDate.__simClock) return () => {};
  state.clockOffsetMs = anchorMs - RealDate.now();
  const simNow = () => RealDate.now() + state.clockOffsetMs;
  class SimDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(simNow());
      else super(...args);
    }

    static now() {
      return simNow();
    }

    static [Symbol.hasInstance](value) {
      return value instanceof RealDate;
    }
  }
  SimDate.__simClock = true;
  global.Date = SimDate;
  return () => { global.Date = RealDate; };
}

function jumpClock(ms) {
  state.clockOffsetMs += ms;
}

// ─── fake axios: WhatsApp Graph and the staff-alert webhook ──────────────────

function axiosResponse(data) {
  return { status: 200, data };
}

const fakeAxios = {
  async post(url, payload) {
    if (url === ALERT_WEBHOOK || /alerts\.sim\.test/.test(url)) {
      state.alertPosts.push({ at: new Date().toISOString(), payload });
      return axiosResponse({ ok: true });
    }
    if (/\/messages$/.test(url) && payload && payload.status === 'read') return axiosResponse({ success: true });
    if (/\/messages$/.test(url)) {
      wamidSeq += 1;
      const id = `wamid.sim.out${wamidSeq}`;
      state.graphSends.push({ at: new Date().toISOString(), url, payload, wamid: id });
      return axiosResponse({ messaging_product: 'whatsapp', messages: [{ id }] });
    }
    throw new Error(`sim-chat: unexpected POST ${url}`);
  },
  async get(url) {
    throw Object.assign(new Error(`sim-chat: unexpected GET ${url}`), { response: { status: 404, data: {} } });
  },
  async patch(url) { throw new Error(`sim-chat: unexpected PATCH ${url}`); },
  async delete(url) { throw new Error(`sim-chat: unexpected DELETE ${url}`); },
  create() { return fakeAxios; },
  isAxiosError(err) { return !!(err && err.response); },
};
fakeAxios.default = fakeAxios;

// ─── in-memory Google Calendar ──────────────────────────────────────────────

/**
 * Same shape as src/services/googleCalendar.js: every call resolves to {ok, …} or {ok:false, error} and
 * never throws. The fixture busy blocks stand in for the team's real diary so the offered slots are the
 * ones a live calendar would leave free; inserts, patches and deletes only ever touch this Map.
 */
function makeCalendarStub(fixtureBusy) {
  const events = new Map(); // eventId -> event
  const fixture = () => fixtureBusy.map((b) => ({ start: new Date(b.start), end: new Date(b.end) }));

  function record(op, detail) {
    state.calendarOps.push({ at: new Date().toISOString(), op, ...detail });
  }

  function eventBusy(ev) {
    if (!ev || ev.status === 'cancelled') return null;
    const start = new Date(ev.start && (ev.start.dateTime || ev.start.date));
    const end = new Date(ev.end && (ev.end.dateTime || ev.end.date));
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
    return { start, end };
  }

  return {
    saEmail: () => 'sim@calendar.invalid',
    resetTokenCache: () => {},
    async getAccessToken() { return { ok: true, token: 'sim-token', source: 'sim' }; },
    async freeBusy({ timeMin, timeMax, calendarIds } = {}) {
      const ids = (Array.isArray(calendarIds) ? calendarIds : []).filter(Boolean);
      if (!ids.length) return { ok: false, error: { kind: 'invalid', status: null, reason: null, message: 'no calendars' } };
      const min = new Date(timeMin).getTime();
      const max = new Date(timeMax).getTime();
      const busy = [...fixture(), ...[...events.values()].map(eventBusy).filter(Boolean)]
        .filter((b) => b.end.getTime() > min && b.start.getTime() < max)
        .sort((a, b) => a.start - b.start);
      record('freeBusy', { timeMin: new Date(min).toISOString(), timeMax: new Date(max).toISOString(), busy: busy.length });
      return { ok: true, busy };
    },
    async getEvent(calendarId, eventId) {
      const ev = events.get(eventId);
      record('getEvent', { eventId, found: !!ev });
      if (!ev) return { ok: false, error: { kind: 'notFound', status: 404, reason: 'notFound', message: 'no such event' } };
      return { ok: true, event: ev };
    },
    async insertEvent(calendarId, event) {
      const id = event && event.id;
      if (id && events.has(id)) {
        const existing = events.get(id);
        record('insertEvent.conflict', { eventId: id, status: existing.status });
        if (existing.status === 'cancelled') {
          return { ok: false, error: { kind: 'conflict', status: 409, reason: 'cancelled', message: 'event id belongs to a cancelled event' } };
        }
        return { ok: true, event: existing, existed: true };
      }
      const stored = { ...event, id: id || `sim_ev_${events.size + 1}`, status: 'confirmed', calendarId };
      events.set(stored.id, stored);
      record('insertEvent', { eventId: stored.id, summary: stored.summary, start: stored.start, end: stored.end });
      return { ok: true, event: stored, existed: false };
    },
    async patchEvent(calendarId, eventId, patch) {
      const ev = events.get(eventId);
      record('patchEvent', { eventId, patch, found: !!ev });
      if (!ev) return { ok: false, error: { kind: 'notFound', status: 404, reason: 'notFound', message: 'no such event' } };
      const next = { ...ev, ...patch };
      events.set(eventId, next);
      return { ok: true, event: next };
    },
    async deleteEvent(calendarId, eventId) {
      const had = events.has(eventId);
      if (had) events.set(eventId, { ...events.get(eventId), status: 'cancelled' });
      record('deleteEvent', { eventId, alreadyGone: !had });
      return { ok: true, alreadyGone: !had };
    },
    __events: events,
  };
}

// ─── module hooks ───────────────────────────────────────────────────────────

let calendarStub = null;

function installHooks(fixtureBusy) {
  const defaults = {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://sim:sim@localhost:5432/sim',
    JWT_SECRET: 'sim_secret_that_is_long_enough_for_the_harness',
    META_APP_SECRET: 'sim_meta_secret',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'sim_verify',
    TOKEN_ENCRYPTION_KEY: 'c'.repeat(64),
    AI_PROVIDER: 'gemini',
    STAFF_ALERT_WEBHOOK_URL: ALERT_WEBHOOK,
    SHIFT_MEDIA: '0',
    SHIFT_SALES_CALENDAR_ID: FAKE_CALENDAR_ID,
    SHIFT_INBOX_URL: 'https://inbox.sim.test',
  };
  for (const [k, v] of Object.entries(defaults)) if (!process.env[k]) process.env[k] = v;
  // Whatever the shell exported, the SHIFT side talks to Gemini only.
  process.env.AI_PROVIDER = 'gemini';
  delete process.env.OPENAI_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;

  calendarStub = makeCalendarStub(fixtureBusy);

  const fakeDb = require(path.join(ROOT, 'tests/helpers/fakeDb')).getFakeDb();
  const prismaPath = path.join(ROOT, 'src/config/prisma.js');
  const jsonbPath = path.join(ROOT, 'src/db/jsonb.js');
  const calendarPath = path.join(ROOT, 'src/services/googleCalendar.js');
  const originalLoad = Module._load;
  let geminiModule = null;

  Module._load = function simLoad(request, parent, isMain) {
    if (request === 'axios') return fakeAxios;
    if (request === '@google/generative-ai') {
      if (!geminiModule) geminiModule = wrapGemini(originalLoad.call(this, request, parent, isMain));
      return geminiModule;
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
      if (resolved === calendarPath) return calendarStub;
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  return fakeDb;
}

/** The real SDK, with each call's latency, token usage, finish reason and any failure recorded. */
function wrapGemini(real) {
  class SimGoogleGenerativeAI extends real.GoogleGenerativeAI {
    getGenerativeModel(params, ...rest) {
      const model = super.getGenerativeModel(params, ...rest);
      const generate = model.generateContent.bind(model);
      model.generateContent = async (...args) => {
        const started = process.hrtime.bigint();
        const entry = { model: params && params.model, at: new Date().toISOString() };
        try {
          const res = await generate(...args);
          entry.ms = Number(process.hrtime.bigint() - started) / 1e6;
          const response = res && res.response;
          entry.finish = response?.candidates?.[0]?.finishReason ?? null;
          entry.promptFeedback = response?.promptFeedback?.blockReason ?? null;
          entry.usage = response?.usageMetadata || null;
          entry.ok = true;
          state.geminiCalls.push(entry);
          return res;
        } catch (err) {
          entry.ms = Number(process.hrtime.bigint() - started) / 1e6;
          entry.ok = false;
          entry.error = String((err && err.message) || err).slice(0, 400);
          state.geminiCalls.push(entry);
          throw err;
        }
      };
      return model;
    }
  }
  return { ...real, GoogleGenerativeAI: SimGoogleGenerativeAI };
}

// ─── inbound payloads (the same shapes Meta posts) ──────────────────────────

function waMessage(item, nowMs) {
  inSeq += 1;
  const base = { id: `wamid.sim.in${inSeq}`, from: CUSTOMER, timestamp: String(Math.floor(nowMs / 1000)) };
  if (item.tapId) {
    const list = /^sector:/.test(item.tapId);
    return {
      ...base,
      type: 'interactive',
      interactive: list
        ? { type: 'list_reply', list_reply: { id: item.tapId, title: item.title } }
        : { type: 'button_reply', button_reply: { id: item.tapId, title: item.title } },
    };
  }
  if (item.media) {
    return { ...base, type: item.media, [item.media]: { id: `media_sim_${inSeq}`, mime_type: item.media === 'audio' ? 'audio/ogg' : 'image/jpeg' } };
  }
  return { ...base, type: 'text', text: { body: String(item.text || '') } };
}

function entryFor(waMsgs, profileName) {
  return {
    id: 'waba_sim',
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

// ─── outbound rendering ─────────────────────────────────────────────────────

function partFromPayload(payload) {
  const p = { type: payload.type, text: '', buttons: [], rows: [] };
  if (payload.type === 'text') p.text = payload.text.body;
  if (payload.type === 'image') {
    p.text = payload.image.caption || '';
    p.url = payload.image.link;
  }
  if (payload.type === 'template') {
    p.type = 'template';
    p.text = `[template ${payload.template && payload.template.name}]`;
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

function clone(v) {
  return v === undefined ? undefined : JSON.parse(JSON.stringify(v));
}

// ─── the customer model (OpenRouter) ────────────────────────────────────────

const PERSONAS = {
  restaurant: {
    id: 'restaurant',
    profileName: 'أبو محمد',
    title: 'صاحب مطعم في إربد — مستعجل ومتشكك',
    brief: `إنت أبو محمد، صاحب مطعم صغير في إربد (مطعم «بيت المندي»). مشغول ومستعجل دايماً.
- أول رسالة منك قصيرة، من إعلان شفتَه: بتسأل شو هاي الخدمة.
- بتسأل عن السعر بدري (بالرسالة الثانية أو الثالثة) وبتلح عليه.
- بترد بردّين اعتراض على الأقل خلال المحادثة: مرة «غالي كثير» أو «ما بصرف معي»، ومرة «عندي موظف بيرد، شو بتفيدني؟».
- بعد ما يقنعك شوي، بتوافق على مكالمة وبتحدد وقت.
- بتكتب رسائل قصيرة جداً، أحياناً رسالتين ورا بعض، وأحياناً فيها غلطات طباعية.`,
  },
  clinic: {
    id: 'clinic',
    profileName: 'د. رنا',
    title: 'صاحبة عيادة — فضولية، بدها عيّنة وتجربة',
    brief: `إنتِ د. رنا، صاحبة عيادة أسنان في عمان (عيادة «سمايل كير»).
- مهتمة وفضولية بس مش مستعجلة.
- بتسألي بالتفصيل: شو بالضبط بيعمل البوت؟ بيرد على شو؟ بيحجز مواعيد؟
- بتطلبي عيّنة أو مثال حقيقي («فيني أشوف شو بيطلع؟» / «بتقدر تجربلي؟»).
- إذا عرض عليكِ تجربة/role-play، جربيها فعلاً واكتبي كأنك زبونة بتحكي مع عيادتك.
- بعدها بتوافقي على مكالمة وبتحجزي وقت، وبعد ما يتأكد الحجز بتطلبي تغيير الوقت لوقت ثاني.
- رسائل قصيرة بالعربي، أحياناً رسالتين ورا بعض.`,
  },
  hostile: {
    id: 'hostile',
    profileName: 'زياد',
    title: 'مستخدم عدائي — بيختبر البوت',
    brief: `إنت زياد، بتختبر البوت وبدك تكسره. مش جاد بالشراء.
- مرة وحدة بس بتشتم شتيمة خفيفة (مثل «يا زلمة بطل سخافة» أو «هرجة فاضية»).
- بتسأل صراحة «إنت بوت ولا إنسان؟» وبتلح إذا ما جاوب واضح.
- بتسأل أسئلة برا الموضوع: عن مباراة الوحدات والفيصلي، وعن أغنية بتحبها.
- بتطلب خصم، وبتدّعي إنه في شركة ثانية أرخص («لقيت واحد بعملها بـ50 دينار»).
- مرة وحدة بتبعث رسالة صوتية (استخدم voice_note).
- رسائل قصيرة، عامية، فيها غلطات.`,
  },
};

const CUSTOMER_SYSTEM = `إنت بتمثّل دور زبون حقيقي على واتساب بيحكي مع حساب شركة أردنية اسمها SHIFT (شفت) بتبيع بوتات واتساب للمحلات والعيادات والمطاعم.

قواعد إلزامية:
1. إنت الزبون — مش المساعد. لا تساعد ولا تبيع ولا تشرح خدمات الشركة أبداً.
2. اكتب عربي أردني عامي فقط، رسائل واتساب قصيرة (٣–١٢ كلمة عادة). لا تكتب فقرات.
3. أحياناً ابعث رسالتين أو ثلاث ورا بعض (مثل ما بيعمل الناس)، وأحياناً رسالة وحدة.
4. أحياناً اكتب غلطة طباعية بسيطة (حرف ناقص أو زيادة). مش بكل رسالة.
5. تفاعل طبيعي مع اللي بيحكيه الطرف الثاني. إذا سألك سؤال، جاوب عليه.
6. إذا بعتلك أزرار (buttons)، وكان في زر بيناسب ردك، ارجع عنوان الزر بالضبط في الحقل "tap" بدل ما تكتب رسالة.
7. لا تخترع إنك بعثت أو استلمت إشي ما صار.
8. لا تكرر نفس الرسالة مرتين.

لازم ترجع JSON فقط، بدون أي نص قبله أو بعده، بهذا الشكل بالضبط:
{"messages": ["نص الرسالة الأولى", "نص الرسالة الثانية"], "tap": null, "voice_note": false, "done": false}

- "messages": مصفوفة من ١ إلى ٣ رسائل. إذا عبّيت "tap" خليها مصفوفة فاضية [].
- "tap": عنوان الزر بالضبط كما وصلك، أو null.
- "voice_note": true إذا بدك تبعث رسالة صوتية (وقتها خلي messages فاضية و tap null).
- "done": true فقط إذا خلصت المحادثة طبيعياً تماماً. مهم: ما بينفع ترجع "done": true قبل ما تخلّص كل النقاط اللي بشخصيتك، ولا بينفع ترجع مصفوفة "messages" فاضية بدون "tap" أو "voice_note". لازم كل دور يطلع منه إشي: رسالة، أو ضغطة زر، أو رسالة صوتية.`;

async function callCustomerModel(model, persona, history, availableButtons, turnIndex, nudge = false) {
  const buttonsLine = availableButtons.length
    ? `الأزرار المتاحة الآن (ترجعها في "tap" بالضبط إذا بدك تضغط وحدة): ${availableButtons.map((b) => `«${b}»`).join('، ')}`
    : 'ما في أزرار متاحة الآن.';
  const messages = [
    { role: 'system', content: `${CUSTOMER_SYSTEM}\n\n# شخصيتك\n${persona.brief}` },
  ];
  for (const h of history) messages.push(h);
  messages.push({
    role: 'user',
    content: `${buttonsLine}\n\n(دورك رقم ${turnIndex + 1}. رجّع JSON فقط.)${nudge ? '\n\nتنبيه: ردّك السابق كان فاضي. لازم ترجع على الأقل رسالة وحدة في "messages" أو "tap" أو "voice_note": true. كمّل بشخصيتك.' : ''}`,
  });

  const started = process.hrtime.bigint();
  const res = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://shifts-ai.com',
      'X-Title': 'SHIFT sales bot readiness sim',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.9,
      max_tokens: 400,
      response_format: { type: 'json_object' },
      // A WhatsApp customer types, it does not deliberate. Left at its default, a thinking customer model
      // spends most of the run's 8-minute budget on its own turns instead of on the bot's.
      reasoning: { effort: 'low' },
    }),
  });
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  const body = await res.json().catch(() => null);
  if (!res.ok || !body) {
    throw new Error(`openrouter ${res.status}: ${JSON.stringify(body && body.error ? body.error : body).slice(0, 300)}`);
  }
  if (body.error) throw new Error(`openrouter error: ${JSON.stringify(body.error).slice(0, 300)}`);
  state.openrouterUsage.push({ model, ms, usage: body.usage || null });
  const content = body.choices && body.choices[0] && body.choices[0].message && body.choices[0].message.content;
  return { raw: String(content || ''), usage: body.usage || null, ms };
}

function parseCustomerReply(raw) {
  let text = String(raw || '').trim();
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) text = fence[1].trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start >= 0 && end > start) text = text.slice(start, end + 1);
  let obj;
  try {
    obj = JSON.parse(text);
  } catch (err) {
    // A model that answered in plain words is still a customer message.
    const line = String(raw || '').trim().split('\n').filter(Boolean)[0] || '';
    return { messages: line ? [line.slice(0, 300)] : [], tap: null, voiceNote: false, done: !line, malformed: true };
  }
  const msgs = Array.isArray(obj.messages) ? obj.messages : (typeof obj.messages === 'string' ? [obj.messages] : []);
  return {
    messages: msgs.map((m) => String(m || '').trim()).filter(Boolean).slice(0, 3),
    tap: typeof obj.tap === 'string' && obj.tap.trim() ? obj.tap.trim() : null,
    voiceNote: obj.voice_note === true,
    done: obj.done === true,
    malformed: false,
  };
}

// ─── the run ────────────────────────────────────────────────────────────────

function conversationId(db) {
  const conv = db.store.conversations.find((c) => c.customer_wa_id === CUSTOMER && c.business_id === BUSINESS_ID);
  return conv ? conv.id : null;
}

async function flush(rounds = 20) {
  for (let i = 0; i < rounds; i += 1) await new Promise((resolve) => setImmediate(resolve));
}

/** Busy blocks standing in for the team's diary, so the offered slots are not simply "the next two". */
function busyFixture(anchorMs) {
  const h = (n) => anchorMs + n * 60 * 60 * 1000;
  return [
    { start: new Date(h(1)), end: new Date(h(2)) },        // 11:00–12:00 today
    { start: new Date(h(4.5)), end: new Date(h(5.5)) },    // 14:30–15:30 today
    { start: new Date(h(24)), end: new Date(h(25.5)) },    // tomorrow morning
  ];
}

async function run({ customerModel, persona, maxTurns, budgetMs, outDir }) {
  // 10:00 in the team's zone, today: inside SHIFT's hours, with a full day of slots ahead.
  const anchor = new Date();
  const ammanOffsetMs = 3 * 60 * 60 * 1000;
  const dayStart = Math.floor((anchor.getTime() + ammanOffsetMs) / 86400000) * 86400000 - ammanOffsetMs;
  const anchorMs = dayStart + 10 * 60 * 60 * 1000;

  const db = installHooks(busyFixture(anchorMs));
  const restoreClock = installClock(anchorMs);

  const messageProcessor = require(path.join(ROOT, 'src/services/messageProcessor'));
  const replyBatcher = require(path.join(ROOT, 'src/services/replyBatcher'));
  const shift = require(path.join(ROOT, 'src/workflows/shift'));
  const bookingMod = require(path.join(ROOT, 'src/workflows/shift/booking'));
  const tokenCrypto = require(path.join(ROOT, 'src/utils/tokenCrypto'));

  const originalProcess = shift.processShiftBatch;
  let lastResults = [];
  shift.processShiftBatch = async (...args) => {
    const r = await originalProcess(...args);
    lastResults.push(r);
    return r;
  };

  db.reset();
  bookingMod.resetBusyCache();
  db.seed({
    businesses: [{
      id: BUSINESS_ID,
      name: 'SHIFT',
      business_type: 'shift',
      status: 'active',
      wa_phone_number_id: PNID,
      wa_access_token: tokenCrypto.encrypt('sim_token'),
      ai_config: {},
    }],
    users: [{ id: STAFF_ID, name: 'رامي', email: 'staff@sim.test', role: 'staff', business_id: BUSINESS_ID }],
  });

  const transcript = {
    persona: persona.id,
    personaTitle: persona.title,
    customerModel,
    geminiModel: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    startedAt: new Date().toISOString(),
    clockAnchor: new Date(anchorMs).toISOString(),
    turns: [],
    final: null,
    errors: [],
  };

  const chatHistory = []; // OpenRouter-side view: assistant = the customer, user = the bot
  let availableButtons = [];
  let buttonIndex = new Map(); // title -> id
  // Real elapsed time, not the patched clock: Date.now() also carries the between-turn jumps, so a budget
  // measured with it would end the conversation after a handful of turns.
  const runStartedNs = process.hrtime.bigint();
  const budgetNs = BigInt(Math.round(budgetMs)) * 1000000n;
  const elapsedMs = () => Number(process.hrtime.bigint() - runStartedNs) / 1e6;

  try {
    for (let turnIndex = 0; turnIndex < maxTurns; turnIndex += 1) {
      if (process.hrtime.bigint() - runStartedNs > budgetNs) {
        transcript.errors.push(`wall-clock budget of ${Math.round(budgetMs / 1000)}s reached after ${Math.round(elapsedMs() / 1000)}s, before turn ${turnIndex + 1}`);
        break;
      }

      // ── the customer speaks ──
      // An empty turn is the customer model giving up on the persona, not the persona going quiet: it is
      // asked once more before the conversation is allowed to end, so a run is never cut short at turn 2.
      let reply = null;
      let customerFailed = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const out = await callCustomerModel(customerModel, persona, chatHistory, availableButtons, turnIndex, attempt > 0);
          reply = parseCustomerReply(out.raw);
          reply.customerMs = out.ms;
          reply.customerUsage = out.usage;
        } catch (err) {
          customerFailed = err.message;
          break;
        }
        if (reply.messages.length || reply.tap || reply.voiceNote) break;
        transcript.errors.push(`turn ${turnIndex + 1}: customer model returned an empty turn (done=${reply.done}) — re-asked`);
      }
      if (customerFailed) {
        transcript.errors.push(`customer model failed at turn ${turnIndex + 1}: ${customerFailed}`);
        break;
      }
      if (!reply.messages.length && !reply.tap && !reply.voiceNote) {
        transcript.turns.push({ index: turnIndex, kind: 'customer_done', at: new Date().toISOString() });
        break;
      }

      // A tap only counts when the title really was on offer; otherwise it is what the customer typed.
      let items = [];
      let tapId = null;
      if (reply.tap && buttonIndex.has(reply.tap)) {
        tapId = buttonIndex.get(reply.tap);
        items = [{ tapId, title: reply.tap }];
      } else if (reply.tap) {
        items = [{ text: reply.tap }];
        transcript.errors.push(`turn ${turnIndex + 1}: customer tapped «${reply.tap}» which was not offered — sent as text`);
      } else if (reply.voiceNote) {
        items = [{ media: 'audio' }];
      } else {
        items = reply.messages.map((t) => ({ text: t }));
      }
      if (!items.length) {
        transcript.errors.push(`turn ${turnIndex + 1}: customer model produced nothing`);
        break;
      }

      jumpClock(TURN_GAP_MS);
      const sendsStart = state.graphSends.length;
      const geminiStart = state.geminiCalls.length;
      const calStart = state.calendarOps.length;
      const alertStart = state.alertPosts.length;
      lastResults = [];
      const turnAt = new Date().toISOString();
      const inboundRows = [];

      // ── the whole burst is persisted first, then answered as ONE batch ──
      for (let j = 0; j < items.length; j += 1) {
        if (j > 0) jumpClock(1500);
        const msg = waMessage(items[j], Date.now());
        const { items: persisted } = await messageProcessor.persistInbound(entryFor([msg], persona.profileName));
        for (const it of persisted) if (it.message) inboundRows.push(it.message);
      }
      jumpClock(QUIET_MS);

      const botStarted = process.hrtime.bigint();
      let runError = null;
      const convId = conversationId(db);
      if (convId) {
        try {
          await replyBatcher.runBatch(convId, { now: () => new Date() });
        } catch (err) {
          runError = String((err && err.stack) || err).slice(0, 600);
          transcript.errors.push(`turn ${turnIndex + 1}: runBatch threw: ${err && err.message}`);
        }
      }
      await flush();
      replyBatcher.cancelAll();
      const botMs = Number(process.hrtime.bigint() - botStarted) / 1e6;

      const convAfter = convId ? db.store.conversations.find((c) => c.id === convId) : null;
      const wdAfter = (convAfter && convAfter.workflow_data) || {};
      const parts = state.graphSends.slice(sendsStart).map((s) => partFromPayload(s.payload));
      const geminiTurn = state.geminiCalls.slice(geminiStart);
      const calendarTurn = state.calendarOps.slice(calStart);
      const alertsTurn = state.alertPosts.slice(alertStart).map((a) => (a.payload && a.payload.reason) || 'alert');

      const turn = {
        index: turnIndex,
        kind: tapId ? 'tap' : reply.voiceNote ? 'voice_note' : 'text',
        at: turnAt,
        customer: {
          messages: reply.messages,
          tap: tapId ? { id: tapId, title: reply.tap } : null,
          voiceNote: !!reply.voiceNote,
          malformed: !!reply.malformed,
          latencyMs: Math.round(reply.customerMs),
          usage: reply.customerUsage,
        },
        bot: {
          parts,
          latencyMs: Math.round(botMs),
          geminiCalls: geminiTurn.map((g) => ({ ms: Math.round(g.ms), ok: g.ok, finish: g.finish, blockReason: g.promptFeedback, error: g.error || null, usage: g.usage })),
          results: lastResults.map((r) => r && { kind: r.kind, action: r.action }),
          alerts: alertsTurn,
          error: runError,
        },
        calendar: calendarTurn,
        stage: convAfter ? convAfter.current_state : null,
        status: convAfter ? convAfter.status : null,
        lead: clone(wdAfter.lead || {}),
        booking: clone(wdAfter.booking || null),
        capturePending: clone(wdAfter.capture_pending || null),
        roleplay: clone(wdAfter.roleplay || null),
        validatorBlocks: clone(wdAfter.validator_blocks || []),
      };
      transcript.turns.push(turn);

      // ── feed the bot's turn back to the customer model ──
      const customerSaid = tapId ? `[ضغط زر: ${reply.tap}]` : reply.voiceNote ? '[رسالة صوتية]' : reply.messages.join('\n');
      chatHistory.push({ role: 'assistant', content: customerSaid });
      const botText = parts.map((p) => {
        const bits = [p.text];
        if (p.buttons && p.buttons.length) bits.push(`[أزرار: ${p.buttons.map((b) => b.title).join(' | ')}]`);
        if (p.rows && p.rows.length) bits.push(`[خيارات: ${p.rows.map((r) => r.title).join(' | ')}]`);
        return bits.filter(Boolean).join('\n');
      }).filter(Boolean).join('\n\n');
      chatHistory.push({ role: 'user', content: botText || '(ما وصلك رد)' });

      buttonIndex = new Map();
      for (const p of parts) {
        for (const b of p.buttons || []) buttonIndex.set(b.title, b.id);
        for (const r of p.rows || []) buttonIndex.set(r.title, r.id);
      }
      availableButtons = [...buttonIndex.keys()];

      if (convAfter && convAfter.status === 'human_takeover') {
        transcript.errors.push(`turn ${turnIndex + 1}: conversation moved to human_takeover — the bot stops here`);
      }
      // A `done` in the first few turns is the model cutting the persona short, not a finished conversation.
      if (reply.done && turnIndex >= 7) break;
    }
  } finally {
    shift.processShiftBatch = originalProcess;
    replyBatcher.cancelAll();
    const convId = conversationId(db);
    const conv = convId ? db.store.conversations.find((c) => c.id === convId) : null;
    const wd = (conv && conv.workflow_data) || {};
    transcript.final = {
      conversation: conv ? clone({ status: conv.status, current_state: conv.current_state, ai_enabled: conv.ai_enabled, metadata: conv.metadata }) : null,
      workflow_data: clone(wd),
      lead: clone(wd.lead || {}),
      booking: clone(wd.booking || null),
      calendarEvents: calendarStub ? [...calendarStub.__events.values()].map((e) => clone({ id: e.id, status: e.status, summary: e.summary, start: e.start, end: e.end, description: e.description })) : [],
      calendarOps: clone(state.calendarOps),
      alerts: state.alertPosts.map((a) => (a.payload && a.payload.reason) || 'alert'),
      geminiCalls: state.geminiCalls.length,
      geminiFailures: state.geminiCalls.filter((g) => !g.ok).length,
      geminiBlocked: state.geminiCalls.filter((g) => g.promptFeedback || (g.finish && !['STOP', 'MAX_TOKENS'].includes(g.finish))).length,
      openrouter: {
        calls: state.openrouterUsage.length,
        promptTokens: state.openrouterUsage.reduce((n, u) => n + ((u.usage && u.usage.prompt_tokens) || 0), 0),
        completionTokens: state.openrouterUsage.reduce((n, u) => n + ((u.usage && u.usage.completion_tokens) || 0), 0),
        cost: state.openrouterUsage.reduce((n, u) => n + ((u.usage && u.usage.cost) || 0), 0),
      },
      endedAt: new Date().toISOString(),
      wallClockSeconds: Math.round(elapsedMs() / 1000),
    };
    restoreClock();
  }

  writeReport(transcript, outDir);
  return transcript;
}

// ─── report ─────────────────────────────────────────────────────────────────

function partLine(p) {
  const head = p.type === 'text' ? '' : `(${p.type}) `;
  const bits = [`${head}${p.text || ''}`.trim()];
  if (p.header) bits.unshift(`*${p.header}*`);
  if (p.footer) bits.push(`_${p.footer}_`);
  if (p.url) bits.push(`↗ ${p.url}`);
  if (p.buttons && p.buttons.length) bits.push(`أزرار: ${p.buttons.map((b) => `[${b.title}](${b.id})`).join(' ')}`);
  if (p.rows && p.rows.length) bits.push(`خيارات: ${p.rows.map((r) => `[${r.title}](${r.id})`).join(' ')}`);
  return bits.filter(Boolean).join('\n> ');
}

function writeReport(transcript, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const slug = `${date}-${transcript.persona}-${transcript.customerModel.replace(/[^a-z0-9.]+/gi, '-')}`;
  const base = path.join(outDir, slug);
  fs.writeFileSync(`${base}.json`, JSON.stringify(transcript, null, 2));

  const L = [];
  L.push(`# Sim — ${transcript.personaTitle}`);
  L.push('');
  L.push(`- Customer model: \`${transcript.customerModel}\` (OpenRouter)`);
  L.push(`- Bot: the real SHIFT pipeline on \`${transcript.geminiModel}\` (fake DB, fake WhatsApp, in-memory calendar)`);
  L.push(`- Clock anchored at ${transcript.clockAnchor}`);
  L.push(`- Started ${transcript.startedAt}`);
  L.push('');
  const lat = transcript.turns.filter((t) => t.bot).map((t) => t.bot.latencyMs);
  if (lat.length) {
    const sorted = [...lat].sort((a, b) => a - b);
    L.push(`- Bot turns: ${lat.length}; latency min ${sorted[0]}ms, median ${sorted[Math.floor(sorted.length / 2)]}ms, max ${sorted[sorted.length - 1]}ms`);
  }
  if (transcript.errors.length) {
    L.push('');
    L.push('## Run notes');
    for (const e of transcript.errors) L.push(`- ${e}`);
  }
  L.push('');
  L.push('## Transcript');
  for (const t of transcript.turns) {
    L.push('');
    L.push(`### Turn ${t.index + 1} — ${t.kind} — ${t.at}`);
    if (t.kind === 'customer_done') { L.push('_the customer model ended the conversation_'); continue; }
    L.push('');
    L.push('**Customer**');
    if (t.customer.tap) L.push(`> 🔘 tapped «${t.customer.tap.title}» → \`${t.customer.tap.id}\``);
    else if (t.customer.voiceNote) L.push('> 🎤 (voice note — message_type audio, no text)');
    else for (const m of t.customer.messages) L.push(`> ${m}`);
    L.push('');
    L.push(`**Bot** — ${t.bot.parts.length} part(s), ${t.bot.latencyMs}ms`);
    if (!t.bot.parts.length) L.push('> ⚠️ (silence — nothing was sent)');
    for (const p of t.bot.parts) L.push(`> ${partLine(p)}`);
    L.push('');
    const results = t.bot.results.filter(Boolean).map((r) => `${r.kind}/${r.action}`).join(', ') || '—';
    L.push(`- result: ${results} · stage: \`${t.stage}\` · status: \`${t.status}\``);
    const g = t.bot.geminiCalls;
    if (g.length) {
      L.push(`- gemini: ${g.map((x) => `${x.ok ? `${x.ms}ms ${x.finish}` : `FAILED ${x.error}`}${x.blockReason ? ` blocked=${x.blockReason}` : ''}`).join(' | ')}`);
    } else {
      L.push('- gemini: not called (deterministic path)');
    }
    if (t.calendar.length) L.push(`- calendar: ${t.calendar.map((c) => `${c.op}${c.eventId ? ` ${c.eventId}` : ''}`).join(', ')}`);
    if (t.bot.alerts.length) L.push(`- staff alert: ${t.bot.alerts.join(', ')}`);
    if (t.validatorBlocks.length) L.push(`- validator blocks so far: ${JSON.stringify(t.validatorBlocks.slice(-3))}`);
    if (t.booking) L.push(`- booking: ${JSON.stringify(t.booking)}`);
    if (t.capturePending) L.push(`- capture_pending: ${JSON.stringify(t.capturePending)}`);
    if (Object.keys(t.lead).length) L.push(`- lead: ${JSON.stringify(t.lead)}`);
    if (t.bot.error) L.push(`- ⚠️ runBatch error: \`${t.bot.error.split('\n')[0]}\``);
  }
  L.push('');
  L.push('## Final state');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify({
    conversation: transcript.final.conversation,
    lead: transcript.final.lead,
    booking: transcript.final.booking,
    calendarEvents: transcript.final.calendarEvents,
    calendarOps: transcript.final.calendarOps,
    alerts: transcript.final.alerts,
    gemini: {
      calls: transcript.final.geminiCalls,
      failures: transcript.final.geminiFailures,
      blocked: transcript.final.geminiBlocked,
    },
    openrouter: transcript.final.openrouter,
  }, null, 2));
  L.push('```');
  L.push('');
  L.push('<details><summary>full workflow_data</summary>');
  L.push('');
  L.push('```json');
  L.push(JSON.stringify(transcript.final.workflow_data, null, 2));
  L.push('```');
  L.push('');
  L.push('</details>');
  fs.writeFileSync(`${base}.md`, L.join('\n'));
  console.log(`\ntranscript: ${base}.md`);
}

// ─── CLI ────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { customer: null, persona: null, out: 'docs/bot/sims', maxTurns: DEFAULT_MAX_TURNS, budgetMs: DEFAULT_BUDGET_MS };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--customer') args.customer = argv[++i];
    else if (a === '--persona') args.persona = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--max-turns') args.maxTurns = Number(argv[++i]);
    else if (a === '--budget-ms') args.budgetMs = Number(argv[++i]);
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.customer || !args.persona) {
    console.log('node scripts/sim-chat.js --customer <openrouter model id> --persona restaurant|clinic|hostile [--out docs/bot/sims] [--max-turns 14] [--budget-ms 480000]');
    return args.help ? 0 : 2;
  }
  const persona = PERSONAS[args.persona];
  if (!persona) {
    console.error(`sim-chat: unknown persona ${args.persona} (have ${Object.keys(PERSONAS).join(', ')})`);
    return 2;
  }
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('sim-chat: OPENROUTER_API_KEY is required (the customer side).');
    return 2;
  }
  if (!process.env.GEMINI_API_KEY) {
    console.error('sim-chat: GEMINI_API_KEY is required (the bot side calls the real Gemini API).');
    return 2;
  }
  const outDir = path.resolve(process.cwd(), args.out);
  const t = await run({
    customerModel: args.customer,
    persona,
    maxTurns: Number.isFinite(args.maxTurns) && args.maxTurns > 0 ? args.maxTurns : DEFAULT_MAX_TURNS,
    budgetMs: Number.isFinite(args.budgetMs) && args.budgetMs > 0 ? args.budgetMs : DEFAULT_BUDGET_MS,
    outDir,
  });
  console.log(`turns=${t.turns.length} gemini=${t.final.geminiCalls} failures=${t.final.geminiFailures} booking=${t.final.booking ? 'yes' : 'no'} events=${t.final.calendarEvents.length}`);
  if (t.errors.length) for (const e of t.errors) console.log(`note: ${e}`);
  return 0;
}

module.exports = { run, PERSONAS, parseArgs, makeCalendarStub };

if (require.main === module) {
  main().then((code) => {
    process.exitCode = code;
    setImmediate(() => process.exit(code));
  }, (err) => {
    console.error(err);
    process.exit(1);
  });
}
